-- ============================================================================
-- Beauty Reach — 0031_store_matching_rpcs
--
-- 法人・複数店舗対応 Phase 4、最小ステップ。matchingのstore_id対応のみ。
--
-- ★既存の以下4関数は一切変更しない（create or replaceしない。ファイル自体
-- も編集しない）。既存美容師側・サロン側画面はこのmigrationの影響を
-- 一切受けない:
--   - calculate_match_axes(uuid, uuid)              (0025)
--   - calculate_stylist_salon_match(uuid)            (0011→0025で計算委譲)
--   - calculate_salon_stylist_match(uuid)            (0025)
--   - get_public_stylists_for_scout()                (0025)
--
-- ★新設する3関数はいずれもsalon_profiles/salon_culture_profilesを
-- 一切参照せず、salon_store_profiles/salon_store_culture_profiles
-- （0029）のみを参照する。既存のcalculate_match_axesとは完全に独立した
-- 並行経路として追加する（内部で既存関数を呼び出すこともしない。
-- 0025がcalculate_match_axesを0011から切り出した時と同じ「verbatim
-- transcription」の考え方で、計算式・null判定・丸め方を一切変更せずに
-- 複製する）。
--
-- ★既存migration(0001〜0030)は一切編集していない。
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. calculate_match_axes_by_store(): calculate_match_axes(0025)のstore版。
--
-- 既存calculate_match_axesとの差分は唯一、culture_axesの取得元のみ:
--   旧: select * from salon_culture_profiles where salon_user_id = p_salon_user_id
--   新: select * from salon_store_culture_profiles where store_id = p_store_id
-- 計算式（8軸の差分計算・丸め方・overall_scoreの算出順序）・未入力時の
-- reason文字列・返却jsonbの構造は一切変更していない（既存と完全に同一）。
--
-- 内部専用関数。ガードを一切持たないため、既存calculate_match_axesと
-- 同じ方針で public/anon/authenticated のいずれにもexecuteを与えない
-- （呼び出しは本ファイル内の2つの公開RPC経由のみ）。
-- ----------------------------------------------------------------------------
create or replace function public.calculate_match_axes_by_store(
  p_stylist_user_id uuid,
  p_store_id uuid
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_pref public.stylist_preference_profiles;
  v_culture public.salon_store_culture_profiles;
  v_s_educ numeric; v_s_chal numeric; v_s_brand numeric; v_s_collab numeric;
  v_s_auto numeric; v_s_flex numeric; v_s_reldist numeric; v_s_hier numeric;
  v_c_educ numeric; v_c_chal numeric; v_c_brand numeric; v_c_collab numeric;
  v_c_auto numeric; v_c_flex numeric; v_c_reldist numeric; v_c_hier numeric;
  v_m_educ numeric; v_m_chal numeric; v_m_brand numeric; v_m_collab numeric;
  v_m_auto numeric; v_m_flex numeric; v_m_reldist numeric; v_m_hier numeric;
  v_overall numeric;
begin
  select * into v_pref from public.stylist_preference_profiles where stylist_user_id = p_stylist_user_id;
  select * into v_culture from public.salon_store_culture_profiles where store_id = p_store_id;

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
comment on function public.calculate_match_axes_by_store is '法人・複数店舗対応 Phase 4。既存calculate_match_axes(0025)のstore版。culture_axesの取得元のみsalon_store_culture_profiles(store_id)に差し替え、計算式・null判定・丸め方は一切変更していない。内部専用関数（ガード無し）。';
revoke all on function public.calculate_match_axes_by_store(uuid, uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. calculate_stylist_store_match(): 美容師→店舗のmatching。
--    既存calculate_stylist_salon_match(uuid)と同じガード構造・同じ返却形式。
--    差分は対象がsalon_user_idではなくstore_id（salon_store_profiles）で
--    あることのみ。
-- ----------------------------------------------------------------------------
create or replace function public.calculate_stylist_store_match(
  p_store_id uuid
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
  if not exists (select 1 from public.salon_store_profiles where store_id = p_store_id and visibility = 'PUBLIC') then
    raise exception 'target store is not public';
  end if;

  return public.calculate_match_axes_by_store(v_stylist_uid, p_store_id);
end;
$$;
comment on function public.calculate_stylist_store_match is '法人・複数店舗対応 Phase 4。既存calculate_stylist_salon_match(0011/0025)のstore版。caller=stylist・対象store=PUBLICを確認した上でcalculate_match_axes_by_storeへ委譲する。既存関数は無変更。';
revoke all on function public.calculate_stylist_store_match(uuid) from public, anon;
grant execute on function public.calculate_stylist_store_match(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. calculate_store_stylist_match(): 店舗→美容師のmatching。
--    既存calculate_salon_stylist_match(uuid)と同じガード構造・同じ返却形式。
--
-- ★重要: callerのauth.uid()とstore_idを同一視しない。店舗へのアクセス権は
-- 必ずis_store_accessible(p_store_id)（0026、既存のRLSが使う関数そのもの）
-- で判定する。これにより、company_owner本人だけでなく、
-- company_admin/recruiting_admin/area_manager/store_manager/recruiter等、
-- is_store_accessible()が正当にtrueを返す全ユーザーが利用できる
-- （auth.uid() = salon_store_profiles.store_idの所有者、という誤った
-- 判定は一切行わない）。
-- ----------------------------------------------------------------------------
create or replace function public.calculate_store_stylist_match(
  p_store_id uuid,
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
  if not public.is_store_accessible(p_store_id) then
    raise exception 'store not found or not accessible';
  end if;
  if not exists (select 1 from public.user_roles where user_id = p_stylist_user_id and role = 'stylist') then
    raise exception 'target is not a stylist';
  end if;
  if not exists (select 1 from public.stylist_profiles where user_id = p_stylist_user_id and visibility = 'PUBLIC') then
    raise exception 'target stylist is not public';
  end if;

  return public.calculate_match_axes_by_store(p_stylist_user_id, p_store_id);
end;
$$;
comment on function public.calculate_store_stylist_match is '法人・複数店舗対応 Phase 4。既存calculate_salon_stylist_match(0025)のstore版。caller=salon role・is_store_accessible(p_store_id)（0026のRLSと同一の判定関数）・対象stylist=PUBLICを確認した上でcalculate_match_axes_by_storeへ委譲する。callerのauth.uid()とstore_idの所有関係は見ない（company_admin/area_manager/store_manager等、is_store_accessible()がtrueを返す全ユーザーが利用可能）。既存関数は無変更。';
revoke all on function public.calculate_store_stylist_match(uuid, uuid) from public, anon;
grant execute on function public.calculate_store_stylist_match(uuid, uuid) to authenticated;

commit;
