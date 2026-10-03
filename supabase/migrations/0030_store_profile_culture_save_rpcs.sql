-- ============================================================================
-- Beauty Reach — 0030_store_profile_culture_save_rpcs
--
-- 法人・複数店舗対応 Phase 3B。0029で新設した店舗単位テーブル
-- （salon_store_profiles / salon_store_culture_profiles）へ、初めて
-- 書き込みを行うSECURITY DEFINER RPCを2つ新設する。
--
-- ★既存save_salon_profile()/save_salon_culture_profile()は一切変更しない。
--   新RPCはこれらを内部から呼び出さない（循環・二重副作用を避けるため、
--   旧テーブルへの同期に必要なUPDATE/UPSERTをこのRPC自身が直接行う）。
--
-- ★最重要の互換ルール（ユーザー指定・修正版）:
--   salon_onboarding_assignments.store_id と一致する「初期店舗」への
--   保存のみ、同一トランザクション内で旧salon_profiles/salon_culture_profiles
--   にも同期する。2店舗目以降（salon_onboarding_assignmentsに行を持たない
--   store_id）は新テーブルのみを正とし、旧テーブルは絶対に触らない。
--
--   ★「誰が編集できるか」と「どの旧salon_user_idへ同期するか」を完全に
--   分離する。初期店舗の判定は p_store_id のみを条件にする
--   （`select user_id from salon_onboarding_assignments where store_id =
--   p_store_id`。user_id = auth.uid() の条件は付けない）。これにより、
--   GVのcompany_owner本人だけでなく、is_store_accessible()で正当に
--   アクセスできるcompany_admin/recruiting_admin/area_manager/
--   store_manager/recruiter等の別ユーザーが初期店舗を編集した場合でも、
--   その店舗が初期店舗である限り旧テーブルへの同期が行われる
--   （同期先の旧salon_user_idは常にsalon_onboarding_assignments.user_id
--   ＝初期オンボーディングを行った本人であり、呼び出し者自身のauth.uid()
--   ではない）。新テーブルへの書き込み権限自体は従来通り
--   auth.uid() + is_store_accessible(p_store_id) でのみ判定する。
--   legacy_salon_user_idは使わない（Phase 3Aのbackfillと同じ方針）。
--
-- ★既存migration(0001〜0029)は一切編集していない。
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. save_salon_store_profile(): 店舗単位プロフィール保存の唯一の経路。
--
-- 既存save_salon_profile()（0028時点）の検証・正規化ロジック
-- （hotpepper_urlの正規表現検証、city/street_address/culture_description/bio
-- のtrim+nullif正規化）をそのまま再利用している。差分は:
--   ・書き込み先がuser_id起点ではなくstore_id起点（salon_store_profiles）。
--   ・profiles(avatar_path/onboarding_step/profile_version)は更新しない
--     （店舗単位の保存はオンボーディング完了状態に影響しない）。
--   ・instagram_handle/avatar_pathは引数に持たない（0029で新テーブルに
--     含めていない列のため）。
--   ・認可はauth.uid()所有ではなくis_store_accessible(p_store_id)で行う
--     （0026のRLSと同じ単一の判定関数を使い、権限ロジックを複製しない）。
-- ----------------------------------------------------------------------------
create or replace function public.save_salon_store_profile(
  p_store_id             uuid,
  p_salon_name           text,
  p_visibility           public.profile_visibility,
  p_prefecture           text,
  p_city                 text,
  p_street_address       text,
  p_culture_description  text,
  p_employee_size_code   text,
  p_target_specialties   text[],
  p_bio                  text,
  p_hotpepper_url        text default null
) returns public.salon_store_profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.salon_store_profiles;
  v_hotpepper_url text := nullif(trim(p_hotpepper_url), '');
  v_legacy_salon_user_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- ★role guard（既存add_salon_photo()等と同じ防御パターン）。
  -- is_store_accessible()はorganization_members/store_membersの行の有無で
  -- 判定するため、salon role以外のユーザーがこれらの行を持つことは本来
  -- 無いはずだが、RPC自身にも明示的なguardを持たせる（多重防御）。
  if not exists (
    select 1 from public.user_roles where user_id = v_uid and role = 'salon'
  ) then
    raise exception 'caller is not a salon';
  end if;

  -- ★認可の唯一の判定根拠。0026のsalon_stores RLSポリシーが使う関数と
  -- 完全に同一のものを呼ぶ（権限ロジックの複製をしない）。
  if not public.is_store_accessible(p_store_id) then
    raise exception 'store not found or not accessible';
  end if;

  if v_hotpepper_url is not null and v_hotpepper_url !~ '^https://beauty\.hotpepper\.jp/.+$' then
    raise exception 'invalid hotpepper_url: must be an https://beauty.hotpepper.jp/ URL';
  end if;

  insert into public.salon_store_profiles (
    store_id, salon_name, visibility, prefecture, city, street_address,
    culture_description, employee_size_code, target_specialties, bio, hotpepper_url
  ) values (
    p_store_id, p_salon_name, p_visibility, p_prefecture, nullif(trim(p_city), ''),
    nullif(trim(p_street_address), ''), nullif(trim(p_culture_description), ''),
    p_employee_size_code, p_target_specialties, nullif(trim(p_bio), ''), v_hotpepper_url
  )
  on conflict (store_id) do update set
    salon_name           = excluded.salon_name,
    visibility            = excluded.visibility,
    prefecture            = excluded.prefecture,
    city                  = excluded.city,
    street_address        = excluded.street_address,
    culture_description   = excluded.culture_description,
    employee_size_code    = excluded.employee_size_code,
    target_specialties    = excluded.target_specialties,
    bio                   = excluded.bio,
    hotpepper_url         = excluded.hotpepper_url
  returning * into v_row;

  -- ★初期店舗の場合のみ、旧salon_profilesへ同期する。判定はp_store_idのみ
  -- （「誰が編集したか」ではなく「どの店舗か」で判定。GV本人以外の正規
  -- アクセスユーザーが編集した場合も同期されるようにするため）。
  -- salon_onboarding_assignments.store_id = p_store_id の行が示す
  -- user_id（＝初回オンボーディングを行った本人）が、同期先の旧
  -- salon_profiles.user_idになる。この行が存在する店舗には、
  -- save_salon_profile()(0028)により対応するsalon_profiles行が必ず
  -- 既に存在するため、INSERTではなくUPDATEで十分（旧save_salon_profile()
  -- をここから再度呼ぶことはしない＝循環・profiles側のonboarding_step/
  -- profile_version更新等の無関係な副作用を避ける）。
  select user_id into v_legacy_salon_user_id
    from public.salon_onboarding_assignments
    where store_id = p_store_id;

  if v_legacy_salon_user_id is not null then
    update public.salon_profiles
      set salon_name           = p_salon_name,
          visibility            = p_visibility,
          prefecture            = p_prefecture,
          city                  = nullif(trim(p_city), ''),
          street_address        = nullif(trim(p_street_address), ''),
          culture_description   = nullif(trim(p_culture_description), ''),
          employee_size_code    = p_employee_size_code,
          target_specialties    = p_target_specialties,
          bio                   = nullif(trim(p_bio), ''),
          hotpepper_url         = v_hotpepper_url
      where user_id = v_legacy_salon_user_id;
  end if;

  return v_row;
