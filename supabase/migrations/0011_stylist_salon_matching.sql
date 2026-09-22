-- ============================================================================
-- Beauty Reach — 0011_stylist_salon_matching
--
-- 「あなたらしさ × サロンらしさ」MVP。美容師が公開サロン一覧を閲覧し、
-- 各サロンとの相性（美容師Preference8軸 × サロンCulture8軸）を確認できる
-- ようにする。
--
-- ★既存のsalon_profiles_select_own・save_core_type_result()・
-- save_salon_culture_profile()・save_stylist_preference_profile()等、
-- 既存のRLSポリシー・RPCは一切変更・削除しない（新規追加のみ）。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. PUBLICサロンの一覧閲覧用RLSポリシー（新規追加、既存ポリシーは無変更）。
--
-- ★設計判断: 「PUBLICサロン一覧取得」は単純な公開フラグによるフィルタ
-- 取得であり、複雑な認可ロジックを伴わないため、RLSポリシーの追加を
-- 選んだ（RPCにすると、一覧取得特有の柔軟なクエリ操作＝将来の絞り込み・
-- ページング等をSupabaseクライアントの.select()の形で自然に書けなくなる）。
-- 一方、相性計算（下記2）は「caller/対象のrole確認」「visibility確認」
-- 「生データを返さない」という複雑な認可ロジックを伴うため、そちらは
-- SECURITY DEFINER RPCを選んでいる（用途によって手段を使い分けている）。
--
-- RLSは複数ポリシーがOR結合される仕様のため、この新規ポリシーの追加は
-- 既存の salon_profiles_select_own（本人のみ）の動作に一切影響しない
-- （本人は自分の行を従来どおり見え、他人の行のうちPUBLICなものだけが
-- 新たに見えるようになる。PRIVATE/LIMITEDのサロンの行は、本人以外には
-- 依然として一切見えない）。
-- ----------------------------------------------------------------------------
create policy salon_profiles_select_public on public.salon_profiles
  for select using (visibility = 'PUBLIC');
comment on policy salon_profiles_select_public on public.salon_profiles is '0011: サロンがvisibility=PUBLICを選んだ場合のみ、本人以外（ログイン済みの全ユーザー）にも行を公開する。LIMITED/PRIVATEは対象外（このポリシーの条件に一致しないため、既存のselect_ownポリシー以外では見えない）。美容師専用への絞り込みはUI/middleware側で行う。';

