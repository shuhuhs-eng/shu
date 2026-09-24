-- ============================================================================
-- Beauty Reach — 0025_scouts
-- スカウト機能 Ver.1。
--
-- ★既存migrationは一切編集していない。0011（calculate_stylist_salon_match）
-- は create or replace で再定義するのみで、ファイル自体（0011_*.sql）は
-- 変更していない。
--
-- ★マッチング計算の再利用（最重要）:
-- 「同じ美容師×同じサロンなのに、美容師側とサロン側でマッチ率が違う」状態を
-- 構造的に防ぐため、0011のcalculate_stylist_salon_matchが行っていた実際の
-- 計算部分（8軸の差分計算・平均）を、新しい純粋関数
-- calculate_match_axes(p_stylist_user_id, p_salon_user_id) へそのまま
-- 切り出す（数式は0011から一切変更していない、verbatim transcription）。
-- その上で、
--   ・calculate_stylist_salon_match(p_salon_user_id)  … 既存。ガード
--     （認証・role確認・PUBLIC確認）は0011から完全に維持したまま、
--     計算本体だけを calculate_match_axes への委譲に差し替える。
--   ・calculate_salon_stylist_match(p_stylist_user_id) … 新規。ガードは
--     salon/stylistを入れ替えた対称形。同じ calculate_match_axes を呼ぶ。
-- という2つの公開RPCが同一の純粋関数を呼ぶ構造にすることで、同じペアなら
-- 数値が完全一致することを保証する（ロジックのコピペではなく共有）。
-- calculate_match_axesはガードを持たない内部専用関数のため、authenticated
-- へのgrantは行わない（呼び出しは上記2つのSECURITY DEFINER関数経由のみ）。
--
-- ★scoutsテーブル設計:
--   ・read_status（unread/read）とresponse_status（no_response/interested/
--     question/considering/considering/declined/expired）を別カラムにする。
--     「開封したがまだ回答していない」を表現するため。
--   ・salon_user_id×stylist_user_idのunique制約は付けない。再スカウトは
--     常に新しい行として履歴に残す（同じペアに複数行あってよい）。
--   ・書き込みはsend_scout/mark_scout_read/respond_scout経由のみ。
--     クライアントからの直接insert/updateは許可しない。
--
-- ★salon_scout_quotasはsalon_profilesとは別テーブル（課金系情報を
--   プロフィールに混在させない）。Ver.1のデフォルト無料枠(10)は
--   monthly_free_limit列のデフォルト値として持つだけで、恒久的な
--   ハードコードではない（将来プラン別に行を用意・上書きできる）。
--   使用数は専用カウンタ列を持たず、scouts.sent_atを当月分集計して
--   都度算出する（再スカウトも1回の使用としてカウントされる）。
--
-- ★今回スコープ外（次フェーズ）: notifications（scout_received/
--   scout_responded、CHECK制約には既に用意済みだが今回は接続しない）・
--   salary_offersとの連携は行わない。LIMITED可視性の美容師は対象外
--   （PUBLICのみ）。
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. calculate_match_axes: 0011の計算本体をそのまま切り出した純粋関数。
--    ガード（認証・role・visibility確認）を一切持たない内部専用関数。
--    数式・null判定は0011のcalculate_stylist_salon_matchから一切変更していない。
-- ----------------------------------------------------------------------------
create or replace function public.calculate_match_axes(
  p_stylist_user_id uuid,
  p_salon_user_id uuid
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_pref public.stylist_preference_profiles;
  v_culture public.salon_culture_profiles;
  v_s_educ numeric; v_s_chal numeric; v_s_brand numeric; v_s_collab numeric;
  v_s_auto numeric; v_s_flex numeric; v_s_reldist numeric; v_s_hier numeric;
  v_c_educ numeric; v_c_chal numeric; v_c_brand numeric; v_c_collab numeric;
  v_c_auto numeric; v_c_flex numeric; v_c_reldist numeric; v_c_hier numeric;
  v_m_educ numeric; v_m_chal numeric; v_m_brand numeric; v_m_collab numeric;
  v_m_auto numeric; v_m_flex numeric; v_m_reldist numeric; v_m_hier numeric;
  v_overall numeric;
begin
  select * into v_pref from public.stylist_preference_profiles where stylist_user_id = p_stylist_user_id;
  select * into v_culture from public.salon_culture_profiles where salon_user_id = p_salon_user_id;

  if v_pref.status is null or v_pref.status != 'completed' then
    return jsonb_build_object('available', false, 'reason', 'stylist_preference_incomplete');
  end if;
  if v_culture.status is null or v_culture.status != 'completed' then
    return jsonb_build_object('available', false, 'reason', 'salon_culture_incomplete');
  end if;

  v_s_educ   := nullif(v_pref.preference_axes->>'education_preference', '')::numeric;
  v_s_chal   := nullif(v_pref.preference_axes->>'challenge_preference', '')::numeric;
  v_s_brand  := nullif(v_pref.preference_axes->>'personal_brand_preference', '')::numeric;
  v_s_collab := nullif(v_pref.preference_axes->>'collaboration_preference', '')::numeric;
  v_s_auto   := nullif(v_pref.preference_axes->>'autonomy_preference', '')::numeric;
  v_s_flex   := nullif(v_pref.preference_axes->>'work_flexibility_preference', '')::numeric;
  v_s_reldist:= nullif(v_pref.preference_axes->>'relationship_distance_preference', '')::numeric;
  v_s_hier   := nullif(v_pref.preference_axes->>'hierarchy_preference', '')::numeric;

  v_c_educ   := nullif(v_culture.culture_axes->>'education_support', '')::numeric;
  v_c_chal   := nullif(v_culture.culture_axes->>'challenge_openness', '')::numeric;
  v_c_brand  := nullif(v_culture.culture_axes->>'personal_brand_support', '')::numeric;
  v_c_collab := nullif(v_culture.culture_axes->>'team_collaboration', '')::numeric;
  v_c_auto   := nullif(v_culture.culture_axes->>'individual_autonomy', '')::numeric;
  v_c_flex   := nullif(v_culture.culture_axes->>'work_flexibility', '')::numeric;
  v_c_reldist:= nullif(v_culture.culture_axes->>'relationship_distance', '')::numeric;
  v_c_hier   := nullif(v_culture.culture_axes->>'hierarchy_flatness', '')::numeric;

  if v_s_educ is null or v_s_chal is null or v_s_brand is null or v_s_collab is null
     or v_s_auto is null or v_s_flex is null or v_s_reldist is null or v_s_hier is null
     or v_c_educ is null or v_c_chal is null or v_c_brand is null or v_c_collab is null
     or v_c_auto is null or v_c_flex is null or v_c_reldist is null or v_c_hier is null then
    return jsonb_build_object('available', false, 'reason', 'axes_incomplete');
  end if;

  v_m_educ   := 100 - abs(v_s_educ - v_c_educ);
  v_m_chal   := 100 - abs(v_s_chal - v_c_chal);
  v_m_brand  := 100 - abs(v_s_brand - v_c_brand);
  v_m_collab := 100 - abs(v_s_collab - v_c_collab);
  v_m_auto   := 100 - abs(v_s_auto - v_c_auto);
  v_m_flex   := 100 - abs(v_s_flex - v_c_flex);
  v_m_reldist:= 100 - abs(v_s_reldist - v_c_reldist);
  v_m_hier   := 100 - abs(v_s_hier - v_c_hier);

  v_overall := (v_m_educ + v_m_chal + v_m_brand + v_m_collab + v_m_auto + v_m_flex + v_m_reldist + v_m_hier) / 8;

  return jsonb_build_object(
    'available', true,
    'overall_score', round(v_overall),
    'axis_scores', jsonb_build_object(
      'education', round(v_m_educ), 'challenge', round(v_m_chal),
      'personal_brand', round(v_m_brand), 'collaboration', round(v_m_collab),
      'autonomy', round(v_m_auto), 'work_flexibility', round(v_m_flex),
      'relationship_distance', round(v_m_reldist), 'hierarchy', round(v_m_hier)
    )
  );
end;
$$;
-- 内部専用関数。ガードを持たないため、呼び出し元（このファイル内の2つの
-- 公開RPC）以外へは一切grantしない（create_notificationと同じ方針）。
revoke all on function public.calculate_match_axes(uuid, uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. calculate_stylist_salon_match の再定義。
--    ガード（認証・stylist確認・target salon確認・PUBLIC確認）は0011から
--    一切変更していない。計算本体のみ calculate_match_axes への委譲に置換。
--    引数の型シグネチャ(uuid)は0011から変更していないため、0011で既に
--    付与済みのrevoke/grantがそのまま引き継がれる（再付与は不要）。
-- ----------------------------------------------------------------------------
create or replace function public.calculate_stylist_salon_match(
  p_salon_user_id uuid
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_stylist_uid uuid := auth.uid();
begin
  if v_stylist_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.user_roles where user_id = v_stylist_uid and role = 'stylist') then
    raise exception 'caller is not a stylist';
  end if;
  if not exists (select 1 from public.user_roles where user_id = p_salon_user_id and role = 'salon') then
    raise exception 'target is not a salon';
  end if;
  if not exists (select 1 from public.salon_profiles where user_id = p_salon_user_id and visibility = 'PUBLIC') then
    raise exception 'target salon is not public';
  end if;

  return public.calculate_match_axes(v_stylist_uid, p_salon_user_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. calculate_salon_stylist_match（新規）。上記と対称なガード。
--    同じ calculate_match_axes を呼ぶため、同じペアなら
--    calculate_stylist_salon_match と数値が完全一致する。
-- ----------------------------------------------------------------------------
create or replace function public.calculate_salon_stylist_match(
  p_stylist_user_id uuid
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_salon_uid uuid := auth.uid();
begin
  if v_salon_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.user_roles where user_id = v_salon_uid and role = 'salon') then
    raise exception 'caller is not a salon';
  end if;
  if not exists (select 1 from public.user_roles where user_id = p_stylist_user_id and role = 'stylist') then
    raise exception 'target is not a stylist';
  end if;
  if not exists (select 1 from public.stylist_profiles where user_id = p_stylist_user_id and visibility = 'PUBLIC') then
    raise exception 'target stylist is not public';
  end if;

  return public.calculate_match_axes(p_stylist_user_id, v_salon_uid);
end;
$$;
revoke all on function public.calculate_salon_stylist_match(uuid) from public, anon;
grant execute on function public.calculate_salon_stylist_match(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. scouts テーブル。
-- ----------------------------------------------------------------------------
create table public.scouts (
  id uuid primary key default gen_random_uuid(),
  salon_user_id uuid not null references auth.users(id) on delete cascade,
  stylist_user_id uuid not null references auth.users(id) on delete cascade,
  message text not null check (char_length(trim(message)) between 1 and 1000),
  template_type text check (template_type is null or template_type in ('casual','concrete')),
  matching_score integer check (matching_score is null or matching_score between 0 and 100),
  read_status text not null default 'unread' check (read_status in ('unread','read')),
  response_status text not null default 'no_response' check (
    response_status in ('no_response','interested','question','considering','declined','expired')
  ),
  response_message text check (response_message is null or char_length(response_message) <= 1000),
  sent_at timestamptz not null default now(),
  read_at timestamptz,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  constraint scouts_different_users check (salon_user_id <> stylist_user_id),
  -- 「条件をもう少し知りたい」はresponse_message必須（respond_scout RPC側の
  -- バリデーションに加え、defense in depthとしてDB制約でも強制する。
  -- 0022のsalary_offers_condition_required_if_additionと同じ方針）。
  constraint scouts_question_requires_message check (
    response_status <> 'question' or (response_message is not null and char_length(trim(response_message)) > 0)
  )
);
comment on table public.scouts is
  'サロンから美容師への個別スカウト。再スカウト可（salon_user_id×stylist_user_idのunique制約なし、1送信=1行として履歴を永続保存）。書き込みはsend_scout/mark_scout_read/respond_scout経由のみ。';
comment on column public.scouts.read_status is '美容師が開封したかどうか。response_statusとは独立（開封済みだが未回答、を表現するため）。';
comment on column public.scouts.response_status is '美容師の回答。no_response=未回答。expiredは将来の自動失効用に予約（Ver.1では書き込まない）。';

alter table public.scouts enable row level security;
create policy scouts_select_salon on public.scouts for select using (salon_user_id = auth.uid());
create policy scouts_select_stylist on public.scouts for select using (stylist_user_id = auth.uid());
-- Supabaseのdefault privilegesによる意図しない付与に備え、明示的に
-- revoke all → grant select のみ（0022のsalary_offersと同じ方針）。
revoke all on public.scouts from anon, authenticated;
grant select on public.scouts to authenticated;

-- ----------------------------------------------------------------------------
-- 5. salon_scout_quotas テーブル。salon_profilesとは別（課金系情報を
--    プロフィールに混在させない）。行が無いサロンはデフォルト値
--    （monthly_free_limit=10, additional_credits=0）として扱う
--    （send_scout側でcoalesce。Ver.1では書き込みRPCを用意しない＝
--    将来、管理ツールやプラン変更処理がこのテーブルへ行を
--    insert/upsertすることでサロンごとに上書きできる設計）。
-- ----------------------------------------------------------------------------
create table public.salon_scout_quotas (
  salon_user_id uuid primary key references auth.users(id) on delete cascade,
  monthly_free_limit integer not null default 10 check (monthly_free_limit >= 0),
  additional_credits integer not null default 0 check (additional_credits >= 0),
  updated_at timestamptz not null default now()
);
comment on table public.salon_scout_quotas is
  'サロンごとの月間スカウト送信枠。salon_profilesとは別テーブル。行が存在しない場合はデフォルト値として扱う（send_scout側でcoalesce）。使用数はscouts.sent_atを当月分集計して都度算出し、専用カウンタ列は持たない。Ver.1では追加枠購入の実処理は行わない。';

alter table public.salon_scout_quotas enable row level security;
create policy salon_scout_quotas_select_own on public.salon_scout_quotas for select using (salon_user_id = auth.uid());
revoke all on public.salon_scout_quotas from anon, authenticated;
grant select on public.salon_scout_quotas to authenticated;
create trigger trg_salon_scout_quotas_updated before update on public.salon_scout_quotas for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 6. get_public_stylists_for_scout: サロンが閲覧できる「スカウト対象」
--    美容師一覧。対象条件は role=stylist AND stylist_profiles.visibility=
--    'PUBLIC' AND coalesce(user_settings.scout_enabled, true)=true。
--    stylist_profilesには本人以外へのSELECTポリシーが無いため
--    （0001時点でstylist_profiles_select_ownのみ）、salon_profilesのように
--    RLSポリシー追加で対応せず、SECURITY DEFINER RPC経由の一覧取得のみを
--    唯一の閲覧経路とする（user_settingsのRLSも一切緩めない）。
--    matchはcalculate_match_axesを1スタイリストにつき1回だけ計算し
--    （candidates CTE内）、jsonbフィールドと並び順の両方に使い回す。
-- ----------------------------------------------------------------------------
create or replace function public.get_public_stylists_for_scout()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_salon_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_salon_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.user_roles where user_id = v_salon_uid and role = 'salon') then
    raise exception 'caller is not a salon';
  end if;

  with candidates as (
    select
      sp.user_id as stylist_user_id,
      sp.public_name, sp.prefecture, sp.desired_work_location, sp.experience_years,
      sp.current_position, sp.specialties, sp.job_change_intent, sp.bio,
      public.calculate_match_axes(sp.user_id, v_salon_uid) as match,
      prev_interest.created_at as previous_interest_at,
      coalesce(prev_scout.cnt, 0) as previous_scout_count,
      prev_scout.last_sent_at as previous_scout_last_sent_at
    from public.stylist_profiles sp
    join public.user_roles ur on ur.user_id = sp.user_id and ur.role = 'stylist'
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
  )
  select coalesce(jsonb_agg(jsonb_build_object(
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
  ) order by coalesce((match->>'overall_score')::numeric, -1) desc), '[]'::jsonb)
  into v_result
  from candidates;

  return v_result;
end;
$$;
comment on function public.get_public_stylists_for_scout() is
  'サロン本人へ、スカウト対象（role=stylist・visibility=PUBLIC・scout_enabled）の美容師一覧を、相性が高い順に返す。本名・メール・年齢・性別・給与希望・SNSは返さない。';
revoke all on function public.get_public_stylists_for_scout() from public, anon;
grant execute on function public.get_public_stylists_for_scout() to authenticated;

-- ----------------------------------------------------------------------------
-- 7. send_scout: スカウト送信の唯一の経路。role guard・対象確認・
--    scout_enabled確認・月間枠チェック・matching_score算出・insertを
--    1トランザクション（関数内）で行う。再スカウトは常に新しい行として
--    insertする（unique制約なし・on conflictなし）。
--
-- ★quota race condition対策（監査指摘への修正）: 「当月件数をcount→枠確認→
-- insert」の間に行ロックが無いと、同一サロンからの同時送信で枠を超過できて
-- しまう（TOCTOU）。これを防ぐため、salon_scout_quotasの当該サロン行を
-- 「サロン単位のロック行」として使う。
--   1. insert ... on conflict do nothing でdefault行を必ず用意する
--      （on conflictはinsert自体がatomicなため、複数リクエストが同時に
--      実行してもこの手順自体で行が重複作成されることはない）。
--   2. その行をselect ... for updateでロックする。
--   3. ロック取得後（＝同一サロンの先行トランザクションが完了した後）に
--      当月scouts件数をcountする。
--   4. monthly_free_limit + additional_credits と比較する。
--   5. 枠があればscoutsをinsertする。
-- ロックはsalon_user_id単位（行単位）のため、サロンA・サロンBが互いの
-- ロック待ちで詰まることはない（別行なのでfor updateが競合しない）。
-- アプリ側（Server Action側）では一切防止していない。DB/RPC側のみで保証する。
-- ----------------------------------------------------------------------------
create or replace function public.send_scout(
  p_stylist_user_id uuid,
  p_message text,
  p_template_type text default null
) returns public.scouts
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_salon_uid uuid := auth.uid();
  v_message text := nullif(trim(coalesce(p_message, '')), '');
  v_limit integer;
  v_credits integer;
  v_used integer;
  v_match jsonb;
  v_score integer;
  v_row public.scouts;
begin
  if v_salon_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.user_roles where user_id = v_salon_uid and role = 'salon') then
    raise exception 'caller is not a salon';
  end if;
  if not exists (select 1 from public.user_roles where user_id = p_stylist_user_id and role = 'stylist') then
    raise exception 'target is not a stylist';
  end if;
  if not exists (select 1 from public.stylist_profiles where user_id = p_stylist_user_id and visibility = 'PUBLIC') then
    raise exception 'target stylist is not public';
  end if;
  if exists (select 1 from public.user_settings where user_id = p_stylist_user_id and scout_enabled = false) then
    raise exception 'target stylist has scouting disabled';
  end if;

  if v_message is null then raise exception 'message required'; end if;
  if char_length(v_message) > 1000 then raise exception 'message too long'; end if;
  if p_template_type is not null and p_template_type not in ('casual','concrete') then
    raise exception 'invalid template type';
  end if;

  -- 月間枠: salon_scout_quotasに行が無いサロンのためにdefault行
  -- （monthly_free_limit=10, additional_credits=0、列のデフォルト値）を
  -- 用意してから、その行をfor updateでロックする。これにより同一サロンから
  -- 同時に送信されたsend_scoutは、後続の呼び出しがこのロック取得の時点で
  -- 直列化される（先行トランザクションのcommit/rollbackまで待たされる）。
  insert into public.salon_scout_quotas (salon_user_id) values (v_salon_uid)
  on conflict (salon_user_id) do nothing;

  select monthly_free_limit, additional_credits into v_limit, v_credits
  from public.salon_scout_quotas where salon_user_id = v_salon_uid
  for update;

  -- 使用数は専用カウンタ列を持たず、当月分のscouts.sent_atを都度集計する
  -- （再スカウトも1回の使用としてカウントされる）。ロック取得後に数える
  -- ため、直前に確定した同一サロンの送信も必ずこのcountへ反映される。
  select count(*) into v_used from public.scouts
  where salon_user_id = v_salon_uid and sent_at >= date_trunc('month', now());

  if v_used >= (v_limit + v_credits) then
    raise exception 'monthly scout limit reached';
  end if;

  v_match := public.calculate_match_axes(p_stylist_user_id, v_salon_uid);
  v_score := case when (v_match->>'available')::boolean then (v_match->>'overall_score')::numeric::integer else null end;

  insert into public.scouts (salon_user_id, stylist_user_id, message, template_type, matching_score)
  values (v_salon_uid, p_stylist_user_id, v_message, p_template_type, v_score)
  returning * into v_row;

  return v_row;
end;
$$;
revoke all on function public.send_scout(uuid, text, text) from public, anon;
grant execute on function public.send_scout(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 8. mark_scout_read: 美容師本人が自分宛のスカウトを開封したときに呼ぶ。
--    既読は取り消せない（read_atはcoalesceで初回のみ設定）。
-- ----------------------------------------------------------------------------
create or replace function public.mark_scout_read(p_scout_id uuid)
returns public.scouts
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.scouts;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  update public.scouts
  set read_status = 'read', read_at = coalesce(read_at, now())
  where id = p_scout_id and stylist_user_id = v_uid
  returning * into v_row;

  if v_row.id is null then raise exception 'scout not found'; end if;
  return v_row;
end;
$$;
revoke all on function public.mark_scout_read(uuid) from public, anon;
grant execute on function public.mark_scout_read(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 9. respond_scout: 美容師本人の4択回答（interested/question/considering/
--    declined）。questionはresponse_message必須。response_status='no_response'
--    の行にのみ回答でき（二重回答防止、salary_offersのstatus='pending'ゲート
--    と同じ方針）、回答と同時にread_statusもreadへ確定させる。
-- ----------------------------------------------------------------------------
create or replace function public.respond_scout(
  p_scout_id uuid,
  p_response text,
  p_response_message text default null
) returns public.scouts
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_message text := nullif(trim(coalesce(p_response_message, '')), '');
  v_row public.scouts;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_response is null or p_response not in ('interested','question','considering','declined') then
    raise exception 'invalid response';
  end if;
  if p_response = 'question' and v_message is null then
    raise exception 'response message required';
  end if;
  if v_message is not null and char_length(v_message) > 1000 then
    raise exception 'response message too long';
  end if;

  update public.scouts
  set response_status = p_response,
      response_message = v_message,
      responded_at = now(),
      read_status = 'read',
      read_at = coalesce(read_at, now())
  where id = p_scout_id and stylist_user_id = v_uid and response_status = 'no_response'
  returning * into v_row;

  if v_row.id is null then raise exception 'scout not found or already responded'; end if;
  return v_row;
end;
$$;
revoke all on function public.respond_scout(uuid, text, text) from public, anon;
grant execute on function public.respond_scout(uuid, text, text) to authenticated;

commit;
