-- ============================================================================
-- 0056: 「サロンらしさ」5軸分析用の追加回答（追加5問 q13〜q17）の保存先
-- ============================================================================
-- ★この変更は「追加」のみ。既存の表・関数・回答・8軸(culture_axes)・サロンタイプ・AI紹介文・
--   マッチングには一切触れない（0001〜0055 は変更しない）。旧アプリは新しい表・関数を呼ばないため影響を受けない。
--
-- 目的:
--   既存の12問（salon_culture_profiles / salon_store_culture_profiles、保存値・意味は無変更）では
--   5軸分析に必要な回答が足りない。不足分の5問（q13〜q17）の回答だけを、既存の行とは別の表に保存する。
--   旧回答を新質問へ推測変換しない（q13〜q17 は回答されるまで「未回答」）。
--
-- 設計:
--   * 1行 = 「本人（salon_user_id）」または「店舗（store_id）」のどちらか一方の、ある分析版（analysis_version）の追加回答。
--     本人と店舗は混ぜない（CHECKで「どちらか一方のみ」）。(所有者, 版) は一意。自動同期はしない。
--   * 分析版: 'salon-analysis-v1'。質問・段階規則を変える場合は新しい版を作り、旧版の行は変更しない。
--   * 追加回答を保存した時点の、既存12問のうち5軸の計算に使う5問(q2,q3,q4,q5,q9)の回答を、サーバー側で
--     既存の行から読み取って base_snapshot に写す（クライアントの値を保存元にしない）。
--     表示側は「現在の既存回答」と base_snapshot を比べ、違う場合は「古い」と判定して五角形を描かない。
--   * フォーム表示後に既存12問が更新された場合に備え、保存RPCは「フォームが参照した既存5問(p_expected_base)」を
--     受け取り、保存時点のサーバー上の値と比較する。1つでも違えば 'base answers changed' で拒否する
--     （古い画面で答えた追加5問を、新しい既存回答へ黙って紐付けない）。p_expected_base は比較にだけ使い、保存しない。
--   * 回答値は 1〜5 の整数、または文字列 'na'（その場面が当てはまらない）。'na' は数値で補完せず、その軸は判定不可とする。
--   * 5問すべてに回答（または 'na'）した時点でのみ保存できる（途中保存なし）。
--   * 既存12問が「完了(completed)」でないと保存できない。
--
-- 権限:
--   テーブル: RLS有効。SELECTのみ（本人の行 / アクセス可能な店舗の行）。INSERT/UPDATE/DELETEのポリシーもGRANTも無い。
--             public・anon・authenticated・service_role から全REVOKEし、authenticated にSELECTだけ GRANT。
--   店舗の保存: 閲覧専用(store_members.role = 'viewer')は保存できない。判定は既存の write 権限
--     can_manage_store_hiring(0037) を再利用する（company_owner/company_admin/recruiting_admin=所属会社の全店舗、
--     area_manager=担当店舗として割当のある店舗のみ、store_manager・recruiter=その店舗。viewerは含まない）。
--     is_store_accessible は読み取り(SELECTポリシー・閲覧)用として維持する。判定は can_edit_store_culture_analysis に
--     1か所にまとめ、将来、規則を変える場合はこの関数だけを差し替える。
--   関数: すべて SECURITY DEFINER（補助関数を除く）、search_path固定。各関数について
--     public・anon・authenticated・service_role から一度 REVOKE し、必要な EXECUTE だけを authenticated に GRANT する。
--   全体GRANT・RLS無効化・ALTER DEFAULT PRIVILEGES は使わない。
--
-- 退会との関係:
--   salon_user_id / store_id は、所有者が消えればこの行も意味を失うため on delete cascade
--   （既存の salon_culture_profiles / salon_store_culture_profiles と同じ）。
--   respondent_user_id（実際に回答した人）は、既存の帰属列(created_by_user_id 0032、reviewed_by 0021、verified_by 0022)と同じく
--   on delete set null。回答者が退会しても、その退会を妨げず、店舗の回答は残る。
-- ============================================================================

begin;

