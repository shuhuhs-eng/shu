-- ============================================================================
-- 0070_stylist_profile_public.draft.sql  【草案・未適用・レビュー待ち】
--
-- 目的（確定方針）
--  1. 生年月日を必須登録（本人のみ確認・編集。サロンへは公開しない）。既存会員は推測せず未登録から始め、
--     登録（生年月日＋表示方法の選択）が済むまで、サロン向け候補一覧・プロフィール画像・スカウト送信先から保留。
--     プロフィールの新規保存・更新は生年月日未登録だと拒否（stylist_profiles のトリガー）。登録済みをNULLへ戻せない。
--  2. サロンへの年齢表示は本人が選択: exact=実年齢（45歳）/ decade=年代（40代）。未選択の既存会員は勝手に設定しない。
--     返すデータそのものを制御（年代表示の未承認サロンへは、実年齢・生年月日をレスポンスに含めない）。
--  3. サロン（店舗単位）は、年代表示の美容師へ「実年齢の開示」を任意で依頼できる。本人が承認・辞退。
--     承認は依頼元の店舗だけに有効（現在の満年齢）。生年月日は承認後も返さない。通知はアプリ内通知のみ。
--  4. 公開可否は正確な満年齢で判断（年代表示・承認では未成年の保留を回避・解除できない）。
--  5. スカウト受信を「受け取る」に統一（美容師ロールのアカウントのみ。公開範囲・メール配信設定は変更しない）。
--  6. サロン向けの公開プロフィールに 画像・雇用形態・Instagram・大切にしたいこと・年齢情報 を追加。
--     画像は「公開してよい美容師の、現在のプロフィール画像1枚」だけをサロンが読める権限を追加。
--  7. 給与条件の新規提示を、DBの保存経路（salary_offers へのINSERT）で停止。既存の提示・履歴は保持。
--
-- 触らないもの: save_stylist_profile（シグネチャ・本文とも無変更）、診断・マッチング計算、
--   visibility の値、send_scout / send_scout_v2 の本文、respond_salary_offer、既存の提示行。
-- 追加の変更（要確認）: scouts へのINSERTを公開可の美容師に限るトリガー、通知種別2つの追加。
--
-- 実行順: 0070_preapply_check.sql → 本ファイル → 0070_postapply_check.sql
-- 巻き戻し: 0070_rollback.draft.sql（生年月日の値は消えるため、登録済みが無いときだけ）
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. 機能フラグ（停止・再開の単一の切替点）
--    stylist_public_extended: 公開プロフィールの追加表示（一覧関数・画像ポリシーが参照）。停止＝paused=true。
--    salary_offer_presentation: 給与条件の新規提示（下の5.のトリガーが参照）。
-- ---------------------------------------------------------------------------
create table if not exists public.feature_pauses (
  feature    text primary key,
  paused     boolean not null default true,
  reason     text,
  updated_at timestamptz not null default now()
);
alter table public.feature_pauses enable row level security;
revoke all on public.feature_pauses from public, anon, authenticated, service_role;
comment on table public.feature_pauses is '機能の一時停止フラグ（paused=true で停止）。運営のSQLからのみ変更。アプリ・利用者からは読み書き不可。行が無い場合は停止扱い（安全側）。';
insert into public.feature_pauses (feature, paused, reason) values
  ('salary_offer_presentation', true,  '給与条件の提示は一時停止中（既存の提示・履歴は保持）'),
  ('minor_salon_public',        true,  '未成年のサロン公開は保留中（paused=true が「保留」）。解除は別途の承認が必要'),
  ('stylist_public_extended',   false, '公開プロフィールの追加表示（画像・雇用形態・Instagram・大切にしたいこと・年齢）。停止するとサロンへは従来の項目だけを返す')
on conflict (feature) do nothing;

-- ★権限は既定（Supabaseの既定権限）に頼らず、各関数ごとに「全ロールから外す→必要なものだけ付与」を明示する。
-- 公開プロフィールの追加表示が有効か（内部用。行が無ければ無効＝安全側）。
create or replace function public.stylist_public_extended_enabled()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$ select not coalesce((select paused from public.feature_pauses where feature = 'stylist_public_extended'), true) $$;

revoke all on function public.stylist_public_extended_enabled() from public, anon, authenticated, service_role;

-- 美容師本人のプレビュー用: 「いまサロンに追加表示が出ているか」を返す（生年月日列の有無ではなく、公開機能の状態で判定する）。
create or replace function public.get_stylist_public_extended_enabled()
returns boolean
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  return public.stylist_public_extended_enabled();
end;
$$;