end;
$$;
comment on function public.save_salon_store_profile is '店舗単位プロフィール保存の唯一の経路（法人・複数店舗対応 Phase 3B）。SECURITY DEFINER。書き込み権限の認可はauth.uid()とis_store_accessible(p_store_id)のみで判定し、権限ロジックを複製しない。旧salon_profilesへの同期対象は「誰が編集したか」ではなく「p_store_idがsalon_onboarding_assignmentsに示す初期店舗かどうか」のみで判定する（同期先user_idは常にsalon_onboarding_assignments.user_id＝初回オンボーディングを行った本人。company_admin/area_manager/store_manager等、本人以外の正規アクセスユーザーが編集した場合も同期される）。同期はUPDATEのみ（INSERTはしない。初期店舗には必ず既存行があるため）。2店舗目以降（salon_onboarding_assignmentsに行が無いstore_id）は旧salon_profilesを一切更新しない。既存save_salon_profile()は変更していない（内部から呼び出してもいない）。';

revoke all on function public.save_salon_store_profile(
  uuid, text, public.profile_visibility, text, text, text, text, text, text[], text, text
) from public, anon;
grant execute on function public.save_salon_store_profile(
  uuid, text, public.profile_visibility, text, text, text, text, text, text[], text, text
) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. save_salon_store_culture_profile(): 店舗単位カルチャー診断保存の
-- 唯一の経路。
--
-- 既存save_salon_culture_profile()（0009時点、新12軸・5段階評価）の
-- culture_axes算出ロジック・ルールベースai_summary生成ロジックを
-- そのまま再現している（引数・計算式ともに変更していない。生成AIによる
-- 解説生成はPhase 4以降で別途対応し、今回はルールベースの簡易生成のまま）。
-- 所有キーはsalon_user_idではなくstore_id。回答者個人はrespondent_user_id
-- （= auth.uid()）に保持する。
-- ----------------------------------------------------------------------------
create or replace function public.save_salon_store_culture_profile(
  p_store_id uuid,
  p_status public.salon_culture_status,
  p_respondent_role public.salon_culture_respondent_role,
  p_current_step integer,
  p_answers jsonb,
  p_value_priorities text[],
  p_comment text
) returns public.salon_store_culture_profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_axes jsonb;
  v_top_label text;
  v_summary text;
  v_row public.salon_store_culture_profiles;
  v_legacy_salon_user_id uuid;

  v_a1 numeric; v_a2 numeric; v_a3 numeric; v_a4 numeric;
  v_a5 numeric; v_a6 numeric; v_a7 numeric; v_a8 numeric;
  v_a9 numeric; v_a10 numeric; v_a11 numeric; v_a12 numeric;

  v_educ numeric; v_chal numeric; v_brand numeric; v_team numeric;
  v_auto numeric; v_flex numeric; v_tech numeric; v_prem numeric;
  v_trend numeric; v_creative numeric; v_reldist numeric; v_hier numeric;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1 from public.user_roles where user_id = v_uid and role = 'salon'
  ) then
    raise exception 'caller is not a salon';
  end if;

  if not public.is_store_accessible(p_store_id) then
    raise exception 'store not found or not accessible';
  end if;

  -- ★以下、culture_axes算出・ルールベースai_summary生成は0009の
  -- save_salon_culture_profile()と完全に同一のロジック（変数名・計算式を
  -- 含め変更していない）。
  v_a1  := nullif((p_answers->>'q1_education_support'), '')::numeric;
  v_a2  := nullif((p_answers->>'q2_challenge_openness'), '')::numeric;
  v_a3  := nullif((p_answers->>'q3_personal_brand_support'), '')::numeric;
  v_a4  := nullif((p_answers->>'q4_team_collaboration'), '')::numeric;
  v_a5  := nullif((p_answers->>'q5_individual_autonomy'), '')::numeric;
  v_a6  := nullif((p_answers->>'q6_work_flexibility'), '')::numeric;
  v_a7  := nullif((p_answers->>'q7_technical_specialization'), '')::numeric;
  v_a8  := nullif((p_answers->>'q8_premium_value'), '')::numeric;
  v_a9  := nullif((p_answers->>'q9_trend_orientation'), '')::numeric;
  v_a10 := nullif((p_answers->>'q10_creative_output'), '')::numeric;
  v_a11 := nullif((p_answers->>'q11_relationship_distance'), '')::numeric;
  v_a12 := nullif((p_answers->>'q12_hierarchy_flatness'), '')::numeric;

  if v_a1  is not null and (v_a1  < 1 or v_a1  > 5) then v_a1  := null; end if;
  if v_a2  is not null and (v_a2  < 1 or v_a2  > 5) then v_a2  := null; end if;
  if v_a3  is not null and (v_a3  < 1 or v_a3  > 5) then v_a3  := null; end if;
  if v_a4  is not null and (v_a4  < 1 or v_a4  > 5) then v_a4  := null; end if;
  if v_a5  is not null and (v_a5  < 1 or v_a5  > 5) then v_a5  := null; end if;
  if v_a6  is not null and (v_a6  < 1 or v_a6  > 5) then v_a6  := null; end if;
  if v_a7  is not null and (v_a7  < 1 or v_a7  > 5) then v_a7  := null; end if;
  if v_a8  is not null and (v_a8  < 1 or v_a8  > 5) then v_a8  := null; end if;
  if v_a9  is not null and (v_a9  < 1 or v_a9  > 5) then v_a9  := null; end if;
  if v_a10 is not null and (v_a10 < 1 or v_a10 > 5) then v_a10 := null; end if;
  if v_a11 is not null and (v_a11 < 1 or v_a11 > 5) then v_a11 := null; end if;
  if v_a12 is not null and (v_a12 < 1 or v_a12 > 5) then v_a12 := null; end if;

  v_educ    := case when v_a1  is null then null else (v_a1  - 1) * 25 end;
  v_chal    := case when v_a2  is null then null else (v_a2  - 1) * 25 end;
  v_brand   := case when v_a3  is null then null else (v_a3  - 1) * 25 end;
  v_team    := case when v_a4  is null then null else (v_a4  - 1) * 25 end;
  v_auto    := case when v_a5  is null then null else (v_a5  - 1) * 25 end;
  v_flex    := case when v_a6  is null then null else (v_a6  - 1) * 25 end;
  v_tech    := case when v_a7  is null then null else (v_a7  - 1) * 25 end;
  v_prem    := case when v_a8  is null then null else (v_a8  - 1) * 25 end;
  v_trend   := case when v_a9  is null then null else (v_a9  - 1) * 25 end;
  v_creative:= case when v_a10 is null then null else (v_a10 - 1) * 25 end;
  v_reldist := case when v_a11 is null then null else (v_a11 - 1) * 25 end;
  v_hier    := case when v_a12 is null then null else (v_a12 - 1) * 25 end;

  v_axes := jsonb_strip_nulls(jsonb_build_object(
    'education_support', v_educ,
    'challenge_openness', v_chal,
    'personal_brand_support', v_brand,
    'team_collaboration', v_team,
    'individual_autonomy', v_auto,
    'work_flexibility', v_flex,
    'technical_specialization', v_tech,
    'premium_value', v_prem,
    'trend_orientation', v_trend,
    'creative_output', v_creative,
    'relationship_distance', v_reldist,
    'hierarchy_flatness', v_hier
  ));

  if v_educ is not null or v_chal is not null or v_brand is not null then
    if coalesce(v_chal, -1) >= coalesce(v_educ, -1) and coalesce(v_chal, -1) >= coalesce(v_brand, -1) then
      v_top_label := '新しい挑戦を歓迎する';
    elsif coalesce(v_brand, -1) >= coalesce(v_educ, -1) then
      v_top_label := '個人の発信・ブランドづくりを後押しする';
    else
      v_top_label := '丁寧な教育・育成を大切にする';
    end if;
    v_summary := v_top_label || 'サロンです。';
  else
    v_summary := null;
  end if;

  insert into public.salon_store_culture_profiles (
    store_id, status, respondent_role, respondent_user_id, current_step,
    answers, culture_axes, value_priorities, comment, ai_summary
  ) values (
    p_store_id, p_status, p_respondent_role, v_uid, p_current_step,
    coalesce(p_answers, '{}'::jsonb), v_axes, p_value_priorities, p_comment, v_summary
  )
  on conflict (store_id) do update set
    status             = excluded.status,
    respondent_role     = excluded.respondent_role,
    respondent_user_id   = excluded.respondent_user_id,
    current_step        = excluded.current_step,
    answers              = excluded.answers,
    culture_axes         = excluded.culture_axes,
    value_priorities     = excluded.value_priorities,
    comment              = excluded.comment,
    ai_summary           = excluded.ai_summary
  returning * into v_row;

  -- ★初期店舗の場合のみ、旧salon_culture_profilesへ同期する。判定は
  -- p_store_idのみ（「誰が回答したか」ではなく「どの店舗か」で判定）。
  -- 同期先のsalon_user_idは常にsalon_onboarding_assignments.user_id
  -- （＝初回オンボーディングを行った本人）。respondent_user_idは実際に
  -- 回答したauth.uid()のまま（＝「誰が回答したか」の記録と「どの
  -- salon_user_idの行として保存するか」を分離する）。
  -- 旧テーブルはsalon_user_id(UNIQUE)のupsertのため、本人がまだ一度も
  -- 旧UIで回答していない場合（行が無い）にも対応できるよう、UPDATEでは
  -- なくINSERT ... ON CONFLICT DO UPDATEにする（0009と同じ形）。
  select user_id into v_legacy_salon_user_id
    from public.salon_onboarding_assignments
    where store_id = p_store_id;

  if v_legacy_salon_user_id is not null then
    insert into public.salon_culture_profiles (
      salon_user_id, status, respondent_role, respondent_user_id, current_step,
      answers, culture_axes, value_priorities, comment, ai_summary
    ) values (
      v_legacy_salon_user_id, p_status, p_respondent_role, v_uid, p_current_step,
      coalesce(p_answers, '{}'::jsonb), v_axes, p_value_priorities, p_comment, v_summary
    )
    on conflict (salon_user_id) do update set
      status             = excluded.status,
      respondent_role     = excluded.respondent_role,
      respondent_user_id   = excluded.respondent_user_id,
      current_step        = excluded.current_step,
      answers              = excluded.answers,
      culture_axes         = excluded.culture_axes,
      value_priorities     = excluded.value_priorities,
      comment              = excluded.comment,
      ai_summary           = excluded.ai_summary;
  end if;

  return v_row;