create table public.salon_culture_analysis_answers (
  id                 uuid        primary key default gen_random_uuid(),
  analysis_version   text        not null check (analysis_version ~ '^[a-z0-9][a-z0-9._-]{0,62}$'),
  -- 所有者: 本人 または 店舗（どちらか一方のみ）
  salon_user_id      uuid        references public.profiles(id) on delete cascade,
  store_id           uuid        references public.salon_stores(id) on delete cascade,
  -- 追加回答: {"q13_...": 1〜5 または "na", ...}（キーと値はRPCが検証する）
  answers            jsonb       not null check (jsonb_typeof(answers) = 'object'),
  -- 保存時点の既存回答（q2,q3,q4,q5,q9）の写し。サーバー側が既存の行から読み取る。
  base_snapshot      jsonb       not null check (jsonb_typeof(base_snapshot) = 'object'),
  -- 実際に回答した人。退会しても行は残す（set null）。
  respondent_user_id uuid        references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint salon_culture_analysis_answers_one_owner
    check ((salon_user_id is not null)::int + (store_id is not null)::int = 1)
);
comment on table public.salon_culture_analysis_answers is
  '「サロンらしさ」5軸分析の追加回答（q13〜q17）。本人(salon_user_id)または店舗(store_id)のどちらか一方×分析版で1行。既存12問の行・8軸には触れない。書き込みは save_salon_culture_analysis_answers / save_salon_store_culture_analysis_answers のみ。base_snapshot は保存時点の既存回答(q2,q3,q4,q5,q9)の写しで、現在の既存回答と違えば表示側が「古い」と判定する。';

create unique index salon_culture_analysis_answers_user_version_uidx
  on public.salon_culture_analysis_answers (salon_user_id, analysis_version)
  where salon_user_id is not null;
create unique index salon_culture_analysis_answers_store_version_uidx
  on public.salon_culture_analysis_answers (store_id, analysis_version)
  where store_id is not null;
create index salon_culture_analysis_answers_respondent_idx
  on public.salon_culture_analysis_answers (respondent_user_id)
  where respondent_user_id is not null;

create trigger trg_salon_culture_analysis_answers_updated
  before update on public.salon_culture_analysis_answers
  for each row execute function public.set_updated_at();

alter table public.salon_culture_analysis_answers enable row level security;

-- 読み取りのみ。本人の行、またはアクセス可能な店舗の行（閲覧専用も読める）。
create policy salon_culture_analysis_answers_select on public.salon_culture_analysis_answers
  for select to authenticated
  using (
    salon_user_id = auth.uid()
    or (store_id is not null and public.is_store_accessible(store_id))
  );

revoke all on table public.salon_culture_analysis_answers from public, anon, authenticated, service_role;
grant select on table public.salon_culture_analysis_answers to authenticated;