revoke all on function public.get_stylist_public_extended_enabled() from public, anon, authenticated, service_role;
grant execute on function public.get_stylist_public_extended_enabled() to authenticated;

-- ---------------------------------------------------------------------------
-- 1. 生年月日（必須）と、サロンへの年齢の表示方法（本人が選択）
--    stylist_private は 本人SELECTのみ（RLS: user_id = auth.uid()）。書き込みGRANTなし。
--    【確定方針】正確な年齢を必須登録する。生年月日そのものはサロンへ公開しない（満年齢・年代だけを、下の規則で返す）。
--      ・既存会員の生年月日は推測して埋めない（age_band等から作らない）。未登録のままログインはできる。
--      ・未登録の既存会員は、登録（生年月日＋表示方法の選択）が済むまで、サロン向け候補一覧・プロフィール画像の公開を保留する。
--      ・プロフィールの新規保存・更新は、生年月日が未登録だと拒否する（下の 1c）。登録済みの生年月日をNULLへ戻すことはできない（1a）。
--      ・保存できる年齢の範囲は満15〜100歳（変更なし）。
-- ---------------------------------------------------------------------------
alter table public.stylist_private add column if not exists birth_date date;
alter table public.stylist_private add column if not exists age_display_mode text;
alter table public.stylist_private add constraint stylist_private_age_display_mode_check check (age_display_mode in ('exact','decade'));
comment on column public.stylist_private.birth_date is
  '生年月日（必須登録。既存会員は未登録=NULLから始まり、age_bandからは推測しない）。本人のみ閲覧・編集（RLS本人SELECT・書き込みはset_stylist_birth_date経由のみ）。サロンへは返さない。';
comment on column public.stylist_private.age_display_mode is
  'サロンへの年齢の表示方法（本人が選択）: exact=実年齢（例 45歳）/ decade=年代（例 40代）。NULL=未選択（既存会員は勝手に設定しない。未選択のあいだはサロンへ公開しない）。';

-- 満年齢（日本時間の今日基準）。内部用: クライアントへ直接は公開しない。
create or replace function public.stylist_age_years(p_birth date)
returns integer
language sql stable
set search_path = public, pg_temp
as $$
  select case when p_birth is null then null
    else extract(year from age((now() at time zone 'Asia/Tokyo')::date, p_birth))::integer end;
$$;
revoke all on function public.stylist_age_years(date) from public, anon, authenticated, service_role;

-- 1a. 生年月日の保存（本人のみ）。NULLは受け付けない（必須条件を回避できない）。範囲: 本日以前・満15歳以上100歳以下。
--     アプリのプロフィール保存は save_stylist_profile_v2（1c-2）が内部でこの関数を呼ぶ（生年月日・表示方法・プロフィールが1トランザクション）。
--     そのため「美容師プロフィール行が未作成」でも保存できる。ただしサロン専用アカウント（美容師ロールなし・他ロールあり）は不可。
create or replace function public.set_stylist_birth_date(p_birth_date date)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_age integer;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_birth_date is null then raise exception 'birth date required'; end if;
  if exists (select 1 from public.user_roles where user_id = v_uid)
     and not exists (select 1 from public.user_roles where user_id = v_uid and role = 'stylist') then
    raise exception 'stylist role required';
  end if;
  v_age := public.stylist_age_years(p_birth_date);
  if p_birth_date > (now() at time zone 'Asia/Tokyo')::date or v_age < 15 or v_age > 100 then
    raise exception 'invalid birth date';
  end if;
  insert into public.stylist_private (user_id, birth_date) values (v_uid, p_birth_date)
  on conflict (user_id) do update set birth_date = excluded.birth_date;
end;
$$;
revoke all on function public.set_stylist_birth_date(date) from public, anon, authenticated, service_role;
grant execute on function public.set_stylist_birth_date(date) to authenticated;

-- 登録済みの生年月日をNULLへ戻す更新は、どの経路でも拒否する（必須条件の回避防止）。
create or replace function public._trg_stylist_private_birth_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if old.birth_date is not null and new.birth_date is null then
    raise exception 'birth date cannot be cleared';
  end if;
  return new;
end;
$$;
revoke all on function public._trg_stylist_private_birth_guard() from public, anon, authenticated, service_role;
create trigger trg_stylist_private_birth_guard before update of birth_date on public.stylist_private
  for each row execute function public._trg_stylist_private_birth_guard();

