-- ============================================================================
-- Beauty Reach — 0036_public_store_and_store_activity_reads
--
-- 法人・複数店舗対応 Phase 5後続。次UI phase（美容師向けPUBLIC店舗閲覧・
-- store単位Interest/Scout/Salary Offer送信UI接続）に必要な「読み取り」DB
-- 基盤のみを追加する。今回はUI変更を一切行わない（純粋にSECURITY DEFINER
-- RPCを新設するだけのmigration）。
--
-- ★実装前に確認した現行schema/RLS/RPCの完全な仕様（この前提に基づいて設計）:
--
-- [salon_stores] (0026作成、以後schema無変更)
--   columns: id uuid PK / organization_id uuid not null (FK→
--     salon_organizations(id) on delete cascade) / store_name text not null /
--     status text not null default 'active' / usage_status text not null
--     default 'inactive' check in ('inactive','active') / prefecture・city
--     text (0026で追加されたが、0030以降の実際の店舗プロフィール編集は
--     salon_store_profiles.prefecture/cityへ保存される。以後この2列は
--     更新されていないため、公開表示にはsalon_store_profiles側を正とする) /
--     created_at・updated_at
--   RLS: salon_stores_select_accessible = is_store_accessible(id)のみ。
--     PUBLIC向けポリシーは存在しない。
--
-- [salon_store_profiles] (0029作成、0030のsave_salon_store_profile()経由で
--   書き込み。以後schema無変更)
--   columns: store_id uuid PK (FK→salon_stores(id) on delete cascade) /
--     salon_name・visibility(profile_visibility)・prefecture・city・
--     street_address・culture_description・employee_size_code・
--     target_specialties(text[])・bio・hotpepper_url・created_at・updated_at
--   RLS: salon_store_profiles_select_accessible = is_store_accessible(store_id)
--     のみ。0029のコメントに明記の通り「visibility=PUBLICの美容師向け公開
--     RLSはPhase 4で別途検討する」として意図的に見送られたまま、0030〜0035
--     のどこでも追加されていないことをgrepで確認済み（0件）。
--
-- [salon_store_culture_profiles] (0029作成、0030のsave_salon_store_culture_
--   profile()経由で書き込み。以後schema無変更)
--   columns: id uuid PK / store_id uuid not null unique (FK→
--     salon_stores(id) on delete cascade) / status(salon_culture_status)・
--     respondent_role・respondent_user_id・current_step・answers(jsonb)・
--     culture_axes(jsonb)・value_priorities(text[])・comment・ai_summary・
--     created_at・updated_at
--   RLS: salon_store_culture_profiles_select_accessible =
--     is_store_accessible(store_id)のみ。PUBLIC向けポリシーは存在しない。
--     既存salon_culture_ai_outputs相当の店舗単位AI出力テーブルは存在せず
--     （0029のコメントで明記の通り意図的に見送り）、ai_summary textのみを
--     このテーブル自身が持つ。
--
-- [stylist_salon_interests] (0018作成、0032でstore_id列、0035でid surrogate
--   PK・salon_user_id nullable化。以後schema無変更)
--   columns: id uuid PK (0035) / stylist_user_id uuid not null・
--     salon_user_id uuid null (0035でnullable化)・store_id uuid null (0032)・
--     created_at
--   RLS: stylist_salon_interests_select_sent_own
--     (stylist_user_id = auth.uid())のみ。salon側の直接SELECTポリシーは
--     存在しない（サロン側は既存get_received_salon_interests() RPC経由の
--     みで、salon_user_id = auth.uid()でのみ絞り込まれる。store_idでは
--     絞り込まれない）。
--
-- [scouts] (0025作成、0032でstore_id/created_by_user_id列追加。以後schema
--   無変更)
--   columns: id uuid PK / salon_user_id・stylist_user_id uuid not null /
--     message・template_type・matching_score・read_status・response_status・
--     response_message・sent_at・read_at・responded_at・created_at（0025） /
--     store_id・created_by_user_id uuid null（0032）
--   RLS: scouts_select_salon (salon_user_id = auth.uid())・
--     scouts_select_stylist (stylist_user_id = auth.uid())のみ。store_idでは
--     絞り込まれない。既存の「Scout履行一覧」RPCは存在せず、サロン側は
--     app/salon/stores/[storeId]/stylists/page.tsx（Phase 5）が
--     scoutsテーブルを直接SELECTして取得している（RLSによりsalon_user_id=
--     auth.uid()の分のみ）。
--
-- [salary_offers] (0022作成、0032でstore_id/created_by_user_id列追加、0035で
--   pending unique indexをlegacy/store二分割。以後schema無変更)
--   columns: id uuid PK / salon_user_id・stylist_user_id uuid not null /
--     monthly_guarantee・performance_addition・guarantee_months・
--     performance_condition・salon_message・status・response_reason・
--     response_note・responded_at・created_at・updated_at（0022） /
--     store_id・created_by_user_id uuid null（0032）
--   RLS: salary_offers_select_participant
--     (salon_user_id = auth.uid() or stylist_user_id = auth.uid())のみ。
--     store_idでは絞り込まれない。既存の「Salary Offer履行一覧」RPCは
--     存在せず、app/salon/mypage/page.tsx（旧画面）がテーブルを直接
--     SELECTして取得している（RLSによりsalon_user_id = auth.uid()の分
--     のみ）。
--
-- [organization_scout_quotas] (0033作成、以後schema無変更)
--   columns: organization_id uuid PK (FK→salon_organizations(id) on delete
--     cascade) / monthly_free_limit integer not null default 10 /
--     additional_credits integer not null default 0 / created_at・updated_at
--   RLS: organization_scout_quotas_select_member = caller がorganization_
--     membersにcompany_owner/company_admin/recruiting_adminのいずれかの
--     roleで所属している場合のみSELECT可。area_manager/store_manager/
--     recruiter/viewer（store_members経由でis_store_accessible()がtrueに
--     なるだけのユーザー）はこのRLSでは読めない。
--
-- [user_roles] (0008作成) : user_id×roleのunique。stylist/salon/adminの
--   「1 auth user = 1 role」を保証する既存の正。今回は参照のみ、無変更。
--
-- [store_members] (0026作成): store_id×user_id PK、role in
--   ('store_manager','recruiter','viewer')。is_store_accessible()内部で
--   参照される。今回は参照のみ、無変更。
--
-- [organization_members] (0026作成): organization_id×user_id PK、role in
--   ('company_owner','company_admin','recruiting_admin','area_manager')。
--   is_store_accessible()・organization_scout_quotas RLS内部で参照される。
--   今回は参照のみ、無変更。
--
-- [is_store_accessible(p_store_id)] (0026作成、以後無変更):
--   company_owner/company_admin/recruiting_adminは所属会社の全店舗、
--   それ以外（area_manager含む）はstore_membersに当該store_idの行を
--   直接持つ場合のみtrue。本migrationの全salon側RPCがこれをそのまま
--   呼ぶだけで、権限ロジックを複製しない。
--
-- [calculate_stylist_store_match(p_store_id)]・
-- [calculate_store_stylist_match(p_store_id, p_stylist_user_id)] (0031作成、
--   以後無変更): 今回は変更しない。get_store_received_interests()内部で
--   calculate_match_axes_by_store()（0031の内部専用関数、revoke済みだが
--   SECURITY DEFINER関数同士のためowner権限で呼べる）を直接利用する。
--
-- [set_store_interest]・[create_salary_offer_v2] (0035作成、以後無変更):
--   今回は変更しない。
--
-- ★方針: 新規テーブル・新規列は一切追加しない（読み取り専用RPC 6個の追加
-- のみ）。既存RLSポリシーも一切追加・変更しない。「salon_store_profiles
-- 全列をvisibility='PUBLICだけで直接公開する新RLS policy」は意図的に
-- 採用しない（将来列が増えても自動的に漏洩しない、公開して良い列だけを
-- 明示的に選んで返すRPC方式を優先する）。
--
-- ★既存migration(0001〜0035)は一切編集していない。既存RPC（calculate_
-- stylist_store_match・calculate_store_stylist_match・set_store_interest・
-- create_salary_offer_v2・send_scout_v2・send_scout・set_salon_interest・
-- create_salary_offer・respond_salary_offer・get_received_salon_interests等）
-- はいずれもcreate or replaceしていない。
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. get_public_salon_stores(): 美容師向けPUBLIC店舗一覧（discovery）。
--
-- ★既存get_public_stylists_for_scout()と同じ設計（単純なSELECT・副作用
-- 無し・jsonb配列を返す）。PUBLIC判定はsalon_store_profiles.visibility=
-- 'PUBLIC'のみを正とする（salon_stores.usage_statusは見ない。既存
-- calculate_stylist_store_match・send_scout_v2もusage_statusを一切見ていない
-- ため、新しい公開条件を独自に追加しない＝既存の「PUBLIC可視性の唯一の
-- 正はvisibility列」という前提と一致させる）。
--
-- ★一覧用の列は最小限に絞る（salon_store_profiles.street_address・
-- culture_description・hotpepper_url・culture_axes等は返さない）。一覧
-- カードの描画に必要な項目のみを返し、12軸カルチャー・AI解説等の詳細は
-- 既存の設計パターン（/stylist/salons一覧が各salonごとに
-- getPublicSalonCultureDetail()を個別に呼ぶのと同じ考え方）に合わせ、
-- 詳細取得はget_public_salon_store_detail()側に委ねる。
-- ----------------------------------------------------------------------------
create or replace function public.get_public_salon_stores()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stylist_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_stylist_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.user_roles where user_id = v_stylist_uid and role = 'stylist') then
    raise exception 'caller is not a stylist';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'store_id', s.id,
    'organization_id', s.organization_id,
    'store_name', s.store_name,
    'prefecture', sp.prefecture,
    'city', sp.city,
    'employee_size_code', sp.employee_size_code,
    'target_specialties', sp.target_specialties,
    'bio', sp.bio
  ) order by s.store_name), '[]'::jsonb)
  into v_result
  from public.salon_stores s
  join public.salon_store_profiles sp on sp.store_id = s.id
  where sp.visibility = 'PUBLIC';

  return v_result;