end;
$$;
comment on function public.save_salon_store_culture_profile is '店舗単位「サロンらしさ」12軸診断保存の唯一の経路（法人・複数店舗対応 Phase 3B）。SECURITY DEFINER。culture_axes算出・ルールベースai_summary生成ロジックは既存save_salon_culture_profile()(0009)と完全に同一。新テーブル(salon_store_culture_profiles)のrespondent_user_idは常にauth.uid()（実際に回答した人）。旧salon_culture_profilesへの同期対象は「誰が回答したか」ではなく「p_store_idがsalon_onboarding_assignmentsに示す初期店舗かどうか」のみで判定する（同期先salon_user_idは常にsalon_onboarding_assignments.user_id＝初回オンボーディングを行った本人。company_admin/area_manager/store_manager等、本人以外の正規アクセスユーザーが回答した場合も同期される。旧テーブル側のrespondent_user_idも実回答者auth.uid()で更新する）。2店舗目以降は旧salon_culture_profilesを一切更新しない。既存save_salon_culture_profile()は変更していない（内部から呼び出してもいない）。生成AIによる解説生成（salon_culture_ai_outputs相当）はPhase 4以降で別途対応し、今回はルールベースのai_summaryのみ。';

revoke all on function public.save_salon_store_culture_profile(
  uuid, public.salon_culture_status, public.salon_culture_respondent_role, integer, jsonb, text[], text
) from public, anon;
grant execute on function public.save_salon_store_culture_profile(
  uuid, public.salon_culture_status, public.salon_culture_respondent_role, integer, jsonb, text[], text
) to authenticated;

commit;