-- 1b. 年齢の表示方法の選択（本人のみ）。exact=実年齢 / decade=年代。NULLへは戻せない（選択した後は切替のみ）。
create or replace function public.set_stylist_age_display_mode(p_mode text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_mode is null or p_mode not in ('exact','decade') then raise exception 'invalid age display mode'; end if;
  if exists (select 1 from public.user_roles where user_id = v_uid)
     and not exists (select 1 from public.user_roles where user_id = v_uid and role = 'stylist') then
    raise exception 'stylist role required';
  end if;
  insert into public.stylist_private (user_id, age_display_mode) values (v_uid, p_mode)
  on conflict (user_id) do update set age_display_mode = excluded.age_display_mode;
end;
$$;
revoke all on function public.set_stylist_age_display_mode(text) from public, anon, authenticated, service_role;
grant execute on function public.set_stylist_age_display_mode(text) to authenticated;

-- 1c. プロフィールの新規保存・更新は、生年月日が未登録、または年齢の表示方法が未選択だと拒否する。
--     プロフィール行（stylist_profiles）の書き込み経路は save_stylist_profile（と0071の set_stylist_career_phase）だけ。
--     どちらもこのトリガーを通る。したがって旧 save_stylist_profile を直接呼んでも、表示方法の未選択では保存できない。
--     アプリは下の save_stylist_profile_v2（1回のDBトランザクション）で保存する。
create or replace function public._trg_stylist_profiles_birth_required()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.stylist_private where user_id = new.user_id and birth_date is not null) then
    raise exception 'birth_date_required' using hint = '生年月日を登録してください';
  end if;
  if not exists (select 1 from public.stylist_private where user_id = new.user_id and age_display_mode is not null) then
    raise exception 'age_display_mode_required' using hint = '年齢の表示方法を選択してください';
  end if;
  return new;
end;
$$;
revoke all on function public._trg_stylist_profiles_birth_required() from public, anon, authenticated, service_role;
create trigger trg_stylist_profiles_birth_required before insert or update on public.stylist_profiles
  for each row execute function public._trg_stylist_profiles_birth_required();

-- 1c-2. 生年月日・年齢の表示方法・プロフィールを「1回のDBトランザクション」で保存する（アプリの保存はこの関数のみ）。
--       関数本体は1トランザクション。途中（プロフィール保存など）で失敗すると、生年月日・表示方法・公開設定を含めすべて取り消される。
--       生年月日・表示方法のどちらかが空/不正ならプロフィールも保存しない（DB側で必須判定。フォームの項目欠落には依存しない）。
--       既存の set_stylist_birth_date / set_stylist_age_display_mode / save_stylist_profile を内部で呼ぶ（auth.uid() はそのまま有効）。
create or replace function public.save_stylist_profile_v2(
  p_public_name           text,
  p_full_name             text,
  p_age_band              public.age_band,
  p_gender                public.gender_type,
  p_prefecture            text,
  p_desired_work_location text,
  p_experience_years      integer,
  p_current_position      text,
  p_specialties           text[],
  p_employment_type       public.employment_type,
  p_job_change_intent     public.job_change_intent,
  p_desired_salary_range  public.salary_band,
  p_sns_links             jsonb,
  p_bio                   text,
  p_visibility            public.profile_visibility,
  p_scout_enabled         boolean,
  p_avatar_path           text,
  p_value_priorities      text[],
  p_birth_date            date,
  p_age_display_mode      text
) returns public.profiles
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_profile public.profiles;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_birth_date is null then raise exception 'birth_date_required' using hint = '生年月日を登録してください'; end if;
  if p_age_display_mode is null or p_age_display_mode not in ('exact','decade') then
    raise exception 'age_display_mode_required' using hint = '年齢の表示方法を選択してください';
  end if;
  perform public.set_stylist_birth_date(p_birth_date);
  perform public.set_stylist_age_display_mode(p_age_display_mode);
  v_profile := public.save_stylist_profile(
    p_public_name, p_full_name, p_age_band, p_gender, p_prefecture, p_desired_work_location,
    p_experience_years, p_current_position, p_specialties, p_employment_type, p_job_change_intent,
    p_desired_salary_range, p_sns_links, p_bio, p_visibility, p_scout_enabled, p_avatar_path, p_value_priorities);
  return v_profile;
end;
$$;
revoke all on function public.save_stylist_profile_v2(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[],date,text) from public, anon, authenticated, service_role;
grant execute on function public.save_stylist_profile_v2(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[],date,text) to authenticated;