end;
$$;
comment on function public.get_public_salon_stores() is '法人・複数店舗対応 Phase 5後続。美容師向けPUBLIC店舗一覧（discovery）。caller=stylist roleのみ許可。salon_store_profiles.visibility=PUBLICの店舗のみを返す（usage_statusは見ない。既存calculate_stylist_store_match/send_scout_v2と同じPUBLIC可視性の前提に合わせている）。一覧カードの描画に必要な最小限の列のみ返し、organization_members/store_members/billing/quota/内部role等は一切返さない。詳細（12軸カルチャー・AI解説等）はget_public_salon_store_detail()で別途取得する。';
revoke all on function public.get_public_salon_stores() from public, anon;
grant execute on function public.get_public_salon_stores() to authenticated;

-- ----------------------------------------------------------------------------
-- 2. get_public_salon_store_detail(p_store_id): 美容師向けPUBLIC店舗詳細。
--
-- ★既存get_public_salon_culture_detail()（0013）と同じ設計思想。PUBLICで
-- ない店舗はraise exceptionで拒否する（既存calculate_stylist_store_match
-- （0031）が'target store is not public'で例外にする設計と同一であり、
-- 今回新たに別の例外処理パターンを導入しない）。呼び出し側（次UI phase）が
-- この例外を「not found」として扱う。
--
-- ★salon_store_culture_profiles.status != 'completed'の場合はcultureを
-- nullのまま返す（例外にしない。既存get_public_salon_culture_detail()が
-- status != 'completed'時にavailable:falseを返す設計と同じ考え方だが、
-- ここでは店舗詳細自体はPUBLICであれば常にavailableなので、culture部分
-- だけを欠損として表現する）。
--
-- ★店舗単位AI解説（salon_culture_ai_outputs相当）は0029時点で存在しない
-- ため、salon_store_culture_profiles.ai_summary（text、現状唯一のAI
-- フィールド）をそのまま返す。
-- ----------------------------------------------------------------------------
create or replace function public.get_public_salon_store_detail(
  p_store_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stylist_uid uuid := auth.uid();
  v_store public.salon_stores;
  v_profile public.salon_store_profiles;
  v_culture public.salon_store_culture_profiles;
begin
  if v_stylist_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.user_roles where user_id = v_stylist_uid and role = 'stylist') then
    raise exception 'caller is not a stylist';
  end if;

  select * into v_profile from public.salon_store_profiles
  where store_id = p_store_id and visibility = 'PUBLIC';
  if v_profile.store_id is null then
    raise exception 'target store is not public';
  end if;

  select * into v_store from public.salon_stores where id = p_store_id;
  select * into v_culture from public.salon_store_culture_profiles where store_id = p_store_id;

  return jsonb_build_object(
    'available', true,
    'store_id', p_store_id,
    'organization_id', v_store.organization_id,
    'store_name', v_store.store_name,
    'prefecture', v_profile.prefecture,
    'city', v_profile.city,
    'street_address', v_profile.street_address,
    'culture_description', v_profile.culture_description,
    'employee_size_code', v_profile.employee_size_code,
    'target_specialties', v_profile.target_specialties,
    'bio', v_profile.bio,
    'hotpepper_url', v_profile.hotpepper_url,
    'culture', case when v_culture.status = 'completed' then jsonb_build_object(
      'culture_profile_id', v_culture.id,
      'culture_axes', v_culture.culture_axes,
      'value_priorities', v_culture.value_priorities,
      'comment', v_culture.comment,
      'ai_summary', v_culture.ai_summary
    ) else null end
  );