-- ----------------------------------------------------------------------------
-- 2. calculate_stylist_salon_match(): 「あなたらしさ × サロンらしさ」の
-- 相性計算専用RPC。
--
-- セキュリティ設計:
--   ・引数は対象サロンの salon_user_id のみ。呼び出し美容師自身のIDは
--     引数に取らず、関数内部で auth.uid() から取得する
--     （既存の save_core_type_result(p_diagnosis_result_id) と同じ設計
--     パターン: 対象IDのみ引数、呼び出し元は内部でauth.uid()由来）。
--   ・callerがstylist roleでなければ例外（user_rolesを確認）。
--   ・対象がsalon roleでなければ例外（user_rolesを確認）。
--   ・対象サロンが visibility='PUBLIC' でなければ例外
--     （PRIVATE/LIMITEDのサロンとの相性は計算しない＝拒否）。
--   ・SECURITY DEFINER・固定search_pathで、RLSをバイパスして
--     stylist_preference_profiles・salon_culture_profilesの両方を読むが、
--     生の preference_axes / culture_axes の値やanswers（回答JSON）は
--     一切返さない。返すのは「計算済みのスコア（0〜100の数値）」と
--     「計算可否の状態」のみ。
--
-- 丸め方式: 各軸スコアは round(100 - abs(stylist - salon)) で整数化して
-- 返す。overall_score は「丸める前の8軸の生スコアの合計 ÷ 8」を最後に
-- 1回だけ round() する（各軸を先に丸めてから平均すると、丸め誤差が
-- 蓄積してしまうため。8軸すべての生スコアを保持してから最後に1回だけ
-- 丸める方式を採用した）。
--
-- 未回答時の挙動: 美容師のPreferenceが未完了（行が無い、または
-- status != 'completed'）、あるいはサロンのCultureが未完了の場合は、
-- スコアを一切計算せず、available=false と reason のみを返す
-- （欠けている軸を0として扱ったり、推測で埋めたりしない）。
-- ----------------------------------------------------------------------------
create or replace function public.calculate_stylist_salon_match(
  p_salon_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stylist_uid uuid := auth.uid();
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
  if v_stylist_uid is null then
    raise exception 'not authenticated';
  end if;

  -- callerがstylist roleであることを確認（user_rolesを正とする既存方針、
  -- 0008_user_roles_single_role.sql・0010と同じ確認パターン）。
  if not exists (
    select 1 from public.user_roles where user_id = v_stylist_uid and role = 'stylist'
  ) then
    raise exception 'caller is not a stylist';
  end if;

  -- 対象がsalon roleであることを確認。
  if not exists (
    select 1 from public.user_roles where user_id = p_salon_user_id and role = 'salon'
  ) then
    raise exception 'target is not a salon';
  end if;

  -- 対象サロンがvisibility='PUBLIC'であることを確認。PRIVATE/LIMITEDは拒否。
  if not exists (
    select 1 from public.salon_profiles
    where user_id = p_salon_user_id and visibility = 'PUBLIC'
  ) then
    raise exception 'target salon is not public';
  end if;

  select * into v_pref from public.stylist_preference_profiles where stylist_user_id = v_stylist_uid;
  select * into v_culture from public.salon_culture_profiles where salon_user_id = p_salon_user_id;

  -- 美容師のPreferenceが未完了（行が無い＝select intoで全列null、または
  -- status != 'completed'）の場合は計算しない。
  if v_pref.status is null or v_pref.status != 'completed' then
    return jsonb_build_object('available', false, 'reason', 'stylist_preference_incomplete');
  end if;

  -- サロンのCultureが未完了の場合も計算しない。
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

  -- 8軸のいずれかが欠けていれば計算しない（推測で0を補わない）。
  if v_s_educ is null or v_s_chal is null or v_s_brand is null or v_s_collab is null
     or v_s_auto is null or v_s_flex is null or v_s_reldist is null or v_s_hier is null
     or v_c_educ is null or v_c_chal is null or v_c_brand is null or v_c_collab is null
     or v_c_auto is null or v_c_flex is null or v_c_reldist is null or v_c_hier is null
  then
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

  -- overall_scoreは丸める前の8軸生スコアの合計÷8を最後に1回だけ丸める
  -- （各軸を先に丸めてから平均すると誤差が蓄積するため）。
  v_overall := (v_m_educ + v_m_chal + v_m_brand + v_m_collab + v_m_auto + v_m_flex + v_m_reldist + v_m_hier) / 8;

  return jsonb_build_object(
    'available', true,
    'overall_score', round(v_overall),
    'axis_scores', jsonb_build_object(
      'education', round(v_m_educ),
      'challenge', round(v_m_chal),
      'personal_brand', round(v_m_brand),
      'collaboration', round(v_m_collab),
      'autonomy', round(v_m_auto),
      'work_flexibility', round(v_m_flex),
      'relationship_distance', round(v_m_reldist),
      'hierarchy', round(v_m_hier)
    )
  );
end;
$$;
comment on function public.calculate_stylist_salon_match is '「あなたらしさ×サロンらしさ」相性計算。引数は対象salon_user_idのみ、呼び出し美容師はauth.uid()から取得。caller=stylist role・対象=salon role・対象visibility=PUBLICをすべて確認した上でのみ計算する。生のpreference_axes/culture_axes・回答JSONは一切返さず、計算済みスコア（0〜100）と可否状態のみを返す。SECURITY DEFINER、固定search_path。';

revoke all on function public.calculate_stylist_salon_match(uuid) from public;
revoke all on function public.calculate_stylist_salon_match(uuid) from anon;
grant execute on function public.calculate_stylist_salon_match(uuid) to authenticated;