-- ---------------------------------------------------------------------------
-- 1d. サロンへ公開してよいか（表示方法の選択とは別の判定。正確な満年齢で判断する）
--     公開してよい = 生年月日が登録済み かつ 表示方法を選択済み かつ（満18歳以上 または 未成年フラグが解除済み）。
--     ・年代表示でも、判定は正確な満年齢で行う（年代表示にして未成年の保留を回避することはできない）。
--     ・実年齢の開示を承認されても、この判定は変わらない（非公開・未成年の保留は解除されない）。
--     ・フラグ minor_salon_public が paused（保留。既定）のあいだ、満18歳未満は出さない。行が無い場合も保留（安全側）。
--       解除は運営のSQL: update public.feature_pauses set paused=false where feature='minor_salon_public';（別途承認）
--     ・生年月日が未登録・表示方法が未選択の人は、成人と推定せず、登録が済むまで公開しない。
-- ---------------------------------------------------------------------------
create or replace function public.stylist_salon_publishable(p_user_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select sp.birth_date is not null and sp.age_display_mode is not null
       and (public.stylist_age_years(sp.birth_date) >= 18
            or not coalesce((select paused from public.feature_pauses where feature = 'minor_salon_public'), true))
    from public.stylist_private sp where sp.user_id = p_user_id
  ), false)
$$;
revoke all on function public.stylist_salon_publishable(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1e. 実年齢の開示依頼（依頼元の単位 = 店舗 salon_stores.id）
--     ・サロンは、年代表示の美容師に「実年齢の開示」を任意で依頼できる。興味あり・スカウトだけで自動的には開示しない。
--     ・依頼できるのは、その店舗の採用管理の権限を持つ人（can_manage_store_hiring: 会社の管理者3種・担当店舗のエリアマネージャー・
--       店長/採用担当。閲覧専用は不可）。会社に所属しているだけで別店舗へ広げない。
--     ・承認すると、依頼元の店舗に限り、その店舗にアクセスできる人（is_store_accessible）が現在の満年齢を見られる。
--       誕生日を迎えたあとも最新の満年齢。別の店舗へは流用しない。生年月日そのものは承認後も返さない。
--     ・辞退・未回答のあいだは年代表示のまま。辞退した相手への再依頼はできない（状態は declined のまま）。
--     ・同じ店舗×美容師の依頼は1件だけ（重複・連打は同じ依頼を返す）。承認・辞退の二重処理は同じ結果を返し、逆の決定は拒否する。
-- ---------------------------------------------------------------------------
create table public.age_disclosure_requests (
  id              uuid primary key default gen_random_uuid(),
  store_id        uuid not null references public.salon_stores(id) on delete cascade,
  stylist_user_id uuid not null references auth.users(id) on delete cascade,
  requested_by    uuid references auth.users(id) on delete set null,
  status          text not null default 'pending' check (status in ('pending','approved','declined')),
  requested_at    timestamptz not null default now(),
  decided_at      timestamptz,
  constraint age_disclosure_requests_unique unique (store_id, stylist_user_id),
  constraint age_disclosure_requests_decided_consistent check ((status = 'pending') = (decided_at is null))
);
create index age_disclosure_requests_stylist_idx on public.age_disclosure_requests (stylist_user_id, status);
alter table public.age_disclosure_requests enable row level security;
revoke all on public.age_disclosure_requests from public, anon, authenticated, service_role;
comment on table public.age_disclosure_requests is '実年齢の開示依頼（店舗×美容師で1件）。読み書きは専用のRPCのみ（直接のGRANT・RLSポリシーなし）。生年月日は持たない。';

-- アプリ内通知に新しい種類を追加（メール等の外部送信は行わない）。既存の種類は変更しない。
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type = any (array[
  'scout_received','scout_responded','salary_offer_received','salary_offer_revised','salary_offer_accepted','salary_offer_revision_requested',
  'salary_offer_declined','evidence_verified','evidence_rejected','interview_action_required','stylist_interest_received',
  'hiring_interview_scheduled','hiring_interview_rescheduled','hiring_status_updated','hiring_offered','hiring_hired','hiring_declined_by_stylist',
  'age_disclosure_requested','age_disclosure_approved']::text[]));