end;
$$;
comment on function public.get_public_salon_store_detail(uuid) is '法人・複数店舗対応 Phase 5後続。美容師向けPUBLIC店舗詳細。caller=stylist role・対象store=salon_store_profiles.visibility=PUBLICを確認した上で、salon_stores/salon_store_profiles/salon_store_culture_profilesの公開可能項目のみ返す。PUBLICでない場合は例外にする（既存calculate_stylist_store_match(0031)と同じ設計）。culture部分はstatus=completedの場合のみ返す（未完了ならnull、例外にしない）。organization_members/store_members/billing/quota等は一切返さない。';
revoke all on function public.get_public_salon_store_detail(uuid) from public, anon;
grant execute on function public.get_public_salon_store_detail(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. get_store_received_interests(p_store_id): store単位Interest受信一覧。
--
-- ★既存get_received_salon_interests()（0022で最終再定義、create or
-- replaceしない・そのまま残す）と完全に同じ戻り値shapeをベースに、
-- 以下の差分のみを加える:
--   - フィルタをi.salon_user_id = auth.uid()からi.store_id = p_store_idへ
--     変更（絶対にsalon_user_id = auth.uid()だけで絞らない、という指示に
--     対応）。
--   - caller guardをis_store_accessible(p_store_id)に変更（store自体へ
--     アクセスできる全staffが見られるようにする。既存のsalon_user_id=
--     auth.uid()限定という制約を撤廃する）。
--   - interest_id（0035で追加されたsurrogate id）・store_idを追加で返す。
--   - 店舗単位相性（calculate_match_axes_by_store、0031の内部専用関数）を
--     matchとして追加する。旧calculate_salon_stylist_match/
--     calculate_stylist_salon_matchは使わない。
-- ----------------------------------------------------------------------------
create or replace function public.get_store_received_interests(
  p_store_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.user_roles where user_id = v_uid and role = 'salon') then
    raise exception 'caller is not a salon';
  end if;
  if not public.is_store_accessible(p_store_id) then
    raise exception 'store not found or not accessible';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'interest_id', i.id,
    'stylist_user_id', i.stylist_user_id,
    'store_id', i.store_id,
    'created_at', i.created_at,
    'public_name', sp.public_name, 'prefecture', sp.prefecture,
    'desired_work_location', sp.desired_work_location,
    'experience_years', sp.experience_years, 'current_position', sp.current_position,
    'specialties', sp.specialties, 'job_change_intent', sp.job_change_intent, 'bio', sp.bio,
    'match', public.calculate_match_axes_by_store(i.stylist_user_id, p_store_id),
    'match_profile', case when mp.stylist_user_id is null then null else jsonb_build_object(
      'primary_goal', mp.primary_goal, 'secondary_goals', mp.secondary_goals,
      'career_stage', mp.career_stage, 'wants_performance_offer', mp.wants_performance_offer,
      'evidence_period_months', mp.evidence_period_months,
      'avg_monthly_technical_sales', mp.avg_monthly_technical_sales,
      'avg_monthly_retail_sales', mp.avg_monthly_retail_sales,
      'avg_monthly_clients', mp.avg_monthly_clients,
      'avg_monthly_named_clients', mp.avg_monthly_named_clients,
      'average_ticket', mp.average_ticket, 'repeat_rate', mp.repeat_rate,
      'monthly_working_days', mp.monthly_working_days,
      'average_daily_hours', mp.average_daily_hours,
      'self_acquired_clients', mp.self_acquired_clients,
      'expected_transfer_clients', mp.expected_transfer_clients,
      'assistant_usage', mp.assistant_usage,
      'verification_status', mp.verification_status,
      'consistency_issues', mp.consistency_issues,
      'evidence_document_count', (select count(*) from public.stylist_evidence_documents d where d.stylist_user_id = i.stylist_user_id)
    ) end
  ) order by i.created_at desc), '[]'::jsonb)
  into v_result
  from public.stylist_salon_interests i
  join public.stylist_profiles sp on sp.user_id = i.stylist_user_id
  left join public.stylist_match_profiles mp on mp.stylist_user_id = i.stylist_user_id
  where i.store_id = p_store_id;

  return v_result;