-- ----------------------------------------------------------------------------
-- 内部: 追加回答の検証・正規化（版ごとに許可するキーと値を固定）。公開しない。
-- ----------------------------------------------------------------------------
create or replace function public._salon_analysis_normalize_answers(p_version text, p_answers jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_keys text[];
  v_key text;
  v_val jsonb;
  v_out jsonb := '{}'::jsonb;
  v_num numeric;
begin
  if p_version = 'salon-analysis-v1' then
    v_keys := array[
      'q13_nurture_learning_flow',
      'q14_nurture_feedback',
      'q15_brand_staff_presentation',
      'q16_team_handover',
      'q17_discretion_proposal'
    ];
  else
    raise exception 'unsupported analysis version';
  end if;

  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'invalid answers';
  end if;

  -- 余分なキーは拒否する（未知のキーを黙って捨てない）。
  if exists (select 1 from jsonb_object_keys(p_answers) k where k <> all (v_keys)) then
    raise exception 'invalid answers';
  end if;

  foreach v_key in array v_keys loop
    v_val := p_answers -> v_key;
    if v_val is null then
      raise exception 'invalid answers';   -- 5問すべて必須（回答または 'na'）
    end if;
    if jsonb_typeof(v_val) = 'string' and (v_val #>> '{}') = 'na' then
      v_out := v_out || jsonb_build_object(v_key, 'na');
    elsif jsonb_typeof(v_val) = 'number' then
      v_num := (v_val #>> '{}')::numeric;
      if v_num <> floor(v_num) or v_num < 1 or v_num > 5 then
        raise exception 'invalid answers';
      end if;
      v_out := v_out || jsonb_build_object(v_key, v_num::integer);
    else
      raise exception 'invalid answers';
    end if;
  end loop;

  return v_out;
end;
$$;
revoke all on function public._salon_analysis_normalize_answers(text, jsonb) from public, anon, authenticated, service_role;

-- 内部: 既存回答（または、フォームが参照した値）から5軸に使う5問を取り出す。
-- 1〜5の整数でなければ、呼び出し側が指定したメッセージで拒否する。
create or replace function public._salon_analysis_base_snapshot(p_base_answers jsonb, p_error text)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_keys text[] := array[
    'q2_challenge_openness',
    'q3_personal_brand_support',
    'q4_team_collaboration',
    'q5_individual_autonomy',
    'q9_trend_orientation'
  ];
  v_key text;
  v_val jsonb;
  v_num numeric;
  v_out jsonb := '{}'::jsonb;
begin
  if p_base_answers is null or jsonb_typeof(p_base_answers) <> 'object' then
    raise exception '%', p_error;
  end if;
  foreach v_key in array v_keys loop
    v_val := p_base_answers -> v_key;
    if v_val is null or jsonb_typeof(v_val) <> 'number' then
      raise exception '%', p_error;
    end if;
    v_num := (v_val #>> '{}')::numeric;
    if v_num <> floor(v_num) or v_num < 1 or v_num > 5 then
      raise exception '%', p_error;
    end if;
    v_out := v_out || jsonb_build_object(v_key, v_num::integer);
  end loop;
  return v_out;
end;
$$;
revoke all on function public._salon_analysis_base_snapshot(jsonb, text) from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 店舗の追加回答を「保存できるか」。閲覧専用は不可。既存の write 権限 can_manage_store_hiring(0037) を再利用する。
--   can_manage_store_hiring: ログイン済み・salon role・かつ
--     A) 所属会社の company_owner / company_admin / recruiting_admin
--     B) area_manager で、その店舗の store_members 割当がある
--     C) その店舗の store_manager / recruiter
--   （store_members.role = 'viewer' だけの担当者は含まれない）
-- 画面の表示切り替え（保存ボタンを出すか）にも使うため、authenticated に EXECUTE を付ける。
-- ----------------------------------------------------------------------------
create or replace function public.can_edit_store_culture_analysis(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_store_id is not null and public.can_manage_store_hiring(p_store_id);
$$;
revoke all on function public.can_edit_store_culture_analysis(uuid) from public, anon, authenticated, service_role;
grant execute on function public.can_edit_store_culture_analysis(uuid) to authenticated;
comment on function public.can_edit_store_culture_analysis is
  '店舗の5軸分析・追加回答を保存できるか（閲覧専用は不可）。現在は既存の write 権限 can_manage_store_hiring(0037) に委ねる。規則を変える場合はこの関数だけを差し替える。';

-- ----------------------------------------------------------------------------
-- 本人用の保存
--   p_expected_base: フォームが参照した既存5問の値（比較専用。保存しない）。
-- ----------------------------------------------------------------------------
create or replace function public.save_salon_culture_analysis_answers(
  p_version text,
  p_answers jsonb,
  p_expected_base jsonb
) returns public.salon_culture_analysis_answers
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_answers jsonb;
  v_expected jsonb;
  v_base public.salon_culture_profiles;
  v_snapshot jsonb;
  v_row public.salon_culture_analysis_answers;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if not exists (select 1 from public.user_roles where user_id = v_uid and role = 'salon') then
    raise exception 'caller is not a salon';
  end if;

  v_answers  := public._salon_analysis_normalize_answers(p_version, p_answers);
  v_expected := public._salon_analysis_base_snapshot(p_expected_base, 'invalid expected base');

  -- 既存12問（本人の行）。完了していなければ保存しない。保存中に書き換えられないよう共有ロックする。
  select * into v_base from public.salon_culture_profiles where salon_user_id = v_uid for share;
  if not found or v_base.status <> 'completed' then
    raise exception 'base profile not completed';
  end if;
  v_snapshot := public._salon_analysis_base_snapshot(v_base.answers, 'base profile not completed');

  -- フォーム表示後に既存12問が更新されていれば、古い画面の回答を新しい既存回答へ紐付けない。
  if v_snapshot is distinct from v_expected then
    raise exception 'base answers changed';
  end if;

  insert into public.salon_culture_analysis_answers (
    analysis_version, salon_user_id, answers, base_snapshot, respondent_user_id
  ) values (
    p_version, v_uid, v_answers, v_snapshot, v_uid
  )
  on conflict (salon_user_id, analysis_version) where salon_user_id is not null
  do update set
    answers            = excluded.answers,
    base_snapshot      = excluded.base_snapshot,
    respondent_user_id = excluded.respondent_user_id
  returning * into v_row;

  return v_row;
end;
$$;
revoke all on function public.save_salon_culture_analysis_answers(text, jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.save_salon_culture_analysis_answers(text, jsonb, jsonb) to authenticated;
comment on function public.save_salon_culture_analysis_answers is
  '本人の5軸分析・追加回答(q13〜q17)の保存。サロンroleを持つ本人のみ。既存12問が完了済みであること。保存時点の既存回答(q2,q3,q4,q5,q9)をサーバー側で写す。フォームが参照した既存5問(p_expected_base)とサーバー上の値が違えば拒否する。既存の行・8軸・AI紹介文には触れない。';

-- ----------------------------------------------------------------------------
-- 店舗用の保存（編集権限が必要。閲覧専用は不可）
-- ----------------------------------------------------------------------------
create or replace function public.save_salon_store_culture_analysis_answers(
  p_store_id uuid,
  p_version text,
  p_answers jsonb,
  p_expected_base jsonb
) returns public.salon_culture_analysis_answers
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_answers jsonb;
  v_expected jsonb;
  v_base public.salon_store_culture_profiles;
  v_snapshot jsonb;
  v_row public.salon_culture_analysis_answers;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if not exists (select 1 from public.user_roles where user_id = v_uid and role = 'salon') then
    raise exception 'caller is not a salon';
  end if;
  -- 存在しない店舗・アクセス権が無い店舗は、同じメッセージで拒否する（存在有無を漏らさない）。
  if p_store_id is null or not public.is_store_accessible(p_store_id) then
    raise exception 'store not found or not accessible';
  end if;
  -- 閲覧は可能だが、編集権限が無い（閲覧専用など）。
  if not public.can_edit_store_culture_analysis(p_store_id) then
    raise exception 'not allowed to edit this store';
  end if;

  v_answers  := public._salon_analysis_normalize_answers(p_version, p_answers);
  v_expected := public._salon_analysis_base_snapshot(p_expected_base, 'invalid expected base');

  select * into v_base from public.salon_store_culture_profiles where store_id = p_store_id for share;
  if not found or v_base.status <> 'completed' then
    raise exception 'base profile not completed';
  end if;
  v_snapshot := public._salon_analysis_base_snapshot(v_base.answers, 'base profile not completed');

  if v_snapshot is distinct from v_expected then
    raise exception 'base answers changed';
  end if;

  insert into public.salon_culture_analysis_answers (
    analysis_version, store_id, answers, base_snapshot, respondent_user_id
  ) values (
    p_version, p_store_id, v_answers, v_snapshot, v_uid
  )
  on conflict (store_id, analysis_version) where store_id is not null
  do update set
    answers            = excluded.answers,
    base_snapshot      = excluded.base_snapshot,
    respondent_user_id = excluded.respondent_user_id
  returning * into v_row;

  return v_row;
end;
$$;
revoke all on function public.save_salon_store_culture_analysis_answers(uuid, text, jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.save_salon_store_culture_analysis_answers(uuid, text, jsonb, jsonb) to authenticated;
comment on function public.save_salon_store_culture_analysis_answers is
  '店舗の5軸分析・追加回答(q13〜q17)の保存。サロンroleを持ち、店舗にアクセスでき、かつ編集権限(can_edit_store_culture_analysis。閲覧専用は不可)がある場合のみ。既存の店舗12問が完了済みであること。フォームが参照した既存5問とサーバー上の値が違えば拒否する。本人用の行には触れない。';

commit;