-- 内部: サロン（店舗）に返す年齢情報を、データそのものとして制御する。
--   exact（実年齢表示）: age を含める。decade（年代表示）: 年代だけ。承認済みの店舗にだけ age を含める。
--   age のキー自体を、許可されない場合は含めない。生年月日は返さない。
--   未登録・未選択は 'unavailable'（公開されない人。年齢は一切返さない）。
create or replace function public._stylist_age_info(p_store_id uuid, p_stylist_user_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_birth date; v_mode text; v_age integer; v_status text;
begin
  select birth_date, age_display_mode into v_birth, v_mode from public.stylist_private where user_id = p_stylist_user_id;
  -- 公開してよくない人（未登録・未選択・未成年の保留中）は、年齢を一切返さない（承認があっても保留は解除しない）
  if v_birth is null or v_mode is null or not public.stylist_salon_publishable(p_stylist_user_id) then
    return jsonb_build_object('age_display_mode', null, 'age_request_status', 'unavailable');
  end if;
  v_age := public.stylist_age_years(v_birth);
  if p_store_id is not null then
    select status into v_status from public.age_disclosure_requests where store_id = p_store_id and stylist_user_id = p_stylist_user_id;
  end if;
  return jsonb_build_object(
           'age_display_mode', v_mode,
           'age_decade', (v_age / 10) * 10,
           'age_request_status', case when v_mode = 'exact' then 'not_needed' else coalesce(v_status, 'none') end)
         || case when v_mode = 'exact' or v_status = 'approved' then jsonb_build_object('age', v_age) else '{}'::jsonb end;
end;
$$;
revoke all on function public._stylist_age_info(uuid, uuid) from public, anon, authenticated, service_role;

-- 依頼（サロン側）。対象: その店舗の候補（公開中・スカウト受信可）または、その店舗へ「興味あり」を送った美容師。
create or replace function public.request_stylist_age_disclosure(p_store_id uuid, p_stylist_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid(); v_id uuid; v_status text; v_store_name text; v_created boolean := false;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.user_roles where user_id = v_uid and role = 'salon') then raise exception 'caller is not a salon'; end if;
  if not public.can_manage_store_hiring(p_store_id) then raise exception 'not allowed to request for this store'; end if;
  if not public.stylist_public_extended_enabled() then raise exception 'age disclosure is currently paused'; end if;
  if not exists (select 1 from public.user_roles where user_id = p_stylist_user_id and role = 'stylist') then raise exception 'target is not available'; end if;
  if not public.stylist_salon_publishable(p_stylist_user_id) then raise exception 'target is not available'; end if;
  if not (
       (exists (select 1 from public.stylist_profiles where user_id = p_stylist_user_id and visibility = 'PUBLIC')
        and not exists (select 1 from public.user_settings where user_id = p_stylist_user_id and scout_enabled = false))
       or exists (select 1 from public.stylist_salon_interests where stylist_user_id = p_stylist_user_id and store_id = p_store_id)
     ) then raise exception 'target is not available'; end if;
  if (select age_display_mode from public.stylist_private where user_id = p_stylist_user_id) is distinct from 'decade' then
    raise exception 'age disclosure is not needed';   -- 実年齢表示の人には依頼不要（年代表示の人だけが対象）
  end if;
  -- 新しい依頼の受付は、既存の「採用活動の受付状態」に従う（停止・解約中は新規依頼なし）
  if not exists (select 1 from public.age_disclosure_requests where store_id = p_store_id and stylist_user_id = p_stylist_user_id) then
    perform public.assert_store_recruiting_allowed(p_store_id);
  end if;
  insert into public.age_disclosure_requests (store_id, stylist_user_id, requested_by) values (p_store_id, p_stylist_user_id, v_uid)
  on conflict (store_id, stylist_user_id) do nothing returning id into v_id;
  if v_id is not null then
    v_created := true; v_status := 'pending';
    select store_name into v_store_name from public.salon_stores where id = p_store_id;
    insert into public.notifications (user_id, type, title, message, related_entity_type, related_entity_id, link_path)
    values (p_stylist_user_id, 'age_disclosure_requested', '実年齢の開示依頼が届いています',
            coalesce(v_store_name, '店舗') || ' から、実年齢の開示依頼が届いています。承認・辞退を選べます。',
            'age_disclosure_request', v_id, '/stylist/age-requests')
    on conflict (user_id, type, related_entity_id) do nothing;
  else
    select id, status into v_id, v_status from public.age_disclosure_requests where store_id = p_store_id and stylist_user_id = p_stylist_user_id;
  end if;
  return jsonb_build_object('status', v_status, 'created', v_created);
end;
$$;
revoke all on function public.request_stylist_age_disclosure(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.request_stylist_age_disclosure(uuid, uuid) to authenticated;

-- 承認・辞退（美容師本人のみ）。二重処理は同じ結果を返し、逆の決定は拒否する。他人の依頼は「見つからない」と同じ扱い。
create or replace function public.respond_age_disclosure_request(p_request_id uuid, p_approve boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid(); v_req public.age_disclosure_requests; v_want text; v_stylist_label text;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_approve is null then raise exception 'decision required'; end if;
  if not exists (select 1 from public.user_roles where user_id = v_uid and role = 'stylist') then raise exception 'caller is not a stylist'; end if;
  select * into v_req from public.age_disclosure_requests where id = p_request_id and stylist_user_id = v_uid for update;
  if not found then raise exception 'request not found'; end if;
  v_want := case when p_approve then 'approved' else 'declined' end;
  if v_req.status = 'pending' then
    update public.age_disclosure_requests set status = v_want, decided_at = now() where id = v_req.id returning * into v_req;
    if v_want = 'approved' and v_req.requested_by is not null then
      insert into public.notifications (user_id, type, title, message, related_entity_type, related_entity_id, link_path)
      values (v_req.requested_by, 'age_disclosure_approved', '実年齢の開示が承認されました',
              '依頼していた美容師が、実年齢の開示を承認しました。候補の画面で確認できます。',
              'age_disclosure_request', v_req.id, '/salon/stores/' || v_req.store_id::text || '/stylists')
      on conflict (user_id, type, related_entity_id) do nothing;
    end if;
  elsif v_req.status is distinct from v_want then
    raise exception 'age_disclosure_already_decided';
  end if;
  return jsonb_build_object('status', v_req.status);
end;
$$;
revoke all on function public.respond_age_disclosure_request(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.respond_age_disclosure_request(uuid, boolean) to authenticated;

-- 自分宛ての依頼一覧（美容師本人のみ。依頼元の店舗を確認できる）
create or replace function public.get_my_age_disclosure_requests()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.user_roles where user_id = v_uid and role = 'stylist') then raise exception 'caller is not a stylist'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'request_id', r.id, 'store_id', r.store_id, 'store_name', s.store_name, 'prefecture', s.prefecture, 'city', s.city,
      'status', r.status, 'requested_at', r.requested_at, 'decided_at', r.decided_at) order by r.requested_at desc)
    from public.age_disclosure_requests r join public.salon_stores s on s.id = r.store_id
    where r.stylist_user_id = v_uid), '[]'::jsonb);