end;
$$;
comment on function public.get_store_received_interests(uuid) is '法人・複数店舗対応 Phase 5後続。store単位Interest受信一覧。caller=salon role・is_store_accessible(p_store_id)（同一store_idへアクセスできる全staff共通、特定のcreated_by_user_idや旧salon_user_idには限定しない）。i.store_id = p_store_idのみで絞り込む（salon_user_id = auth.uid()は一切使わない）。戻り値shapeは既存get_received_salon_interests()(0022)と同一の美容師公開項目・match_profileに加え、interest_id・store_id・calculate_match_axes_by_store()によるstore単位matchを追加する。既存get_received_salon_interests()は無変更。';
revoke all on function public.get_store_received_interests(uuid) from public, anon;
grant execute on function public.get_store_received_interests(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. get_store_scouts(p_store_id): store単位Scout履行一覧。
--
-- ★既存scoutsテーブルの直接SELECTはRLS scouts_select_salon
-- （salon_user_id = auth.uid()）により、このRPCを呼んだ担当者自身が送った
-- 分しか見えない（0032でstore_id列が増えても、RLSはそれを条件に使って
-- いない）。本RPCはSECURITY DEFINERでそのRLSをバイパスし、
-- is_store_accessible(p_store_id)のみで判定することで、同じstoreへ
-- アクセスできる別staffが送ったScoutも見られるようにする。
-- ----------------------------------------------------------------------------
create or replace function public.get_store_scouts(
  p_store_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.user_roles where user_id = v_uid and role = 'salon') then
    raise exception 'caller is not a salon';
  end if;
  if not public.is_store_accessible(p_store_id) then
    raise exception 'store not found or not accessible';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'store_id', s.store_id,
    'created_by_user_id', s.created_by_user_id,
    'stylist_user_id', s.stylist_user_id,
    'message', s.message,
    'template_type', s.template_type,
    'matching_score', s.matching_score,
    'read_status', s.read_status,
    'response_status', s.response_status,
    'response_message', s.response_message,
    'sent_at', s.sent_at,
    'read_at', s.read_at,
    'responded_at', s.responded_at,
    'created_at', s.created_at
  ) order by s.sent_at desc), '[]'::jsonb)
  into v_result
  from public.scouts s
  where s.store_id = p_store_id;

  return v_result;
end;
$$;
comment on function public.get_store_scouts(uuid) is '法人・複数店舗対応 Phase 5後続。store単位Scout履行一覧。caller=salon role・is_store_accessible(p_store_id)（同一storeへアクセスできる全staff共通。created_by_user_id・旧salon_user_idでは絞らない）。s.store_id = p_store_idのみで絞り込む。matching_scoreは送信時にcalculate_match_axes_by_store()で算出済みの値をそのまま返す（軸別スコアはscoutsテーブル自体に保存されていないため、本RPCでは再計算しない）。既存scouts_select_salon RLSは無変更（store_idでは絞り込まない旧RLSのまま残す）。';
revoke all on function public.get_store_scouts(uuid) from public, anon;
grant execute on function public.get_store_scouts(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. get_store_salary_offers(p_store_id): store単位Salary Offer履行一覧。
--
-- ★既存salary_offersテーブルの直接SELECTはRLS salary_offers_select_
-- participant（salon_user_id = auth.uid() or stylist_user_id = auth.uid()）
-- により絞られる。本RPCはSECURITY DEFINERでそれをバイパスし、
-- is_store_accessible(p_store_id)のみで判定する（get_store_scouts()と
-- 同じ設計）。
-- ----------------------------------------------------------------------------
create or replace function public.get_store_salary_offers(
  p_store_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.user_roles where user_id = v_uid and role = 'salon') then
    raise exception 'caller is not a salon';
  end if;
  if not public.is_store_accessible(p_store_id) then
    raise exception 'store not found or not accessible';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', o.id,
    'store_id', o.store_id,
    'created_by_user_id', o.created_by_user_id,
    'stylist_user_id', o.stylist_user_id,
    'monthly_guarantee', o.monthly_guarantee,
    'performance_addition', o.performance_addition,
    'guarantee_months', o.guarantee_months,
    'performance_condition', o.performance_condition,
    'salon_message', o.salon_message,
    'status', o.status,
    'response_reason', o.response_reason,
    'response_note', o.response_note,
    'responded_at', o.responded_at,
    'created_at', o.created_at,
    'updated_at', o.updated_at
  ) order by o.created_at desc), '[]'::jsonb)
  into v_result
  from public.salary_offers o
  where o.store_id = p_store_id;

  return v_result;