end;
$$;
revoke all on function public.get_my_age_disclosure_requests() from public, anon, authenticated, service_role;
grant execute on function public.get_my_age_disclosure_requests() to authenticated;

-- 興味あり一覧など、候補一覧以外の画面向け: 店舗にアクセスできるサロンへ、指定した美容師の年齢情報（上と同じ規則）を返す。
--   対象は、その店舗へ「興味あり」を送った美容師、または候補（公開中・スカウト受信可・公開可）に限る（任意のIDの年齢は返さない）。
create or replace function public.get_store_stylist_age_infos(p_store_id uuid, p_stylist_user_ids uuid[])
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.user_roles where user_id = v_uid and role = 'salon') then raise exception 'caller is not a salon'; end if;
  if not public.is_store_accessible(p_store_id) then raise exception 'store not found or not accessible'; end if;
  if not public.stylist_public_extended_enabled() then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('stylist_user_id', t.id) || public._stylist_age_info(p_store_id, t.id))
    from (select distinct u as id from unnest(coalesce(p_stylist_user_ids, '{}'::uuid[])) as u limit 200) t
    where exists (select 1 from public.stylist_salon_interests i where i.stylist_user_id = t.id and i.store_id = p_store_id)
       or (public.stylist_salon_publishable(t.id)
           and exists (select 1 from public.stylist_profiles sp where sp.user_id = t.id and sp.visibility = 'PUBLIC')
           and not exists (select 1 from public.user_settings us where us.user_id = t.id and us.scout_enabled = false))
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.get_store_stylist_age_infos(uuid, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.get_store_stylist_age_infos(uuid, uuid[]) to authenticated;

-- スカウトの送信先も、公開してよい美容師に限る（公開保留の人へは、旧画面・直接呼び出しでも送れない）。
create or replace function public._trg_scouts_publishable_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.stylist_salon_publishable(new.stylist_user_id) then
    raise exception 'target stylist is not publishable';
  end if;
  return new;
end;
$$;
revoke all on function public._trg_scouts_publishable_guard() from public, anon, authenticated, service_role;
create trigger trg_scouts_publishable_guard before insert on public.scouts
  for each row execute function public._trg_scouts_publishable_guard();

-- ---------------------------------------------------------------------------
-- 2. サロン向け公開プロフィール（get_public_stylists_for_scout）
--    引数 p_store_id（任意）を追加: 店舗の画面から呼ぶと、その店舗に承認された実年齢だけが含まれる（指定なしは承認なし扱い）。
--    旧シグネチャ（引数なし）は削除して置き換える（同名の2関数が並ぶとRPC呼び出しが曖昧になるため）。
--    絞り込み条件: PUBLIC かつ scout 受信可 かつ 公開してよい（生年月日登録・表示方法選択済み・未成年の保留）。並び順は従来どおり。
--    追加項目: avatar_path / employment_type / instagram_handle / value_priorities / 年齢情報（上の規則。実年齢はデータとして制御）
--    返さない: 氏名・性別・年代(age_band)・生年月日・メール・希望年収・SNSの生データ。
-- ---------------------------------------------------------------------------
drop function if exists public.get_public_stylists_for_scout();
create or replace function public.get_public_stylists_for_scout(p_store_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_salon_uid uuid := auth.uid();
  v_result jsonb;
  v_ext boolean := public.stylist_public_extended_enabled();
begin
  if v_salon_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.user_roles where user_id = v_salon_uid and role = 'salon') then
    raise exception 'caller is not a salon';
  end if;
  if p_store_id is not null and not public.is_store_accessible(p_store_id) then
    raise exception 'store not found or not accessible';
  end if;

  with candidates as (
    select
      sp.user_id as stylist_user_id,
      sp.public_name, sp.prefecture, sp.desired_work_location, sp.experience_years,
      sp.current_position, sp.specialties, sp.job_change_intent, sp.bio,
      sp.employment_type, sp.value_priorities,
      pr.avatar_path,
      (select e.elem->>'handle'
         from jsonb_array_elements(case when jsonb_typeof(sp.sns_links) = 'array' then sp.sns_links else '[]'::jsonb end) as e(elem)
        where e.elem->>'platform' = 'instagram' and nullif(e.elem->>'handle', '') is not null
        limit 1) as instagram_handle,
      case when v_ext then public._stylist_age_info(p_store_id, sp.user_id) else '{}'::jsonb end as age_info,
      public.calculate_match_axes(sp.user_id, v_salon_uid) as match,
      prev_interest.created_at as previous_interest_at,
      coalesce(prev_scout.cnt, 0) as previous_scout_count,
      prev_scout.last_sent_at as previous_scout_last_sent_at
    from public.stylist_profiles sp
    join public.user_roles ur on ur.user_id = sp.user_id and ur.role = 'stylist'
    join public.profiles pr on pr.id = sp.user_id
    left join public.user_settings us on us.user_id = sp.user_id
    left join lateral (
      select created_at from public.stylist_salon_interests
      where stylist_user_id = sp.user_id and salon_user_id = v_salon_uid
    ) prev_interest on true
    left join lateral (
      select count(*) as cnt, max(sent_at) as last_sent_at from public.scouts
      where stylist_user_id = sp.user_id and salon_user_id = v_salon_uid
    ) prev_scout on true
    where sp.visibility = 'PUBLIC'
      and coalesce(us.scout_enabled, true) = true
      and public.stylist_salon_publishable(sp.user_id)
  )
  select coalesce(jsonb_agg((jsonb_build_object(
    'stylist_user_id', stylist_user_id,
    'public_name', public_name,
    'prefecture', prefecture,
    'desired_work_location', desired_work_location,
    'experience_years', experience_years,
    'current_position', current_position,
    'specialties', specialties,
    'job_change_intent', job_change_intent,
    'bio', bio,
    'match', match,
    'previous_interest_at', previous_interest_at,
    'previous_scout_count', previous_scout_count,
    'previous_scout_last_sent_at', previous_scout_last_sent_at
  ) || case when v_ext then jsonb_build_object(
    'employment_type', employment_type,
    'value_priorities', value_priorities,
    'avatar_path', avatar_path,
    'instagram_handle', instagram_handle
  ) || age_info else '{}'::jsonb end) order by coalesce((match->>'overall_score')::numeric, -1) desc), '[]'::jsonb)
  into v_result
  from candidates;

  return v_result;
end;
$$;
comment on function public.get_public_stylists_for_scout(uuid) is
  'サロン本人へ、スカウト対象（role=stylist・visibility=PUBLIC・scout_enabled・公開してよい）の美容師一覧を相性順に返す。0070で 画像パス・雇用形態・Instagram・大切にしたいこと・年齢情報（実年齢または年代。実年齢は本人の選択か店舗への承認がある場合だけ）を追加。氏名・性別・年代(age_band)・生年月日・メール・希望年収は返さない。';
revoke all on function public.get_public_stylists_for_scout(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_public_stylists_for_scout(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. 画像の閲覧権限（avatars バケット）
--    既存の本人用ポリシー・サロンロゴ用ポリシー(0015)は変更しない。OR条件で1本追加。
--    条件: 呼び出し者がサロン／対象は visibility=PUBLIC の美容師／「現在のプロフィール画像1枚」
--    （profiles.avatar_path と完全一致）のみ。差し替え前の古い画像は読めない。
--    stylist_profiles は本人SELECTのみのRLSなので、判定は SECURITY DEFINER の補助関数で行う。
-- ---------------------------------------------------------------------------
create or replace function public.salon_can_view_stylist_avatar(p_name text)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and public.stylist_public_extended_enabled()
    and exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'salon')
    and exists (
      select 1
      from public.stylist_profiles sp
      join public.profiles pr on pr.id = sp.user_id
      join public.user_roles sr on sr.user_id = sp.user_id and sr.role = 'stylist'
      where sp.user_id::text = split_part(p_name, '/', 1)
        and sp.visibility = 'PUBLIC'
        and public.stylist_salon_publishable(sp.user_id)
        and pr.avatar_path = p_name
    );
$$;
revoke all on function public.salon_can_view_stylist_avatar(text) from public, anon, authenticated, service_role;
grant execute on function public.salon_can_view_stylist_avatar(text) to authenticated;

drop policy if exists avatars_select_public_stylist_for_salon on storage.objects;
create policy avatars_select_public_stylist_for_salon on storage.objects
  for select to authenticated using (
    bucket_id = 'avatars' and public.salon_can_view_stylist_avatar(name)
  );

-- ---------------------------------------------------------------------------
-- 4. スカウト受信を「受け取る」に統一（美容師ロールのアカウントのみ）
--    - 対象: user_settings.scout_enabled = false かつ user_roles に role='stylist' がある user
--    - 変更するのは scout_enabled のみ。notify_email・scout_prefs・visibility は変更しない。
--    - 戻せるよう、対象 user_id を退避表に記録（本人のRLS/GRANTなし。運営のSQLのみ）。
-- ---------------------------------------------------------------------------
create table if not exists public.scout_optout_migration_0070 (
  user_id uuid primary key,
  migrated_at timestamptz not null default now()
);
alter table public.scout_optout_migration_0070 enable row level security;
revoke all on public.scout_optout_migration_0070 from public, anon, authenticated, service_role;
comment on table public.scout_optout_migration_0070 is
  '0070で scout_enabled を false→true に変更した美容師の user_id（巻き戻し用）。';

with targets as (
  select us.user_id
  from public.user_settings us
  where us.scout_enabled = false
    and exists (select 1 from public.user_roles ur where ur.user_id = us.user_id and ur.role = 'stylist')
), logged as (
  insert into public.scout_optout_migration_0070 (user_id)
  select user_id from targets
  on conflict (user_id) do nothing
  returning user_id
)
update public.user_settings us set scout_enabled = true
from logged l where us.user_id = l.user_id;

-- ---------------------------------------------------------------------------
-- 5. 給与条件の新規提示をDBで停止
--    - salary_offers への INSERT をトリガーで拒否（create_salary_offer_v2・旧create_salary_offer・
--      将来追加される関数・service_role を含む全経路）。
--    - UPDATE（respond_salary_offer＝美容師の承諾/辞退）・SELECT・既存行は一切変更しない。
--    - 停止フラグは feature_pauses。行が無い場合も「停止」（安全側）。
--    - 再開: update public.feature_pauses set paused = false where feature = 'salary_offer_presentation';
-- ---------------------------------------------------------------------------
create or replace function public.block_salary_offer_insert_when_paused()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce((select paused from public.feature_pauses where feature = 'salary_offer_presentation'), true) then
    raise exception 'salary offer presentation is currently paused';
  end if;
  return new;
end;
$$;
revoke all on function public.block_salary_offer_insert_when_paused() from public, anon, authenticated, service_role;

drop trigger if exists trg_salary_offers_00_pause on public.salary_offers;
create trigger trg_salary_offers_00_pause
  before insert on public.salary_offers
  for each row execute function public.block_salary_offer_insert_when_paused();

commit;