end;
$$;
comment on function public.get_store_salary_offers(uuid) is '法人・複数店舗対応 Phase 5後続。store単位Salary Offer履行一覧。caller=salon role・is_store_accessible(p_store_id)（同一storeへアクセスできる全staff共通。created_by_user_id・旧salon_user_idでは絞らない）。o.store_id = p_store_idのみで絞り込む。既存salary_offers_select_participant RLSは無変更。';
revoke all on function public.get_store_salary_offers(uuid) from public, anon;
grant execute on function public.get_store_salary_offers(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. get_store_scout_quota(p_store_id): store→organization Scout quota読取。
--
-- ★既存organization_scout_quotas RLS（organization_scout_quotas_select_
-- member）はcompany_owner/company_admin/recruiting_adminの3roleのみに
-- 限定されており、area_manager/store_manager/recruiterはstoreへの
-- アクセス権（is_store_accessible）を持っていても直接SELECTできない。
-- 本RPCはSECURITY DEFINERでこれをバイパスし、「このstore_idへアクセス
-- できるstaffなら誰でも、そのstoreが属するorganizationのquotaを読める」
-- という、送信権限と対称な読み取り権限を与える。
--
-- ★used_this_monthの算出ロジックは0034のsend_scout_v2内の月次使用数
-- カウントと完全に同一にする（store_idが設定されたScoutのみを対象とし、
-- 旧send_scout()経由のstore_id is nullのScoutは対象外。二重カウント
-- 防止・誤帰属防止の方針を0034から変更しない）。0034のロックのための
-- insert...on conflict do nothing（organization_scout_quotasに行を作る
-- 副作用）は、本RPCが読み取り専用である方針のため行わない。行が無い
-- organizationはsend_scout_v2と同じデフォルト値（monthly_free_limit=10,
-- additional_credits=0）として扱う。
--
-- ★0034のsend_scout_v2自体は一切変更しない。
-- ----------------------------------------------------------------------------
create or replace function public.get_store_scout_quota(
  p_store_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_organization_id uuid;
  v_limit integer;
  v_credits integer;
  v_used integer;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.user_roles where user_id = v_uid and role = 'salon') then
    raise exception 'caller is not a salon';
  end if;
  if not public.is_store_accessible(p_store_id) then
    raise exception 'store not found or not accessible';
  end if;

  -- ★organization_idはp_store_idから取得したsalon_stores.organization_id
  -- のみを正とする（0034のsend_scout_v2と同じ原則。auth.uid()・
  -- salon_onboarding_assignments等から推測しない）。
  select organization_id into v_organization_id
  from public.salon_stores where id = p_store_id;

  select monthly_free_limit, additional_credits into v_limit, v_credits
  from public.organization_scout_quotas where organization_id = v_organization_id;

  v_limit := coalesce(v_limit, 10);
  v_credits := coalesce(v_credits, 0);

  -- ★0034のsend_scout_v2と完全に同一の月次使用数ロジック（store_idが
  -- 設定されたScoutのみ、当月分をorganization全店舗で集計）。
  select count(*) into v_used
  from public.scouts s
  join public.salon_stores ss on ss.id = s.store_id
  where ss.organization_id = v_organization_id
    and s.sent_at >= date_trunc('month', now());

  return jsonb_build_object(
    'monthly_free_limit', v_limit,
    'additional_credits', v_credits,
    'used_this_month', v_used,
    'remaining', greatest(0, v_limit + v_credits - v_used)
  );
end;
$$;
comment on function public.get_store_scout_quota(uuid) is '法人・複数店舗対応 Phase 5後続。store→organization Scout quota読取。caller=salon role・is_store_accessible(p_store_id)（既存organization_scout_quotas RLSがcompany_owner/company_admin/recruiting_adminに限定しているのに対し、送信権限(send_scout_v2)と対称に、storeへアクセスできる全staffへ読み取りを開放する）。organization_idはsalon_stores.organization_idのみから取得する。used_this_monthは0034のsend_scout_v2と完全に同一のロジック（store_idが設定されたScoutのみを当月分・organization全店舗で集計）。読み取り専用のため、organization_scout_quotasへの行作成（insert）は行わない（無い場合はsend_scout_v2と同じデフォルト値として扱う）。0034のsend_scout_v2自体は無変更。';
revoke all on function public.get_store_scout_quota(uuid) from public, anon;
grant execute on function public.get_store_scout_quota(uuid) to authenticated;

commit;
