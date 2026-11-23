-- 0098 巻き戻し（草案・初期投入以外のデータが無いときだけ。巻き戻し前→本体→巻き戻し後の自己検証つき）
-- ★単独実行形式（psql専用命令なし）。Supabase SQL Editor に全文を貼り付けて実行できる。不一致は例外で全体がロールバックされる。
-- ★失敗したら『rollback;』だけを単独で実行して状態を確認する。期待値は使い捨てDBでの実測（gen_staff_guards.py）。本番の実定義が検証DBと異なれば『適用前』で中止する（保守的）。
-- ★検査は2種類: 『変更対象』(このSQLが置き換える既存オブジェクトが想定の版か) と 『依存先』(このSQLが前提にするが変更しない関数・表・認証側の参照列・ロールが想定どおりか)。
begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtextextended('beauty-reach-staff-0098', 0));
do $guard$
declare v_cur jsonb; v_exp jsonb := '{"fn:_admin_messages_rules()": "b1677bc07423de967a49be5457b8b23a", "fn:_admin_user_is_operator(uuid)": "727706a1de97f6cf3843a8e958367281", "fn:admin_assign_visit_request(uuid,uuid,timestamp with time zone)": "f8e96bb867d04de466ec08a3c65b04d4", "fn:admin_claim_visit_request(text,uuid)": "7c96f496bab9688c379d36cf7a2953d2", "fn:admin_create_visit_thread(uuid,uuid,text,text,text)": "cd694387b339c7b23d3acd925d26e3e0", "fn:admin_get_thread(uuid)": "6b1a2cf1d8382f8041cbc962f860ad57", "fn:admin_get_visit_request(uuid)": "c50b9e89afc2e7d96633f04b87cd65fe", "fn:admin_list_hiring_processes(text,text,timestamp with time zone,timestamp with time zone,uuid,uuid,integer,integer)": "8f6b34d4a679501814cfa9a041945057", "fn:admin_list_store_culture_readiness(text,text,uuid,integer,integer)": "7a15482b37568a35de5671a02affe274", "fn:admin_list_store_interests(text,timestamp with time zone,timestamp with time zone,uuid,uuid,integer,integer)": "a8849f1f494ca313e8f5fd38e90d7459", "fn:admin_list_threads(uuid,uuid,uuid,text,integer,integer)": "bf7f99043fc3f0088bb1ec20af093e13", "fn:admin_list_visit_requests(text,text,text,uuid,boolean,integer,integer)": "c605b07548f8d366490b7220d9474314", "fn:admin_post_message(uuid,uuid,text,text)": "af5a271ba96bde690f608d0f32be9f07", "fn:admin_record_delivery(uuid,text,text)": "78aa8ba9a0991944b246e79c5cd21ba8", "fn:admin_record_visit_confirmation(uuid,text,text,text,text,timestamp with time zone)": "5cab8c4151898dd4bc582e764604a35a", "fn:admin_set_thread_status(uuid,text)": "b41abf1a6643c3e46ac07b1f8a56ac24", "fn:admin_update_visit_request(uuid,text,timestamp with time zone,date,text,text,uuid)": "070565636bae46758b6d935d8b2ab7d9"}'::jsonb; v_bad text;
begin
  v_cur := (select coalesce(jsonb_object_agg(k, h), '{}'::jsonb) from (select 'fn:' || p.oid::regprocedure::text as k, md5(p.prosrc || '|' || pg_get_function_arguments(p.oid) || '|' || pg_get_function_result(p.oid) || '|' || p.prokind::text || p.prosecdef || p.provolatile::text || p.proparallel::text || p.proleakproof || p.proisstrict || p.proretset || '|' || (select l.lanname from pg_language l where l.oid = p.prolang) || '|' || pg_get_userbyid(p.proowner) || '|' || coalesce((select string_agg(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || '<-' || pg_get_userbyid(a.grantor) || ':' || a.privilege_type || ':' || a.is_grantable, ',' order by case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, pg_get_userbyid(a.grantor), a.privilege_type) from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a),'') || '|' || coalesce(array_to_string(p.proconfig, ','), '')) as h from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f','p') union all select 'rel:' || c.relname, md5(c.relkind::text || '|' || pg_get_userbyid(c.relowner) || '|' || c.relrowsecurity || c.relforcerowsecurity || '|' || coalesce((select string_agg(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || '<-' || pg_get_userbyid(a.grantor) || ':' || a.privilege_type || ':' || a.is_grantable, ',' order by case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, pg_get_userbyid(a.grantor), a.privilege_type) from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a),'') || '|' || coalesce((select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), '') || ':' || a.attidentity::text || a.attgenerated::text, ',' order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped), '') || '|' || coalesce((select string_agg(k.conname || ':' || pg_get_constraintdef(k.oid) || ':' || k.convalidated, ',' order by k.conname) from pg_constraint k where k.conrelid = c.oid), '') || '|' || coalesce((select string_agg(i.indexdef, ',' order by i.indexname) from pg_indexes i where i.schemaname = 'public' and i.tablename = c.relname), '') || '|' || coalesce((select string_agg(o.polname || ':' || o.polcmd::text || ':' || o.polpermissive || ':' || coalesce(pg_get_expr(o.polqual, o.polrelid), '') || ':' || coalesce(pg_get_expr(o.polwithcheck, o.polrelid), '') || ':' || (select coalesce(string_agg(case when r = 0 then 'PUBLIC' else pg_get_userbyid(r) end, ',' order by case when r = 0 then 'PUBLIC' else pg_get_userbyid(r) end), '') from unnest(o.polroles) r), ',' order by o.polname) from pg_policy o where o.polrelid = c.oid), '') || '|' || coalesce((select string_agg(t.tgname || ':' || t.tgenabled::text || ':' || pg_get_triggerdef(t.oid), ',' order by t.tgname) from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal), '')) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m','S','f') union all select 'type:' || t.typname, md5(t.typtype::text || '|' || coalesce((select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid), '')) from pg_type t where t.typnamespace = 'public'::regnamespace and t.typtype = 'e' union all select 'authtrg:' || t.tgname, md5(t.tgenabled::text || pg_get_triggerdef(t.oid)) from pg_trigger t where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal union all select 'deprel:' || c.relname, md5(c.relkind::text || '|' || c.relrowsecurity || c.relforcerowsecurity || '|' || coalesce((select string_agg(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || '<-' || pg_get_userbyid(a.grantor) || ':' || a.privilege_type || ':' || a.is_grantable, ',' order by case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, pg_get_userbyid(a.grantor), a.privilege_type) from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a),'') || '|' || coalesce((select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull, ',' order by a.attname) from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped), '') || '|' || coalesce((select string_agg(k.conname || ':' || pg_get_constraintdef(k.oid), ',' order by k.conname) from pg_constraint k where k.conrelid = c.oid), '') || '|' || coalesce((select string_agg(o.polname || ':' || o.polcmd::text || ':' || coalesce(pg_get_expr(o.polqual, o.polrelid), '') || ':' || coalesce(pg_get_expr(o.polwithcheck, o.polrelid), ''), ',' order by o.polname) from pg_policy o where o.polrelid = c.oid), '') || '|' || coalesce((select string_agg(t.tgname || ':' || t.tgenabled::text || ':' || pg_get_triggerdef(t.oid), ',' order by t.tgname) from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal), '')) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m') union all select 'authcol:' || c.relname || '.' || a.attname, md5(format_type(a.atttypid, a.atttypmod)) from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped where c.relnamespace = 'auth'::regnamespace and c.relname in ('users', 'sessions') and c.relkind in ('r','p') union all select 'authfn:' || p.proname, md5(pg_get_function_identity_arguments(p.oid) || '->' || pg_get_function_result(p.oid)) from pg_proc p where p.pronamespace = 'auth'::regnamespace and p.proname in ('uid', 'jwt', 'role') union all select 'role:' || r.rolname, md5(r.rolname) from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role', 'postgres')) t(k, h));
  select string_agg(e.key, ', ' order by e.key) into v_bad from jsonb_each_text(v_exp) e where v_cur->>e.key is distinct from e.value;
  if v_bad is not null then raise exception 'staff guard [巻き戻し前] 不一致のオブジェクト: %', v_bad using errcode = 'P0001'; end if;
  perform set_config('staff.rb_map', v_cur::text, true);
end $guard$;
-- 0098 巻き戻し草案（未適用）。元の定義へ戻す。スタッフ向け機能は止まる（責任者の動作は元どおり）。
select pg_advisory_xact_lock(hashtext('beauty-reach-0098'));
CREATE OR REPLACE FUNCTION public.admin_assign_visit_request(p_id uuid, p_admin uuid, p_expected_updated_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_uid uuid := auth.uid(); r public.admin_visit_requests;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if p_admin is not null and not exists (select 1 from public.platform_admins where user_id = p_admin) then raise exception 'assignee must be an admin'; end if;
  select * into r from public.admin_visit_requests where id = p_id for update;
  if not found then raise exception 'request not found'; end if;
  if r.updated_at is distinct from p_expected_updated_at then raise exception 'request was updated by someone else'; end if;
  if r.status in ('attended', 'closed') then raise exception 'request is already finished'; end if;
  update public.admin_visit_requests set assigned_admin_id = p_admin where id = r.id;
  insert into public.admin_visit_request_events (request_id, actor_user_id, action, before_value, after_value)
    values (r.id, v_uid, 'assigned', jsonb_build_object('assigned_admin_id', r.assigned_admin_id), jsonb_build_object('assigned_admin_id', p_admin));
end;
$function$;
CREATE OR REPLACE FUNCTION public.admin_claim_visit_request(p_source_kind text, p_source_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_uid uuid := auth.uid(); v_kind text; v_stylist uuid; v_store uuid; v_id uuid;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if p_source_kind = 'scout_reply' then
    select case s.response_status when 'visit_requested' then 'visit' when 'trial_requested' then 'trial' else null end, s.stylist_user_id, s.store_id
      into v_kind, v_stylist, v_store from public.scouts s where s.id = p_source_id;
    if not found then raise exception 'source not found'; end if;
    if v_kind is null then raise exception 'source is not a visit or trial request'; end if;   -- 過去の「話を聞いてみたい」等は読み替えない
    if v_store is null then raise exception 'source has no store'; end if;
    insert into public.admin_visit_requests (source_kind, source_scout_id, kind, stylist_user_id, store_id, assigned_admin_id)
      values ('scout_reply', p_source_id, v_kind, v_stylist, v_store, v_uid) on conflict do nothing returning id into v_id;
    if v_id is null then select id into v_id from public.admin_visit_requests where source_scout_id = p_source_id; return v_id; end if;
  elsif p_source_kind = 'direct_interest' then
    select i.stylist_user_id, i.store_id, i.kind into v_stylist, v_store, v_kind from public.stylist_salon_interests i where i.id = p_source_id;
    if not found then raise exception 'source not found'; end if;
    if v_store is null then raise exception 'source has no store'; end if;
    insert into public.admin_visit_requests (source_kind, source_interest_id, kind, stylist_user_id, store_id, assigned_admin_id)
      values ('direct_interest', p_source_id, v_kind, v_stylist, v_store, v_uid) on conflict do nothing returning id into v_id;
    if v_id is null then select id into v_id from public.admin_visit_requests where source_interest_id = p_source_id; return v_id; end if;
  else
    raise exception 'invalid source kind';
  end if;
  insert into public.admin_visit_request_events (request_id, actor_user_id, action, after_value)
    values (v_id, v_uid, 'claimed', jsonb_build_object('status', 'received', 'assigned_admin_id', v_uid, 'source_kind', p_source_kind));
  return v_id;
end;
$function$;
CREATE OR REPLACE FUNCTION public.admin_get_thread(p_thread_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_result jsonb;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  select jsonb_build_object(
    'thread', jsonb_build_object('id', t.id, 'audience', t.audience, 'subject', t.subject, 'status', t.status, 'organization_id', t.organization_id,
        'store_id', t.store_id, 'visit_case_id', t.visit_case_id, 'recipient_user_id', t.recipient_user_id, 'created_at', t.created_at,
        'recipient_access_lost', (t.audience = 'salon' and t.recipient_user_id is not null and not public._admin_salon_access(t.organization_id, t.store_id, t.recipient_user_id)),
        'salon_reader_count', case when t.audience = 'salon' then (select count(*) from public.organization_members om where om.organization_id = t.organization_id and om.role in ('company_owner','company_admin','recruiting_admin'))
           + (select count(*) from public.store_members sm where sm.store_id = t.store_id and sm.role in ('store_manager','recruiter')) end),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'author_user_id', m.author_user_id,
          'author_name', nullif(u.raw_user_meta_data->>'display_name',''), 'body', m.body, 'created_at', m.created_at,
          'delivery', (select jsonb_build_object('status', d.status, 'error_code', d.error_code, 'attempts', d.attempts) from public.admin_message_deliveries d where d.message_id = m.id))
          order by m.created_at, m.id)
        from public.admin_messages m left join auth.users u on u.id = m.author_user_id where m.thread_id = t.id), '[]'::jsonb)
  ) into v_result from public.admin_threads t where t.id = p_thread_id;
  if v_result is null then raise exception 'thread not found'; end if;
  return v_result;
end $function$;
CREATE OR REPLACE FUNCTION public.admin_get_visit_request(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v jsonb;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  select to_jsonb(r) || jsonb_build_object(
      'source_cancelled', (case r.source_kind when 'direct_interest' then not exists (select 1 from public.stylist_salon_interests i where i.id = r.source_interest_id) else not exists (select 1 from public.scouts s where s.id = r.source_scout_id) end),
      'confirmations', coalesce((select jsonb_agg(to_jsonb(c) order by c.party) from public.admin_visit_confirmations c where c.occurrence_id = r.occurrence_id), '[]'::jsonb),
      'events', coalesce((select jsonb_agg(jsonb_build_object('action', e.action, 'actor_user_id', e.actor_user_id, 'before_value', e.before_value, 'after_value', e.after_value, 'created_at', e.created_at) order by e.created_at) from public.admin_visit_request_events e where e.request_id = r.id), '[]'::jsonb))
    into v from public.admin_visit_requests r where r.id = p_id;
  if v is null then raise exception 'request not found'; end if;
  return v;
end;
$function$;
CREATE OR REPLACE FUNCTION public.admin_list_hiring_processes(p_view text DEFAULT 'all'::text, p_status text DEFAULT NULL::text, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_organization_id uuid DEFAULT NULL::uuid, p_store_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_view text := coalesce(p_view, 'all');
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_now timestamptz := now();
  v_result jsonb;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if v_view not in ('all', 'interview_scheduled', 'interview_elapsed_not_updated') then raise exception 'invalid view'; end if;
  if p_status is not null and p_status not in ('contacting','interview_scheduled','interview_completed','selection','offered','hired','declined','rejected') then
    raise exception 'invalid status';
  end if;
  if p_from is not null and p_to is not null and p_from >= p_to then raise exception 'invalid period'; end if;
  with matched as (
    select hp.id, hp.status, hp.source, hp.store_id, st.store_name, st.organization_id, o.name as organization_name,
           hp.stylist_user_id, sp.public_name, pr.full_name,
           hp.interview_at, hp.interview_type, hp.interview_location,
           (hp.status = 'interview_scheduled' and hp.interview_at is not null and hp.interview_at < v_now) as interview_elapsed_not_updated,
           hp.created_at, hp.updated_at, hp.hired_at, hp.closed_at,
           (select max(e.created_at) from public.store_hiring_process_events e where e.hiring_process_id = hp.id) as last_event_at
    from public.store_hiring_processes hp
    join public.salon_stores st on st.id = hp.store_id
    join public.salon_organizations o on o.id = st.organization_id
    left join public.stylist_profiles sp on sp.user_id = hp.stylist_user_id
    left join public.stylist_private pr on pr.user_id = hp.stylist_user_id
    where (p_organization_id is null or st.organization_id = p_organization_id)
      and (p_store_id is null or hp.store_id = p_store_id)
      and case v_view
            when 'all' then (p_status is null or hp.status = p_status)
                            and (p_from is null or hp.updated_at >= p_from) and (p_to is null or hp.updated_at < p_to)
            when 'interview_scheduled' then hp.status = 'interview_scheduled'
                            and (case when p_from is null and p_to is null then true
                                      else hp.interview_at is not null and (p_from is null or hp.interview_at >= p_from) and (p_to is null or hp.interview_at < p_to) end)
            else hp.status = 'interview_scheduled' and hp.interview_at is not null and hp.interview_at < v_now
                            and (p_from is null or hp.interview_at >= p_from) and (p_to is null or hp.interview_at < p_to)
          end
  ),
  page as (
    select * from matched
    order by case when v_view = 'all' then null else interview_at end asc nulls last, updated_at desc, id
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'as_of', v_now,
    'total', (select count(*) from matched),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'process_id', p.id, 'status', p.status, 'source', p.source,
        'store_id', p.store_id, 'store_name', p.store_name, 'organization_id', p.organization_id, 'organization_name', p.organization_name,
        'stylist_user_id', p.stylist_user_id, 'stylist_public_name', p.public_name, 'stylist_full_name', p.full_name,
        'interview_at', p.interview_at, 'interview_type', p.interview_type, 'interview_location', p.interview_location,
        'interview_elapsed_not_updated', p.interview_elapsed_not_updated,
        'created_at', p.created_at, 'updated_at', p.updated_at, 'hired_at', p.hired_at, 'closed_at', p.closed_at, 'last_event_at', p.last_event_at
      ) order by case when v_view = 'all' then null else p.interview_at end asc nulls last, p.updated_at desc, p.id) from page p), '[]'::jsonb))
  into v_result;
  return v_result;
end;
$function$;
CREATE OR REPLACE FUNCTION public.admin_list_store_culture_readiness(p_state text DEFAULT NULL::text, p_visibility text DEFAULT 'PUBLIC'::text, p_organization_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_k8 text[] := array['education_support','challenge_openness','personal_brand_support','team_collaboration','individual_autonomy','work_flexibility','relationship_distance','hierarchy_flatness'];
  v_k12 text[] := array['education_support','challenge_openness','personal_brand_support','team_collaboration','individual_autonomy','work_flexibility','technical_specialization','premium_value','trend_orientation','creative_output','relationship_distance','hierarchy_flatness'];
  v_result jsonb;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if p_visibility is not null and p_visibility not in ('PUBLIC', 'PRIVATE') then raise exception 'invalid visibility'; end if;
  if p_state is not null and p_state not in ('no_culture_row','not_completed','completed_match_unready','completed_type_unready','ready') then
    raise exception 'invalid state';
  end if;
  with base as (
    select p.store_id, st.store_name, st.organization_id, o.name as organization_name, p.visibility::text as visibility,
           (c.store_id is not null) as row_exists, c.status::text as culture_status, c.culture_axes, c.updated_at as culture_updated_at
    from public.salon_store_profiles p
    join public.salon_stores st on st.id = p.store_id
    join public.salon_organizations o on o.id = st.organization_id
    left join public.salon_store_culture_profiles c on c.store_id = p.store_id
    where (p_visibility is null or p.visibility::text = p_visibility)
      and (p_organization_id is null or st.organization_id = p_organization_id)
  ),
  classified as (
    select b.*, public._admin_store_culture_state(b.row_exists, b.culture_status, b.culture_axes) as state from base b
  ),
  matched as (select * from classified where p_state is null or state = p_state),
  page as (select * from matched order by organization_name, store_name, store_id limit v_limit offset v_offset)
  select jsonb_build_object(
    'as_of', now(),
    'total', (select count(*) from matched),
    'summary', jsonb_build_object(
      'stores', (select count(*) from classified),
      'no_culture_row', (select count(*) from classified where state = 'no_culture_row'),
      'not_completed', (select count(*) from classified where state = 'not_completed'),
      'completed_match_unready', (select count(*) from classified where state = 'completed_match_unready'),
      'completed_type_unready', (select count(*) from classified where state = 'completed_type_unready'),
      'ready', (select count(*) from classified where state = 'ready')),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'store_id', p.store_id, 'store_name', p.store_name, 'organization_id', p.organization_id, 'organization_name', p.organization_name,
        'visibility', p.visibility, 'culture_row_exists', p.row_exists, 'culture_status', p.culture_status,
        'culture_updated_at', p.culture_updated_at, 'state', p.state,
        'match_axes', public._admin_axis_problems(p.culture_axes, v_k8),
        'type_axes', public._admin_axis_problems(p.culture_axes, v_k12)
      ) order by p.organization_name, p.store_name, p.store_id) from page p), '[]'::jsonb))
  into v_result;
  return v_result;
end;
$function$;
CREATE OR REPLACE FUNCTION public.admin_list_store_interests(p_progress text DEFAULT NULL::text, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_organization_id uuid DEFAULT NULL::uuid, p_store_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_result jsonb;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if p_progress is not null and p_progress not in ('not_created', 'created') then raise exception 'invalid progress'; end if;
  if p_from is not null and p_to is not null and p_from >= p_to then raise exception 'invalid period'; end if;
  with matched as (
    select i.id as interest_id, i.kind, i.created_at, i.stylist_user_id, sp.public_name, pr.full_name,
           i.store_id, st.store_name, st.organization_id, o.name as organization_name,
           hp.id as process_id, hp.status as process_status, hp.source as process_source,
           case when hp.id is null then 'not_created' else 'created' end as progress_state
    from public.stylist_salon_interests i
    join public.salon_stores st on st.id = i.store_id
    join public.salon_organizations o on o.id = st.organization_id
    left join public.store_hiring_processes hp on hp.store_id = i.store_id and hp.stylist_user_id = i.stylist_user_id
    left join public.stylist_profiles sp on sp.user_id = i.stylist_user_id
    left join public.stylist_private pr on pr.user_id = i.stylist_user_id
    where i.store_id is not null
      and (p_organization_id is null or st.organization_id = p_organization_id)
      and (p_store_id is null or i.store_id = p_store_id)
      and (p_from is null or i.created_at >= p_from) and (p_to is null or i.created_at < p_to)
      and (p_progress is null or (case when hp.id is null then 'not_created' else 'created' end) = p_progress)
  ),
  page as (select * from matched order by created_at desc, interest_id limit v_limit offset v_offset)
  select jsonb_build_object(
    'as_of', now(),
    'total', (select count(*) from matched),
    'legacy_rows_without_store', (select count(*) from public.stylist_salon_interests where store_id is null),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'interest_id', p.interest_id, 'kind', p.kind, 'created_at', p.created_at,
        'stylist_user_id', p.stylist_user_id, 'stylist_public_name', p.public_name, 'stylist_full_name', p.full_name,
        'store_id', p.store_id, 'store_name', p.store_name, 'organization_id', p.organization_id, 'organization_name', p.organization_name,
        'progress_state', p.progress_state, 'process_id', p.process_id, 'process_status', p.process_status, 'process_source', p.process_source
      ) order by p.created_at desc, p.interest_id) from page p), '[]'::jsonb))
  into v_result;
  return v_result;
end;
$function$;
CREATE OR REPLACE FUNCTION public.admin_list_threads(p_organization_id uuid DEFAULT NULL::uuid, p_store_id uuid DEFAULT NULL::uuid, p_visit_case_id uuid DEFAULT NULL::uuid, p_status text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100); v_offset int := greatest(coalesce(p_offset, 0), 0); v_result jsonb;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if p_status is not null and p_status not in ('open_internal','waiting_recipient','waiting_admin','done') then raise exception 'invalid status'; end if;
  with m as (
    select t.* from public.admin_threads t
    where (p_organization_id is null or t.organization_id = p_organization_id)
      and (p_store_id is null or t.store_id = p_store_id)
      and (p_visit_case_id is null or t.visit_case_id = p_visit_case_id)
      and (p_status is null or t.status = p_status)
  ), page as (select * from m order by updated_at desc, id limit v_limit offset v_offset)
  select jsonb_build_object('total', (select count(*) from m),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'audience', p.audience, 'subject', p.subject, 'status', p.status, 'updated_at', p.updated_at,
        'organization_id', p.organization_id, 'organization_name', (select o.name from public.salon_organizations o where o.id = p.organization_id),
        'store_id', p.store_id, 'store_name', (select s.store_name from public.salon_stores s where s.id = p.store_id),
        'visit_case_id', p.visit_case_id, 'recipient_user_id', p.recipient_user_id,
        'recipient_access_lost', (p.audience = 'salon' and p.recipient_user_id is not null and not public._admin_salon_access(p.organization_id, p.store_id, p.recipient_user_id)),
        'delivery_failed', exists (select 1 from public.admin_message_deliveries d join public.admin_messages mm on mm.id = d.message_id
                                   where mm.thread_id = p.id and d.status = 'failed')
      ) order by p.updated_at desc, p.id) from page p), '[]'::jsonb)) into v_result;
  return v_result;
end $function$;
CREATE OR REPLACE FUNCTION public.admin_list_visit_requests(p_entrance text DEFAULT NULL::text, p_kind text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_assignee uuid DEFAULT NULL::uuid, p_include_legacy boolean DEFAULT false, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_result jsonb;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if p_entrance is not null and p_entrance not in ('scout_reply', 'direct_interest') then raise exception 'invalid entrance'; end if;
  if p_kind is not null and p_kind not in ('visit', 'trial') then raise exception 'invalid kind'; end if;
  if p_status is not null and p_status not in ('unclaimed', 'received', 'reviewing', 'scheduling', 'scheduled', 'post_visit_check', 'attended', 'closed') then raise exception 'invalid status'; end if;
  with src as (
    select 'scout_reply'::text as entrance, case s.response_status when 'visit_requested' then 'visit' when 'trial_requested' then 'trial' else null end as kind,
           (s.response_status = 'interested') as legacy, s.id as source_id, s.stylist_user_id, s.store_id, s.responded_at as requested_at, false as source_cancelled
    from public.scouts s
    where s.response_status in ('visit_requested', 'trial_requested') or (p_include_legacy and s.response_status = 'interested')
    union all
    select 'direct_interest', i.kind, false, i.id, i.stylist_user_id, i.store_id, i.created_at, false
    from public.stylist_salon_interests i where i.store_id is not null
    union all   -- 元の希望が取消（削除）された受付: 受付・履歴は残し、一覧から消さない
    select q.source_kind, q.kind, false, coalesce(q.source_scout_id, q.source_interest_id), q.stylist_user_id, q.store_id, q.created_at, true
    from public.admin_visit_requests q
    where (q.source_kind = 'direct_interest' and not exists (select 1 from public.stylist_salon_interests i where i.id = q.source_interest_id))
       or (q.source_kind = 'scout_reply' and not exists (select 1 from public.scouts s where s.id = q.source_scout_id))
  ),
  matched as (
    select x.entrance, x.kind, x.legacy, x.source_id, x.stylist_user_id, x.store_id, x.requested_at, x.source_cancelled,
           st.store_name, st.organization_id, o.name as organization_name, sp.public_name, pr.full_name,
           r.id as request_id, coalesce(r.status, 'unclaimed') as status, r.assigned_admin_id, r.scheduled_on, r.closed_reason,
           r.merged_into_request_id, r.occurrence_id, (r.internal_note is not null) as has_note, r.updated_at,
           (select c.result from public.admin_visit_confirmations c where c.occurrence_id = r.occurrence_id and c.party = 'salon') as salon_confirmation,
           (select c.result from public.admin_visit_confirmations c where c.occurrence_id = r.occurrence_id and c.party = 'stylist') as stylist_confirmation
    from src x
    join public.salon_stores st on st.id = x.store_id
    join public.salon_organizations o on o.id = st.organization_id
    left join public.admin_visit_requests r on (x.entrance = 'scout_reply' and r.source_scout_id = x.source_id) or (x.entrance = 'direct_interest' and r.source_interest_id = x.source_id)
    left join public.stylist_profiles sp on sp.user_id = x.stylist_user_id
    left join public.stylist_private pr on pr.user_id = x.stylist_user_id
    where (p_entrance is null or x.entrance = p_entrance)
      and (p_kind is null or x.kind = p_kind)
      and (p_status is null or coalesce(r.status, 'unclaimed') = p_status)
      and (p_assignee is null or r.assigned_admin_id = p_assignee)
  ),
  page as (select * from matched order by requested_at desc nulls last, source_id limit v_limit offset v_offset)
  select jsonb_build_object(
    'as_of', now(),
    'total', (select count(*) from matched),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
      'entrance', p.entrance, 'kind', p.kind, 'legacy_interested', p.legacy, 'source_id', p.source_id, 'requested_at', p.requested_at, 'source_cancelled', p.source_cancelled,
      'stylist_user_id', p.stylist_user_id, 'stylist_public_name', p.public_name, 'stylist_full_name', p.full_name,
      'store_id', p.store_id, 'store_name', p.store_name, 'organization_id', p.organization_id, 'organization_name', p.organization_name,
      'request_id', p.request_id, 'status', p.status, 'assigned_admin_id', p.assigned_admin_id, 'scheduled_on', p.scheduled_on,
      'closed_reason', p.closed_reason, 'merged_into_request_id', p.merged_into_request_id, 'occurrence_id', p.occurrence_id, 'has_note', p.has_note, 'updated_at', p.updated_at,
      'salon_confirmation', p.salon_confirmation, 'stylist_confirmation', p.stylist_confirmation
    ) order by p.requested_at desc nulls last, p.source_id) from page p), '[]'::jsonb))
  into v_result;
  return v_result;
end;
$function$;
CREATE OR REPLACE FUNCTION public.admin_post_message(p_request_id uuid, p_thread_id uuid, p_kind text, p_body text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_uid uuid := auth.uid(); v_msg uuid; v_hash text; v_prev record; v_body text := btrim(coalesce(p_body, ''));
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if p_request_id is null then raise exception 'request id required'; end if;
  if p_kind not in ('to_recipient','internal_note','offline_log') then raise exception 'invalid kind'; end if;
  if char_length(v_body) = 0 then raise exception 'invalid body'; end if;
  v_hash := public._admin_request_hash('post_message', coalesce(p_thread_id::text,''), p_kind, v_body);
  perform public._admin_lock_request(v_uid, p_request_id);                                   -- ②
  select m.id, m.request_hash into v_prev from public.admin_messages m where m.author_user_id = v_uid and m.request_id = p_request_id;
  if found then
    if v_prev.request_hash <> v_hash then raise exception 'request id content mismatch'; end if;
    return v_prev.id;
  end if;
  perform 1 from public.admin_threads where id = p_thread_id for update;                    -- ③
  if not found then raise exception 'thread not found'; end if;
  insert into public.admin_messages (thread_id, kind, author_user_id, body, request_id, request_hash) values (p_thread_id, p_kind, v_uid, v_body, p_request_id, v_hash) returning id into v_msg;
  if p_kind = 'to_recipient' then
    insert into public.admin_message_deliveries (message_id) values (v_msg);
    update public.admin_threads set status = 'waiting_recipient', updated_at = now() where id = p_thread_id;   -- 完了後の追記は再開になる
  else
    update public.admin_threads set updated_at = now() where id = p_thread_id;
  end if;
  return v_msg;
end $function$;
CREATE OR REPLACE FUNCTION public.admin_record_delivery(p_message_id uuid, p_status text, p_error_code text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if p_status not in ('sent','failed','skipped') then raise exception 'invalid status'; end if;
  update public.admin_message_deliveries set status = p_status, error_code = case when p_status = 'failed' then left(p_error_code, 80) else null end,
    attempts = attempts + 1, last_attempt_at = now()
  where message_id = p_message_id;
  if not found then raise exception 'delivery not found'; end if;
end $function$;
CREATE OR REPLACE FUNCTION public.admin_record_visit_confirmation(p_request_id uuid, p_party text, p_result text, p_channel text, p_note text DEFAULT NULL::text, p_confirmed_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_uid uuid := auth.uid(); r public.admin_visit_requests; o public.admin_visit_occurrences; v_before jsonb;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if p_party not in ('salon', 'stylist') then raise exception 'invalid party'; end if;
  if p_result not in ('held', 'not_held') then raise exception 'invalid result'; end if;
  if p_channel not in ('message', 'phone', 'other') then raise exception 'invalid channel'; end if;
  if p_note is not null and char_length(p_note) > 1000 then raise exception 'note too long'; end if;
  -- ロック順: 実施単位 → 受付（update と同じ）
  select * into r from public.admin_visit_requests where id = p_request_id;
  if not found then raise exception 'request not found'; end if;
  if r.occurrence_id is null then raise exception 'confirmations can be recorded only in post_visit_check'; end if;
  select * into o from public.admin_visit_occurrences where id = r.occurrence_id for update;
  select * into r from public.admin_visit_requests where id = p_request_id for update;
  if r.status <> 'post_visit_check' or r.occurrence_id is distinct from o.id then raise exception 'confirmations can be recorded only in post_visit_check'; end if;
  if o.status <> 'post_visit_check' then raise exception 'confirmations can be recorded only in post_visit_check'; end if;
  select jsonb_build_object('result', c.result, 'channel', c.channel) into v_before from public.admin_visit_confirmations c where c.occurrence_id = o.id and c.party = p_party;
  insert into public.admin_visit_confirmations (occurrence_id, party, result, channel, confirmed_at, recorded_by, note)
    values (o.id, p_party, p_result, p_channel, coalesce(p_confirmed_at, now()), v_uid, nullif(btrim(p_note), ''))
    on conflict (occurrence_id, party) do update set result = excluded.result, channel = excluded.channel, confirmed_at = excluded.confirmed_at, recorded_by = excluded.recorded_by, note = excluded.note;
  insert into public.admin_visit_request_events (request_id, actor_user_id, action, before_value, after_value)
    values (r.id, v_uid, 'confirmation_recorded', v_before, jsonb_build_object('party', p_party, 'result', p_result, 'channel', p_channel, 'occurrence_id', o.id));
end;
$function$;
CREATE OR REPLACE FUNCTION public.admin_set_thread_status(p_thread_id uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_old text;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if p_status not in ('open_internal','waiting_recipient','waiting_admin','done') then raise exception 'invalid status'; end if;
  select status into v_old from public.admin_threads where id = p_thread_id for update;   -- ③
  if not found then raise exception 'thread not found'; end if;
  if v_old = p_status then return; end if;
  update public.admin_threads set status = p_status, updated_at = now() where id = p_thread_id;
  insert into public.admin_audit_events (actor_user_id, action, target_type, target_id, before_value, after_value)
    values (auth.uid(), 'thread_status_changed', 'thread', p_thread_id, jsonb_build_object('status', v_old), jsonb_build_object('status', p_status));
end $function$;
CREATE OR REPLACE FUNCTION public.admin_update_visit_request(p_id uuid, p_status text, p_expected_updated_at timestamp with time zone, p_scheduled_on date DEFAULT NULL::date, p_internal_note text DEFAULT NULL::text, p_closed_reason text DEFAULT NULL::text, p_merged_into uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid(); r public.admin_visit_requests; v_before text; v_note text; v_date date; v_target public.admin_visit_requests;
  v_today date := (now() at time zone 'Asia/Tokyo')::date; v_salon text; v_stylist text;
  o public.admin_visit_occurrences; v_old_occ uuid; v_new_occ uuid; sib record; r0 public.admin_visit_requests; v_pre_date date;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if p_status is null or p_status not in ('received','reviewing','scheduling','scheduled','post_visit_check','attended','closed') then raise exception 'invalid status'; end if;
  -- ロック順（全RPC共通）: ①実施単位（idの昇順）→ ②受付。同じ実施に関連する別入口の受付を同時に更新・実施確定・確認記録しても、
  -- 先に実施単位を取るため互いに待つだけでデッドロックしない（受付だけを先に取る経路を作らない）。
  select * into r0 from public.admin_visit_requests where id = p_id;     -- ロックなしで、関連する実施単位を知る
  if not found then raise exception 'request not found'; end if;
  v_new_occ := null;
  if p_status = 'scheduled' then
    v_pre_date := coalesce(p_scheduled_on, r0.scheduled_on);
    if v_pre_date is not null then
      insert into public.admin_visit_occurrences (stylist_user_id, store_id, kind, visit_date) values (r0.stylist_user_id, r0.store_id, r0.kind, v_pre_date) on conflict do nothing;
      select id into v_new_occ from public.admin_visit_occurrences where stylist_user_id = r0.stylist_user_id and store_id = r0.store_id and kind = r0.kind and visit_date = v_pre_date;
    end if;
  end if;
  perform 1 from public.admin_visit_occurrences x where x.id in (r0.occurrence_id, v_new_occ) order by x.id for update;
  select * into r from public.admin_visit_requests where id = p_id for update;      -- 行ロック: 確認・更新・履歴を同じトランザクションで
  if not found then raise exception 'request not found'; end if;
  if r.occurrence_id is distinct from r0.occurrence_id then raise exception 'request was updated by someone else'; end if;   -- ロックなしで読んだ後に付け替わった
  if r.updated_at is distinct from p_expected_updated_at then raise exception 'request was updated by someone else'; end if;
  if r.status in ('attended', 'closed') then raise exception 'request is already finished'; end if;
  if not public._admin_visit_transition_ok(r.status, p_status) then raise exception 'invalid transition % -> %', r.status, p_status; end if;
  v_before := r.status; v_old_occ := r.occurrence_id;
  v_note := case when p_internal_note is null then r.internal_note else nullif(btrim(p_internal_note), '') end;
  if v_note is not null and char_length(v_note) > 2000 then raise exception 'note too long'; end if;
  v_date := coalesce(p_scheduled_on, r.scheduled_on);
  if p_status in ('scheduled', 'post_visit_check', 'attended') and v_date is null then raise exception 'scheduled date required'; end if;
  if p_status in ('post_visit_check', 'attended') and v_date > v_today then raise exception 'visit date has not come yet'; end if;
  if p_status in ('post_visit_check', 'attended') and p_scheduled_on is not null and p_scheduled_on is distinct from r.scheduled_on then
    raise exception 'change the date while scheduled, not after the visit check started';
  end if;
  if p_status = 'closed' then
    if p_closed_reason is null or p_closed_reason not in ('not_held','declined','duplicate','cancelled','other') then raise exception 'closed reason required'; end if;
    if p_closed_reason = 'duplicate' then
      select * into v_target from public.admin_visit_requests where id = p_merged_into;
      if not found or v_target.id = r.id or v_target.status = 'closed' or v_target.stylist_user_id <> r.stylist_user_id or v_target.store_id <> r.store_id or v_target.kind <> r.kind then
        raise exception 'merge target must be another open request of the same stylist, store and kind';
      end if;
    end if;
  end if;
  -- 実施単位の関連付け（同じ美容師×店舗×種別×実施日は入口が違っても同じ実施単位。ロックは上で取得済み）
  if p_status = 'scheduled' then
    select * into o from public.admin_visit_occurrences where id = v_new_occ;
    if o.status = 'attended' then raise exception 'the same visit is already completed; close this request as duplicate'; end if;
    if o.status = 'cancelled' then update public.admin_visit_occurrences set status = 'scheduled' where id = o.id; end if;
    v_new_occ := o.id;
  elsif p_status in ('post_visit_check', 'attended') then
    select * into o from public.admin_visit_occurrences where id = r.occurrence_id;      -- ロック済み
    v_new_occ := o.id;
    if p_status = 'post_visit_check' and o.status = 'scheduled' then update public.admin_visit_occurrences set status = 'post_visit_check' where id = o.id; end if;
    if p_status = 'attended' then
      select c.result into v_salon from public.admin_visit_confirmations c where c.occurrence_id = o.id and c.party = 'salon';
      select c.result into v_stylist from public.admin_visit_confirmations c where c.occurrence_id = o.id and c.party = 'stylist';
      if v_salon is distinct from 'held' or v_stylist is distinct from 'held' then raise exception 'both parties must confirm the visit was held'; end if;
      if o.status <> 'attended' then update public.admin_visit_occurrences set status = 'attended', attended_at = now() where id = o.id; end if;
    end if;
  end if;
  update public.admin_visit_requests set status = p_status, scheduled_on = case when p_status in ('scheduling','closed') and p_status <> 'scheduling' then r.scheduled_on when p_status = 'scheduling' then v_date else v_date end,
      occurrence_id = case when p_status in ('scheduled','post_visit_check','attended') then v_new_occ when p_status = 'closed' then r.occurrence_id else null end,
      internal_note = v_note, closed_reason = case when p_status = 'closed' then p_closed_reason else null end,
      merged_into_request_id = case when p_status = 'closed' and p_closed_reason = 'duplicate' then p_merged_into else null end
    where id = r.id returning * into r;
  -- 実施単位が誰にも使われなくなり、まだ実施済みでなければ「取消」にする（実施済みは決して動かさない）
  if v_old_occ is not null and v_old_occ is distinct from r.occurrence_id or (p_status = 'closed' and r.occurrence_id is not null) then
    update public.admin_visit_occurrences x set status = 'cancelled'
      where x.id in (v_old_occ, r.occurrence_id) and x.status in ('scheduled', 'post_visit_check')
        and not exists (select 1 from public.admin_visit_requests q where q.occurrence_id = x.id and q.status not in ('closed') and q.id <> r.id)
        and (x.id is distinct from r.occurrence_id or p_status = 'closed');
  end if;
  -- 実施済みにしたとき、同じ実施単位に残る他の未終了の受付（別入口の重複）は「重複」として統合クローズ
  if p_status = 'attended' then
    for sib in select id from public.admin_visit_requests where occurrence_id = r.occurrence_id and id <> r.id and status <> 'closed' for update loop
      update public.admin_visit_requests set status = 'closed', closed_reason = 'duplicate', merged_into_request_id = r.id where id = sib.id;
      insert into public.admin_visit_request_events (request_id, actor_user_id, action, after_value) values (sib.id, v_uid, 'auto_closed_duplicate', jsonb_build_object('merged_into', r.id));
    end loop;
  end if;
  insert into public.admin_visit_request_events (request_id, actor_user_id, action, before_value, after_value)
    values (r.id, v_uid, 'updated', jsonb_build_object('status', v_before), jsonb_build_object('status', r.status, 'scheduled_on', r.scheduled_on, 'closed_reason', r.closed_reason, 'occurrence_id', r.occurrence_id));
  return to_jsonb(r) - 'internal_note';
end;
$function$;
CREATE OR REPLACE FUNCTION public._admin_messages_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if tg_op = 'UPDATE' then raise exception 'messages are append-only'; end if;
  if tg_op = 'DELETE' then
    if pg_trigger_depth() = 1 then raise exception 'messages are append-only'; end if;
    return old;
  end if;
  if new.kind in ('to_recipient','internal_note','offline_log') and not exists (select 1 from public.platform_admins pa where pa.user_id = new.author_user_id) then
    raise exception 'only admins can write this kind of message';
  end if;
  if new.kind = 'from_recipient' and not public._admin_thread_visible_to(new.thread_id, new.author_user_id) then
    raise exception 'author cannot access this thread';
  end if;
  return new;
end $function$;
drop function public.admin_create_visit_thread(uuid, uuid, text, text, text);
drop function public._admin_user_is_operator(uuid);

do $guard$
declare v_cur jsonb; v_exp jsonb := '{"authcol:sessions.aal": "85abaead201b7fc99b48cdb913ac8432", "authcol:sessions.created_at": "78a4814f9534f1fcc5c04078c5611170", "authcol:sessions.factor_id": "ef7c876f00f3acddd00fa671f52d0b1f", "authcol:sessions.id": "ef7c876f00f3acddd00fa671f52d0b1f", "authcol:sessions.ip": "8a04744caa2093ec5bfa9c2084166336", "authcol:sessions.not_after": "78a4814f9534f1fcc5c04078c5611170", "authcol:sessions.oauth_client_id": "ef7c876f00f3acddd00fa671f52d0b1f", "authcol:sessions.refresh_token_counter": "428fda282c5955ae90508b5edf6812cf", "authcol:sessions.refresh_token_hmac_key": "1cb251ec0d568de6a929b520c4aed8d1", "authcol:sessions.refreshed_at": "81ffa33bf51e38bb80e14641b2745988", "authcol:sessions.scopes": "1cb251ec0d568de6a929b520c4aed8d1", "authcol:sessions.tag": "1cb251ec0d568de6a929b520c4aed8d1", "authcol:sessions.updated_at": "78a4814f9534f1fcc5c04078c5611170", "authcol:sessions.user_agent": "1cb251ec0d568de6a929b520c4aed8d1", "authcol:sessions.user_id": "ef7c876f00f3acddd00fa671f52d0b1f", "authcol:users.created_at": "78a4814f9534f1fcc5c04078c5611170", "authcol:users.email": "a20daa930d502ea043e41d242e6be226", "authcol:users.email_confirmed_at": "78a4814f9534f1fcc5c04078c5611170", "authcol:users.id": "ef7c876f00f3acddd00fa671f52d0b1f", "authcol:users.last_sign_in_at": "78a4814f9534f1fcc5c04078c5611170", "authcol:users.raw_user_meta_data": "cd8a1292080b231b3e9a85d440b02023", "authfn:jwt": "0d29593f5ddb1c1ef765cb9e1e55ca50", "authfn:role": "2e7ce5d2fc1dfc8799711e493191b018", "authfn:uid": "58627ab0dc7622a31c473a39e78ac4aa", "authtrg:on_auth_user_created": "ad50206fdcc3118d46c1098042f6791e", "deprel:account_invitation_events": "a45e7de5b01068a0489169b7080d8195", "deprel:account_invitations": "2c8766654a740ada050875e4b7d54bda", "deprel:account_recovery_requests": "3c0835c89b6708f5e0c2ca5112583662", "deprel:admin_audit_events": "c39ec7c8bc9b5a3a5788a6e4d14a1e20", "deprel:admin_invoice_checkouts": "a7da5ba852e09c95396202a27139ce34", "deprel:admin_invoice_lines": "11a2cf5a90b3b0490be6c05722c629ed", "deprel:admin_invoice_webhook_events": "b94ff03459db2a9e93a7ad430e4bc186", "deprel:admin_invoices": "4040758b34b82b0fe772935a5e63c9f7", "deprel:admin_message_deliveries": "8d997e98e7d913f69ac16120f44ae376", "deprel:admin_messages": "ddf0638465f8f886e45435db70c31af4", "deprel:admin_quotes": "50ede29ec3e9a050ff649ce576818bac", "deprel:admin_staff": "61aeae355319b94d91adabce30d68033", "deprel:admin_staff_events": "f9b74f137c98d065f1f582dca3142c4a", "deprel:admin_staff_invitations": "b23a4ad71092467ce0652285af7e48d4", "deprel:admin_threads": "641fef2578fbae21d50c10921bc752e3", "deprel:admin_unresolved_billing_cases": "09771cee3b9e2442f8bdcf24f0aaee2d", "deprel:admin_visit_cases": "dafa2816aefbdacf7e6a03f6ab72a974", "deprel:admin_visit_confirmations": "78861422d157f44429741af3c6b5d1c5", "deprel:admin_visit_occurrences": "0c79b58fbd6b070420296f8664d51336", "deprel:admin_visit_request_events": "67f07151ca0f842472638d1cb8dc2ca5", "deprel:admin_visit_requests": "c2dbc019d5c5220dba03ef1e605b49fa", "deprel:age_disclosure_requests": "4442abe63f2b28dcd40b3c181b98731a", "deprel:billing_issuer_settings": "aa3c51ae88deeca93493cf9088aeccdd", "deprel:billing_issuer_settings_events": "a5c17b5ba634e212a972a37d559bb3d1", "deprel:diagnosis_ai_outputs": "b7fd2b8601f28985ada4d66af2dcfbe9", "deprel:diagnosis_change_limits": "1b143a089a3be626c77c37e64faa5352", "deprel:diagnosis_results": "2f5b15a5fa689d02e4e44badc5a6b017", "deprel:diagnosis_save_requests": "2cba77f1ae529aa236f240a0f047b9e1", "deprel:employee_size_master": "316b3cd91e06190523f524c0924c13b9", "deprel:feature_pauses": "deb1c17796711b045cbbb7c01a76ba92", "deprel:hiring_process_billing_basis": "abeb71bd3d4d7c32e3d1581572a916d3", "deprel:hiring_success_fee_events": "a9434c63e6c9970441a558098c002908", "deprel:hiring_success_fees": "005414387f5612fef6e22a7938c36fe3", "deprel:invoice_document_events": "62169a4830d003278f2b747e7a190135", "deprel:invoice_documents": "b877b1bc310394e79844d878af66d6f2", "deprel:invoice_number_counters": "5b7579a68a7714ad46f5668124e05bd6", "deprel:legal_documents": "4258db53dc567d89e606fea139133e8a", "deprel:notification_email_config": "aef329c586275fabaad40504db544528", "deprel:notification_email_outbox": "07321470468b8b536f68f415ac81be18", "deprel:notification_email_outbox_events": "4397a687caaf4acc7b0673c9da435e57", "deprel:notification_email_preferences": "07659d6601d4f4250dd27c90756b6ec3", "deprel:notifications": "40cd194be3c9ee7c238c85799051eaba", "deprel:organization_billing_profile_events": "cef5122e5fa4aad4fea0fb4770bf6c91", "deprel:organization_billing_profiles": "4370e118badfde7727fd6f0ae0e7a332", "deprel:organization_billing_regime": "cc73971ba5936767e659a1aadd522385", "deprel:organization_contract_events": "833d01c75852523b83feff7062b3c1d3", "deprel:organization_contract_settings": "a805447edaf93f700f21f992aaa8c116", "deprel:organization_location_events": "dcaedd3dd9b925ded958561b3ecb8c0b", "deprel:organization_members": "f4ac63a805b2f84cbeb9da23a7877bb9", "deprel:organization_payment_accounts": "563207b9ba5145600b2a3f15a18bc2be", "deprel:organization_scout_quotas": "223acf334e004171b1a7d52f3c2a93fc", "deprel:organization_subscriptions": "ccf60844bf3d262880daccf36bd0f88f", "deprel:pending_diagnoses": "92d19ec43029721fa38006b9372aa81c", "deprel:platform_admins": "6f50dd58e387003d7474ebbea5215ee0", "deprel:profiles": "3a706c60a4f8fe06aa423eca00eac873", "deprel:rate_limit_counters": "189478b5cf168f74faef62281130c1da", "deprel:rate_limit_reservations": "2cd14dfbbd7b9b6f9feb34f29d3ee556", "deprel:salary_offers": "83033e3eaaa5b574a2f5c6694d5999e7", "deprel:salon_culture_ai_outputs": "3b9fbb61c49e0c7f42d23cf31f029147", "deprel:salon_culture_analysis_answers": "c09908521b66625d2cf3d584e525fe4f", "deprel:salon_culture_drafts": "b16b3799e802b2ef9373283d3d9218b9", "deprel:salon_culture_profiles": "95df4f043eef5b7ba4ba4d4bf570b183", "deprel:salon_inquiries": "387ce83e9452ced91c6c42eaecd4b31d", "deprel:salon_links": "9e6ca6629ee5d98c281c4674875247b1", "deprel:salon_onboarding_assignments": "5bd81eb49d756438c62cd3de041a63ef", "deprel:salon_organizations": "f7b4fcd6393d980fd13e0b3ee0cd91d0", "deprel:salon_photos": "a6a625e3659828bc393302069e29e6b0", "deprel:salon_profile_text_baseline_0088": "a4977f6aad18431a9648f3fd85f97fcf", "deprel:salon_profiles": "fee6b51cf6a1b8c357a4276d1afdca5f", "deprel:salon_scout_quotas": "dbd26f6d2cb2a76b874e1793b8f94cc8", "deprel:salon_store_culture_profiles": "8d75b7bd5c661781d9301b5f128ea4cb", "deprel:salon_store_links": "27534882df870791b724562d09b3eaeb", "deprel:salon_store_logos": "9a73c12613038d609975a6f24121fc2b", "deprel:salon_store_photos": "f0f840d4123dfed63ab7e47c1d689506", "deprel:salon_store_profile_backfill_0057": "8174308fe0b27cfcc4f5e07a0e36d246", "deprel:salon_store_profile_text_history": "dffc318c261d6e50ae47afe2d147b27e", "deprel:salon_store_profiles": "b8a48f5530e6873fe1c4596ef70b9fa4", "deprel:salon_stores": "19d3e76cca9047f9202f385fbf2b6539", "deprel:scout_credit_packages": "563df6fd7ccd60c4ff1bd32729d660c0", "deprel:scout_credit_purchases": "c56125c4a6478cfa04b4b4cf8e0d2374", "deprel:scout_optout_migration_0070": "cc036222bbf59687b79020fca4f523a0", "deprel:scouts": "5f9b8d0cbad8371b0d34040cf160194a", "deprel:store_hiring_process_events": "93eac6b00e2b0e77ea54792a5af5c525", "deprel:store_hiring_processes": "752dc73c404649ecc0f2d8cbfbd99539", "deprel:store_members": "b9d86e3ee727ae655cb76e3fc2d2060d", "deprel:stripe_checkout_records": "8ef707cfabeebcf0c5066df35df38020", "deprel:stripe_integrity_issues": "966bd59b37048970a30e4b3d2ae59a77", "deprel:stripe_webhook_events": "f30ef1af429529b4e0ea27ae11cb622f", "deprel:student_diagnosis_results": "358fd2ab00d59a769ad091c23419570a", "deprel:stylist_core_type_assignments": "07fc745bcd29738961f10681b788b65f", "deprel:stylist_core_type_history": "a2ee54774662b25a66c31879424808b0", "deprel:stylist_diagnosis_current": "2122965ed2ee962f7ba4055840f07d00", "deprel:stylist_evidence_documents": "e0dccdd78b795e14a8e1067948393b33", "deprel:stylist_favorite_salons": "9a5d9574ce63c7bf40de19025418c29d", "deprel:stylist_match_profiles": "9d03d98276d49daaa270a1199433ccac", "deprel:stylist_match_verification_snapshots": "504f28eec22493886401b6a6d92da66a", "deprel:stylist_preference_profiles": "0f1fdd596c7e0becdc219482f938a4d4", "deprel:stylist_private": "1a2ba6bc5ff6fc17cf08ce58da83d046", "deprel:stylist_profiles": "bc59aab5a142db28572b32787c58347b", "deprel:stylist_salon_interests": "d2387781135c0bf75d42a4e2ade605da", "deprel:subscription_invoice_document_events": "12071cd43f545782a1a4b28cd6e2503f", "deprel:subscription_invoice_documents": "bfa733bffd516cbd1ed2be06e93ebd61", "deprel:subscription_invoice_payments": "09ae5f4e3317209d7356dc202bf483c3", "deprel:success_fee_payments": "acb96b12f5cee56728603c7fd047d62a", "deprel:user_legal_acceptances": "ec9d0384b31ff36a1026caab5fd6758c", "deprel:user_roles": "01d8fd0aaa9ac87da79ebe94b4614d9d", "deprel:user_settings": "93ed8219f0c8c37ddae024ec89809560", "fn:_admin_assert_invoice_correctable(uuid)": "f87a7df722237671749db9dee59c5637", "fn:_admin_axis_problems(jsonb,text[])": "abb2dd939127c820699335aca98fc18a", "fn:_admin_inbox_can_see(uuid,uuid)": "78b11ad581116398ad58c8d84f4fd7b8", "fn:_admin_invoice_line_rules()": "83dd9ae300915cd301d281e115fb793c", "fn:_admin_invoice_payable_by(uuid,uuid)": "c0b7ed450b74003ed2dcea190f056e5f", "fn:_admin_invoice_requires_amounts()": "3535d0ba410186474c3c8b93a7656cca", "fn:_admin_is_stylist_account(uuid)": "506eaf0f856ca424e0b04a54fe3a32fb", "fn:_admin_known_prefectures()": "cd6f7c0855c1aefb718758dd64dc41f3", "fn:_admin_lock_request(uuid,uuid)": "7e518ea018fb3b48866d90835df5bcb0", "fn:_admin_lock_sender(uuid)": "4dbf696ebf5ab10053f7c4ff7b749d61", "fn:_admin_messages_rules()": "b59918dab599369145a67b88dc2d5cef", "fn:_admin_org_billing_actor(uuid,uuid)": "02874e55b10f48b1ee23503012b6c1b4", "fn:_admin_quotes_rules()": "31136bfea18318f19427790402cf7354", "fn:_admin_request_hash(text,text[])": "028bdd7636b7722b1952dab164362561", "fn:_admin_salon_access(uuid,uuid,uuid)": "b5b7453d091a1b4bb0f0eb41e74e8e9a", "fn:_admin_store_culture_state(boolean,text,jsonb)": "8fbf93c3c5975cf80c28ada332e731c6", "fn:_admin_tax(integer)": "715d0acf595936a21c10b96e24604975", "fn:_admin_thread_visible_to(uuid,uuid)": "5dab89d084aafb9cadb84c0900f5634a", "fn:_admin_threads_consistency()": "a4bcf377b34dd45a3f16847606667dc0", "fn:_admin_visit_case_fee_guard()": "44a4214504088f4bbd4dc25617a5ae18", "fn:_admin_visit_occurrence_guard()": "e66797319ba6c2ce90141b4660e755be", "fn:_admin_visit_transition_ok(text,text)": "75b6fb75bc31b7cc2c495319e06b6cc7", "fn:_billing_append_only()": "982b61b251f3a538fe6a4988c1a6ccea", "fn:_billing_regime_active(uuid,timestamp with time zone)": "3bc5bd0ff2528c3ec39a532609fb224f", "fn:_cancel_interest_notifications(uuid,uuid,uuid,text)": "3e3cd54ce701d9087d02c69427ad61a0", "fn:_diag_gate_close()": "a8523a5e54bdbc51159f635b1896e9c3", "fn:_diag_gate_open(text)": "8558e43f7ff82197a97e032e3d6ff3ee", "fn:_diag_owner_lock(text,uuid,uuid)": "a1aef4b469fec6e43856c75c73d13c5e", "fn:_diagnosis_limit_gate(text,uuid,uuid,uuid,boolean,boolean,boolean,text)": "86f8c3b5f4642b72d2a834b82e92f0e6", "fn:_email_admin_valid(uuid)": "d5539b5dd794683a02c25bbedbf38f1a", "fn:_email_cancel_for_notification(uuid)": "3a230a7bd390c1200debeb31932fb949", "fn:_email_link_path(text,text)": "3e13003a8674fa22b88468a6c57c3d90", "fn:_email_notification_store(uuid)": "7acc9838aa3be3e5e91fd3181072b8ca", "fn:_email_recipient_entitled(uuid)": "21036faba762dc087224a7f8ccff8150", "fn:_email_template_key(text,text,uuid)": "a908cad044b164a4210927f8a30c9334", "fn:_enqueue_notification_email()": "90fdceac53ee577fa58b8fbc0375e1df", "fn:_hiring_has_active_hire_line(uuid)": "1ce8f5c2844d5fcc98cf7381877c9f86", "fn:_hiring_lock(uuid)": "a04858c069ddce2c938590de74761003", "fn:_hiring_process_basis(uuid)": "b79f41186a89e8eafb64ee45fe1e1ae2", "fn:_notify_on_admin_message()": "deb5263e5f59fd482f3beb3273b4925d", "fn:_salon_analysis_base_snapshot(jsonb,text)": "e1b6bccf147e7a566b79b7c2f54c9d0e", "fn:_salon_analysis_normalize_answers(text,jsonb)": "ea0dc30441b00f8c2371f669d558898f", "fn:_salon_store_profile_bump_revision()": "f63f62ac749938719365f57adde1006a", "fn:_salon_store_profile_history()": "95392ee3bf52454ef00995efe0007fee", "fn:_staff_auth_user_unused(uuid,uuid)": "06b16f30bfe05414cfaea0139d180337", "fn:_staff_session_ok(timestamp with time zone)": "d43b8fa537c10c060377ca4dd6e5a9cc", "fn:_store_asset_folder_store_id(text)": "9160084af58a23a4375b84bed4215a51", "fn:_store_asset_name_ok(text)": "bc9cb7b767282e9c0e41a69375a9525b", "fn:_store_asset_readable_by_stylist(text)": "22b1b84adfaa52775852418b12307e02", "fn:_store_assets_json(uuid)": "07f69567b6ec5cdff0a26e625a97a428", "fn:_stylist_age_info(uuid,uuid)": "f8ea97a8304ee59807e54108722e473b", "fn:_trg_blank_period_follow_phase()": "26ea7387f9b363415535e1d13b52250d", "fn:_trg_career_phase_required_on_insert()": "683c4995025aeec56733e8bfcadd5b30", "fn:_trg_career_phase_valid()": "ff11fc31116fa24d9c34a1f2be942a71", "fn:_trg_checkout_basis()": "b423d87242066468fa08bddb27346cf4", "fn:_trg_diagnosis_results_limit()": "0ba6ab433d2688f3d7802cc2ba101945", "fn:_trg_fee_insert_basis()": "04768947f87ceef2d7929aeefb4fd45b", "fn:_trg_fee_update_basis()": "8b7ec94540e3b1b0e06c6e4d837f929b", "fn:_trg_graduation_month_valid()": "830074be298f6f7ea6690ea2e744cb2b", "fn:_trg_hire_line_regime_guard()": "1c0bb0b812fcd33ba7f86535012a4f04", "fn:_trg_salon_culture_analysis_limit()": "0f3d45e2e0fd456b6714fea3f7edfb62", "fn:_trg_salon_culture_profiles_limit()": "69b70921bbaf23066c09cee72fa52228", "fn:_trg_salon_store_culture_profiles_limit()": "df63923a318b1b7cf49699e62ab3917c", "fn:_trg_scouts_publishable_guard()": "01d746ea0430bc5ef11f7f050b9b3c30", "fn:_trg_set_current_diagnosis()": "d65a74edcf253667d799150bca4b8a62", "fn:_trg_student_diagnosis_limit()": "21feb5c384de987e210b6b3a607aa892", "fn:_trg_stylist_private_birth_guard()": "66f40b9b7df788c23fd0dfa60b7aeabe", "fn:_trg_stylist_profiles_birth_required()": "ea911f4cc4128140b1e65927adf0e285", "fn:_validate_store_asset_path(uuid,text,text)": "8aadb782361a21fb81ea2511d866e9d8", "fn:accept_legal_documents(jsonb)": "b0d4f66d855bcbc1f64286481b727886", "fn:activate_ai_output(uuid)": "f66134e3eb50a52997c6fe74b66c3a34", "fn:activate_salon_culture_ai_output(uuid)": "378cf24cff850b11d1f20ede74eb98c4", "fn:add_hiring_candidate(uuid,uuid,text)": "6de89145c84778447937b6f3ddeb7713", "fn:add_salon_photo(text,text,integer)": "000959028ffefae45816deb4085884cf", "fn:add_store_link(uuid,text,text,text)": "36602896953c286f7212cd17169a60d6", "fn:add_store_photo(uuid,text,text,integer)": "da7c544a330721c14c6bcb35f6b6ba77", "fn:admin_add_fee_line(uuid,text,uuid)": "18e39779065c5c188c4d91ec297b33b2", "fn:admin_add_registration_line(uuid)": "3ebeabeb6a4b4eaef4b00f41d6bd73b8", "fn:admin_advance_invoice(uuid,text)": "9864302ff183130f9dfbf2b1ffe9acaa", "fn:admin_assign_visit_request(uuid,uuid,timestamp with time zone)": "6a13da12c47ef2a16809927ec00bfe3f", "fn:admin_billing_regime_status(uuid)": "95efcf7fdf8db58eca11c5cabbd22bc3", "fn:admin_billing_summary(uuid)": "0e7933d286304855268354eccd747887", "fn:admin_claim_visit_request(text,uuid)": "6ba4d52781f8ad7836b7147cda621d16", "fn:admin_correct_hire_line(uuid,text)": "5890bc590cf6cdb01ec1a5cf55cf5763", "fn:admin_create_invoice(uuid,uuid)": "dfb51415849c31a96fd748364509c2bd", "fn:admin_create_thread(uuid,text,uuid,uuid,uuid,uuid,text,text)": "8e409344ed92d73f7618194e87240c3d", "fn:admin_email_outbox_action(uuid,text,text,text,text)": "3659c628227c8a62a4668eafd7938481", "fn:admin_email_outbox_find(text)": "996771f467e57f1ddfe966c34dffe1e8", "fn:admin_email_outbox_overview(integer)": "3abade161137233cb8f6ae14d4683cbc", "fn:admin_flag_billing_case(uuid,text,text)": "40508021c1e7a40cca5c9f8e219fd85d", "fn:admin_get_invoice(uuid)": "35ea9068462e2d44fe5deeedaa320d6d", "fn:admin_get_organization(uuid)": "d2f16968e41a6a12432559660fa7ccae", "fn:admin_get_organization_location(uuid)": "6781be8a73beaf6cb921d844ce0edac6", "fn:admin_get_stylist(uuid)": "a423c6cd344c0dc692cbaf4f821594bd", "fn:admin_get_thread(uuid)": "fccd45a67f6ef67a1bd461ce37813411", "fn:admin_get_visit_request(uuid)": "406dedfceb21e91d61e13d01412c4be6", "fn:admin_list_billable_cases(uuid,integer,integer)": "7403a112b3b513fb54533f2935f22012", "fn:admin_list_hiring_processes(text,text,timestamp with time zone,timestamp with time zone,uuid,uuid,integer,integer)": "09ddefe6a2b7649eb6edba805bec93d3", "fn:admin_list_invoices(uuid,text,integer,integer)": "4baa78cd500b1dfb2b194cb3b855d492", "fn:admin_list_organizations(text,text[],boolean,text,text,integer,integer)": "4caf069dd43c2ad3dbb944df9f1ad75a", "fn:admin_list_quotes(uuid,integer,integer)": "a0f2678e06fa5ab8f8e898261cb51e7a", "fn:admin_list_salon_registrants_without_company(integer,integer)": "553a8b70ec906a054a7b232650330a1d", "fn:admin_list_store_culture_readiness(text,text,uuid,integer,integer)": "9c66316f1fbc08eae02b5cfd68f70e84", "fn:admin_list_store_interests(text,timestamp with time zone,timestamp with time zone,uuid,uuid,integer,integer)": "e23585e36d50149a5e674d80c22dd56e", "fn:admin_list_stylists(text,text[],boolean,text[],text,text,integer,integer)": "2c9da980d9ea9ec2ca038f3215b3e48e", "fn:admin_list_threads(uuid,uuid,uuid,text,integer,integer)": "6615d2b2d02524b65b74fc09862bfc77", "fn:admin_list_unresolved_billing_cases(uuid,boolean,integer,integer)": "37e5ac671204e9e3ab92719e73762914", "fn:admin_list_visit_requests(text,text,text,uuid,boolean,integer,integer)": "312b5ace15a92c795c202ce22f6dd6e3", "fn:admin_my_operator_state()": "d51a09ff2f3da5d117a4ea503525a54b", "fn:admin_operator_directory()": "d33771ee6732c6f2d7739c2c5b99830c", "fn:admin_operator_role()": "36ceb5a9c8f964de76f506a5ee6e442b", "fn:admin_post_message(uuid,uuid,text,text)": "8e37983be9dcbf8c8a9e791ccb5f92ed", "fn:admin_propose_quote(uuid,integer,text)": "339822bcb5eece9732890f58a82b18fa", "fn:admin_publish_legal_document(text,text,text,text,timestamp with time zone)": "64cdc38139e15d9885148597dbe04200", "fn:admin_recalculate_registration_line(uuid)": "b75d40bef8aba2507c09436d68f9d57a", "fn:admin_record_delivery(uuid,text,text)": "ed8c5c2984adc9cc1ffdf134d1a2c19a", "fn:admin_record_visit_confirmation(uuid,text,text,text,text,timestamp with time zone)": "a34245ef1ef33c6f107c85f44beab082", "fn:admin_resolve_stripe_integrity_issue(uuid,text)": "0491728b022774c378a23a5808c3f663", "fn:admin_set_billing_regime(uuid,timestamp with time zone)": "0b7ed56305298094b7ff8f541f68ecb2", "fn:admin_set_email_notifications_enabled(boolean)": "b3038b24e2798205e4be4ff8ffef9ad3", "fn:admin_set_organization_location(uuid,text,text,text)": "98fbb3deb56a4f6dbf3717028fe0efb2", "fn:admin_set_process_billing_basis(uuid,text,text)": "3f468e95a9d55b90b0691de1f8ac35a6", "fn:admin_set_thread_status(uuid,text)": "3fefd7ef4c3ada975d407c7ba7b5849c", "fn:admin_staff_accept()": "c457fa9d8eb4d061e5f74d3afa16579f", "fn:admin_staff_events_immutable()": "5211a4181aaa961863ff8b0eed92a5ab", "fn:admin_staff_invitations_open()": "b9d65d6d678b7e14142790c513b79ce4", "fn:admin_staff_invite_begin(uuid,text,text)": "7290634ea34489703e98ddd45ab5092b", "fn:admin_staff_invite_compensation_begin(uuid)": "004381817a02fa30425d1b8155f24292", "fn:admin_staff_invite_compensation_done(uuid,boolean,text)": "3db39a309126db6fe653858a770326d7", "fn:admin_staff_invite_mark_auth_created(uuid,uuid)": "33e946cde32b1e5e4ef6226b962bb28b", "fn:admin_staff_invite_register(uuid)": "0daace1f242d2e0cb9407baaee203c5c", "fn:admin_staff_invite_resend(uuid)": "be2aaa359a278319938959d7140dbf08", "fn:admin_staff_list()": "68a032cc03e5eab27877f942b1bdef91", "fn:admin_staff_password_reset_begin(uuid)": "bbfae4bd12e0b765f2a3371e016c7205", "fn:admin_staff_rename(uuid,text)": "3bc689e24d51a1217629759f126108b7", "fn:admin_staff_set_status(uuid,text,text)": "4c58990ff284a5a2a779724006730c0f", "fn:admin_update_billing_issuer_settings(jsonb,text)": "3b055addfa6fc1b5f6d78f3461ac6941", "fn:admin_update_organization_contract(uuid,jsonb,text)": "bc5d68b6be42aba8623db3795c3600f5", "fn:admin_update_success_fee(uuid,text,integer,integer,text,date,numeric)": "2303fedc2a55bcaada1a2548a904da3f", "fn:admin_update_visit_request(uuid,text,timestamp with time zone,date,text,text,uuid)": "6553ec8e74345d8e9400b0e81e1f94f3", "fn:admin_upsert_scout_credit_package(uuid,text,integer,integer,numeric,boolean)": "d9a80ca4a0bbfd23d5bcc6d63c9f9c0b", "fn:admin_void_line(uuid)": "59fabfb6a0f141099d6b1eef52f99c74", "fn:admin_withdraw_quote(uuid)": "496a9bf6ac0b11290061922fac0b004b", "fn:allocate_invoice_number(integer)": "af1679450e9a6490c2b458c35d15cf82", "fn:apply_payment_method_setup(uuid,text,text,text,text,text)": "ce25b0a6ef55924b17b66c136cbd8ef8", "fn:apply_scout_credit_payment(uuid,text,text,text,integer,text,text,text)": "dd2001def9cfd71f214ac7e0b777e3d4", "fn:apply_stripe_invoice_result(text,text,text,timestamp with time zone,text)": "3e6b065579aaf4d412f7308c955349f4", "fn:apply_stripe_subscription_snapshot(text,text,text,timestamp with time zone,timestamp with time zone,boolean,integer,text,timestamp with time zone,text)": "7618748ac4f9036d0fc42f687c7886e8", "fn:apply_subscription_checkout_completed(uuid,text,text,text,text)": "45112d9ab23cb532416b877ec9f14364", "fn:apply_success_fee_card_payment(uuid,text,text,text,integer,text,text,text)": "0e88a081a52d22639b2a44c70139d1c7", "fn:armor(bytea)": "6bf3d0a76729906165904ac1bc0be434", "fn:armor(bytea,text[],text[])": "959e932f6df16bc34aa2bdaacdee091b", "fn:assert_organization_recruiting_allowed(uuid)": "8bc3dfcea42abdb828fac9c4195f0ae1", "fn:assert_salon_target_recruiting_allowed(uuid)": "d97a28c438b4eb79aa4d3f87c722e938", "fn:assert_store_recruiting_allowed(uuid)": "9ed798cc134c34d2670637dd166b3eb2", "fn:assert_user_recruiting_allowed(uuid)": "37cc3f9c8932443c2a9fb712c9ef5fc5", "fn:attach_stripe_checkout_session(uuid,text)": "4875e108b9364d45ed8cd71d4fe7c33e", "fn:authorize_invoice_document_download(uuid)": "606a6f499d1c69cb537f5484d68ab6b3", "fn:authorize_subscription_invoice_download(uuid)": "fa3eeafada373aedd599bd232a4c1ac4", "fn:backfill_legacy_salary_offer_store_context()": "3923d921b16cfffd2d99b4c30e2ee1e7", "fn:begin_monthly_subscription_checkout(uuid)": "c73c62c1fd68406923849dd910cbdbef", "fn:begin_payment_method_setup(uuid)": "e8bdab315c4d969c2e7669c9c17dbfdd", "fn:begin_scout_credit_checkout(uuid,uuid)": "c2ddbf4f1081bc98db334b3627f47a2d", "fn:begin_success_fee_card_checkout(uuid)": "4b75403b05d24b1787533f8956b1d20d", "fn:billing_append_only()": "2bc0e6a83220c49a2227ecab8f52d5c2", "fn:billing_begin_checkout(uuid)": "d2b7a35f814471e3abe723b55c1edbb5", "fn:billing_default_tax_rate()": "4640c8ec3e6b90b9b39b165f0d4d13c4", "fn:billing_field_max_length(text)": "04c3d988f29c3a9af969400b99978a8b", "fn:billing_issuer_settings_guard()": "e0a7ed2ade84c7bc0249921e3e6b4b22", "fn:billing_json_text(jsonb,text,integer)": "cfa5e98dc161207c1792d354487fc946", "fn:billing_list_invoices(uuid)": "52f70e9ecd759968a8dedb3cf6469f01", "fn:billing_normalize_postal_code(text)": "f1ee7567608c2de29f3c7ff4e97a59b1", "fn:billing_normalize_registration_number(text)": "ccc909f305561ce13bdf2a3e77281e27", "fn:billing_standard_due_date(date)": "b6dc4fbeae3010ec6027091e1c238357", "fn:billing_tax_amount(integer,numeric)": "a0ce3105c4876027b7f3f09c3138ba98", "fn:block_salary_offer_insert_when_paused()": "4e42570bd714998ff38c9b9e95b39c73", "fn:calculate_match_axes(uuid,uuid)": "06565d93e4ec6341654b4d823d76d2a7", "fn:calculate_match_axes_by_store(uuid,uuid)": "ecf39de00546b6e8268df85d5904ea6d", "fn:calculate_salon_stylist_match(uuid)": "950c912758494dcd82017a2192384997", "fn:calculate_store_stylist_match(uuid,uuid)": "8d88d0312f73e7d415dd55acd84eddb5", "fn:calculate_stylist_match_consistency(integer,integer,integer,integer)": "c6d8515fbf5a0b90bf03889986036a9b", "fn:calculate_stylist_salon_match(uuid)": "405127f1fe8b7bb0a8982783f4021dcf", "fn:calculate_stylist_store_match(uuid)": "369c3c750ce79b47fb6aec48e510fc13", "fn:can_edit_store_assets(uuid)": "4b8a482ee18ed2fa1610920c4fd0e7cd", "fn:can_edit_store_culture_analysis(uuid)": "c3ad7b6c99a08b357d33a5cfef51d3a4", "fn:can_manage_organization_billing_profile(uuid)": "a4fffceca9fa53f7281d459a815a9d65", "fn:can_manage_store_hiring(uuid)": "54018ace4375d3f6355582cb88569885", "fn:check_rate_limit(text,integer,integer)": "9a7e8aa658c6afeb08f052880ae25ebc", "fn:claim_stripe_webhook_event(text,text,boolean)": "781f1202f04b9316d7760871919d1450", "fn:cleanup_expired_pending_diagnoses()": "be0e98854014d063c575f19bb32383e2", "fn:cleanup_rate_limit_counters(interval)": "31e9d5551f84849c78117e3c8f1d6ffe", "fn:cleanup_rate_limit_reservations()": "6bbf98d6befa2c733b48dd7e77fd9211", "fn:commit_diagnosis_result(uuid,uuid,boolean,text,diagnosis_mode,jsonb,smallint,smallint,smallint,smallint,smallint,smallint,text,text,smallint,text,uuid,timestamp with time zone)": "30901b87a7b3631281571d781a870eb5", "fn:commit_student_diagnosis(uuid,uuid,text,jsonb,jsonb)": "0b84437cb295fa4adf88622ad7424eea", "fn:company_billing_overview(uuid)": "4666036d086a0b781d9fd5865a55200b", "fn:company_get_invoice(uuid)": "0722df5a48e562d2205219b9536421f9", "fn:company_list_quotes(uuid)": "66d0bdde80c6e2a16972f3bfe501b43b", "fn:company_respond_quote(uuid,boolean)": "b84ebbfdb848dcb2399f64e0ee9d21af", "fn:complete_pending_diagnosis_claim(uuid)": "a45044c560bbe46146b61b7e6705fbc2", "fn:complete_stripe_webhook_event(text,text,text)": "a22fd67d0745236d6405a8f762781167", "fn:confirm_salon_culture_diagnosis(uuid,uuid,integer)": "1ba24905475ed697e82234a3cb25a9e0", "fn:create_ai_output(uuid,ai_output_type,text,text,text,jsonb)": "4335ea28a44dca58d9c8bf6d7aecd6e3", "fn:create_hiring_notification(uuid,text,text,text,uuid,text)": "f02cf47046795068bbdd4a03dd7aefaf", "fn:create_notification(uuid,text,text,text,text,uuid)": "2c233dcc18ca82814fb1ef17bbfd734a", "fn:create_salary_offer(uuid,integer,integer,integer,text,text)": "4923dc699098338c81b0b149d296e531", "fn:create_salary_offer_v2(uuid,uuid,integer,integer,integer,text,text)": "a047773ec12f96c1055317e3cb2f59fa", "fn:create_salon_culture_ai_output(uuid,ai_output_type,text,text,text,jsonb)": "b8bacdb21930c575e4a84a1b529b1eb6", "fn:create_scout_notification(uuid,text,text,text,uuid,text)": "5485620429b03c91b1c02ea2f76c233c", "fn:create_store_interest_notification(uuid,uuid,uuid,text,text,text)": "1c789dab29fe018dc33d1b187d86af29", "fn:crypt(text,text)": "c535e8f16d99f4963ef043624f176b50", "fn:current_legal_documents()": "4999f8dbca3396724e4c22983a398a2b", "fn:dearmor(text)": "7291a465dc6359cce99c67fe8708fbf3", "fn:decline_hiring_process(uuid,text)": "2891d9b0789785391d6ccf38ce1df9c7", "fn:decrypt(bytea,bytea,text)": "b4dddb96b7568a510c6c9b098b37127d", "fn:decrypt_iv(bytea,bytea,bytea,text)": "c5323c5b9c6758ca8ae41c957798095f", "fn:delete_salon_photo(uuid)": "d9b9e1f4c8f52105c3f9229bf463a4ee", "fn:delete_store_link(uuid)": "138a030b938e33c5b9a18fefb2c339ef", "fn:delete_store_photo(uuid)": "daea5354c85e6e531311ec3289fa7648", "fn:delete_stylist_evidence_document(uuid)": "d1377ff7d9974482a917cfac896a1619", "fn:digest(bytea,text)": "dfc1d6babe9ed6689863605de1627aa7", "fn:digest(text,text)": "66e930544c6b69d9b0ef70ee7797187e", "fn:discard_salon_culture_draft(uuid)": "b320210668595816d9688532ad7b49e4", "fn:email_outbox_claim(text,integer,integer)": "f9fd80c1bed1720bec954f726499a807", "fn:email_outbox_confirm_send(uuid,uuid)": "bc126973df28f96813afc2a2ab13241c", "fn:email_outbox_finish(uuid,uuid,text,text,text)": "74ba85666ef60ae496e9f31f7f7b6152", "fn:email_outbox_release(uuid,uuid)": "0fe8fd2462e99388cdcdabc179f518f4", "fn:email_template_keys()": "c26796d738a12967e239317c4e83fc32", "fn:encrypt(bytea,bytea,text)": "35cd296e38915d35ba6415d789d3f1da", "fn:encrypt_iv(bytea,bytea,bytea,text)": "a821cab989afa3b14581401991637891", "fn:enforce_ai_output_immutable_fields()": "0a68274c02b463e6664186ff5e7155f1", "fn:enforce_salon_culture_ai_output_immutable_fields()": "ce4d701c79dfd21f32002c4c1ba6c49a", "fn:gen_random_bytes(integer)": "47e8398d3ccfa31f1f648422a012a27d", "fn:gen_salt(text)": "925913dfcc25c1c44f05db9242994a48", "fn:gen_salt(text,integer)": "8662724f7b7d56ec664ea4210a6af335", "fn:get_admin_billing_integrity_issues()": "4ae06d14982a0bb5bc5dcdd1a3ed0535", "fn:get_admin_billing_issuer_settings()": "89c61c01461750b6e12aa1dd85e8431c", "fn:get_admin_evidence_queue()": "2160c2d02893fe3620e455ff3a28b680", "fn:get_admin_invoice_document(uuid)": "755991e0399920193a56c818fc475fce", "fn:get_admin_invoice_documents(uuid)": "d2d807990bd7b4c90154fdfa705002de", "fn:get_admin_legal_documents()": "8bff87d5b2b41009f812cef626560bbc", "fn:get_admin_organization_contract(uuid)": "3dd92ccb5a2d170a17c736617eed4138", "fn:get_admin_organization_contracts()": "ecf655e146476cb34a854b7754d249e7", "fn:get_admin_organization_overview()": "330808e498ba3c27588354bd901e01bb", "fn:get_admin_organization_stores(uuid)": "33f328968e2452ddd72bcf77e5aa2992", "fn:get_admin_scout_credit_packages()": "df319d8284f2d910277a25334585f935", "fn:get_admin_stripe_integrity_issues(boolean)": "86d24ec478689eaae1d4a4ad0db12542", "fn:get_admin_stripe_organization_detail(uuid)": "bfdda097ee7ccd28c6df05197d3c01eb", "fn:get_admin_stripe_overview()": "257b72d8df282e326b12fa7349ad61eb", "fn:get_admin_subscription_invoices(uuid)": "c81e316c628d156a44c7b7656fd5df3e", "fn:get_admin_success_fee_payments()": "5612e3367d18ca4116afcaa6ccfcbeed", "fn:get_admin_success_fees(text)": "3383efaf46e4b4425d748efe1685f840", "fn:get_admin_unissued_subscription_invoices()": "c138359b3ef42ca31cf06e7843a5619b", "fn:get_admin_user_legal_acceptances(uuid)": "611d59b90740833e8ac6f7b87549a43d", "fn:get_company_contract_settings(uuid)": "cbe30619d2c7eed150b2400985b3b195", "fn:get_company_hiring_analytics(uuid)": "b5720401b112d2a7fd4adf13d8d7519d", "fn:get_company_hiring_cohort_analytics(timestamp with time zone,timestamp with time zone,uuid)": "be819304558e7201e7a0455da367812f", "fn:get_company_hiring_period_analytics(timestamp with time zone,timestamp with time zone,uuid)": "c71693b4bd8c99ab65c2ff02418bb33b", "fn:get_company_invoice_documents(uuid)": "d7b238bc42dd0f8f557a06691ae404a4", "fn:get_company_payment_overview(uuid)": "a87ed4ead8b2371b6f1175f6d3c9b578", "fn:get_company_subscription_invoices(uuid)": "f8e3afd8141f944bc229d4ac95ce5341", "fn:get_company_success_fee_payment_info(uuid)": "14cb4273a48ea020ca78fdbaa572c01f", "fn:get_company_success_fees(uuid)": "d9c4b01a4561d66c486937872bf39b87", "fn:get_current_legal_documents()": "cbe3ea4bae0a9d7f27482e167a2a2801", "fn:get_diagnosis_change_status(text,uuid)": "457a0d7ba9ae891ffd928639ae020e34", "fn:get_hiring_process_events(uuid)": "cb67f2d096a9715a292b09f0dd945be0", "fn:get_invoice_issue_readiness(uuid)": "b52b5efddc606f3882971aba9e2a34b6", "fn:get_my_age_disclosure_requests()": "f99fc043bd88bf786150c493ad98172c", "fn:get_my_email_notifications()": "b2ad409f555dbe57392d6768b2f8cb1a", "fn:get_my_hiring_processes()": "e7d3d97461921aa0dd3de07d27fa731f", "fn:get_my_legal_acceptance_status()": "222ca4fa08e020f34e8e0e8b16e99c5d", "fn:get_organization_billing_profile(uuid)": "c28dd461d02ad4ecdaf5179cc5bc1877", "fn:get_organization_stripe_customer(uuid)": "f4e04c60ae6483f548bf0530d085c0a8", "fn:get_public_salon_culture_detail(uuid)": "ce15ca037e0400f44e9d1471b7985dd7", "fn:get_public_salon_links(uuid)": "3303a3ed36a5c1b84a8444e113e6a233", "fn:get_public_salon_photos(uuid)": "47d4e73ee800cb932bbc14503035daed", "fn:get_public_salon_store_detail(uuid)": "19840f56277c388509126900481bd9fc", "fn:get_public_salon_stores()": "f2aed429b8b253cd42a03a63c4581afe", "fn:get_public_store_assets(uuid)": "024b4efa35491cca5fcd9d47667b24eb", "fn:get_public_stylists_for_scout(uuid)": "86e6418641b7cf0bb5e5a283e751b546", "fn:get_received_salon_interests()": "315eb4e177a79f19769a7731e4214b06", "fn:get_store_assets(uuid)": "bcf598a779ed329be81770ce9355c4ff", "fn:get_store_hiring_processes(uuid)": "4c83f791ce4dffa8d880f3eda485da22", "fn:get_store_received_interests(uuid)": "d1b6b1f011fb25f2ad408edea94e3569", "fn:get_store_recruiting_access(uuid)": "8793e3fa66c630299052d76a1ff55974", "fn:get_store_salary_offers(uuid)": "782143dd75a426d10556d0533445f5c0", "fn:get_store_scout_quota(uuid)": "acdd36614b17294d160a0099aee3d88d", "fn:get_store_scouts(uuid)": "dbd271c66dce707a4c3f19e84356d9be", "fn:get_store_stylist_age_infos(uuid,uuid[])": "5a54ce9a5dc9c6c382cde95b6754abb3", "fn:get_stylist_public_extended_enabled()": "3cc7606f574f6b9cbd5f734557f615ea", "fn:get_subscription_invoice_issue_readiness(uuid)": "c8076c6945da0ec7ad97e1bb27ed96e2", "fn:handle_new_user()": "06af429eda950547532557b7333b3793", "fn:hiring_create_success_fee()": "829262dfa77631bbefc68f5495339714", "fn:hiring_fee_transition_allowed(text,text)": "76e28ecaf0a182213cf5063e0ea4f1dc", "fn:hiring_lock_process_for_store_staff(uuid)": "75d496fee5ff4f12c20fcc79b5a8238a", "fn:hiring_stage_rank(text)": "438370664e15aaf8451134aefaf9cebe", "fn:hiring_success_fee_events_append_only()": "50d9d9d7cda2a5575b7fc5cbb7f3f04f", "fn:hiring_success_fee_no_delete()": "55e9e3f4773d1d376ece077f52f2981c", "fn:hiring_success_fees_contract_snapshot_guard()": "f81d86fae66a8cdee29d2c2c546dcc04", "fn:hiring_success_fees_guard()": "26288fdf053b8d0892fde348cc7195aa", "fn:hiring_success_fees_invoice_guard()": "59b2596df4c6474d8b53f9b633fa73ee", "fn:hiring_transition_allowed(text,text)": "728c2ea50f09266c41961970c866812f", "fn:hmac(bytea,bytea,text)": "21593490f9d87b53060c5d93c78cfb40", "fn:hmac(text,text,text)": "239db7c0ddfbbca7b1005c61a85a9dc6", "fn:inbox_get_thread(uuid)": "f2c70f8503e6926817732a9fb0000d49", "fn:inbox_list_threads(integer,integer)": "36b8e23a5b504cb3261ffd6caf9a0d40", "fn:inbox_reply(uuid,uuid,text)": "8fe87f48a23952d2133a7aa862fe4719", "fn:invoice_documents_guard()": "c596dfb37074b0108da4113fdda86af5", "fn:invoice_issue_state(uuid)": "ec32ef35dfb4acb4a8de1711cfcdc0bf", "fn:invoice_number_counters_guard()": "4edf3ddd6a57d08718fb5c880f59a59e", "fn:invoice_snapshot_digest(jsonb,jsonb,jsonb)": "5de9f613412f8c2d074b703ec11bc06a", "fn:is_admin_operator()": "6fb15c8e5089c734712b369b23bfb5d5", "fn:is_admin_staff_active()": "b2d97b3ea7eb049c87311497566f93d2", "fn:is_known_prefecture(text)": "5d8678a5e8b992db4c4dc301324ebdaf", "fn:is_organization_member(uuid)": "f5cfb91105c551b3b5b2f1f64cf99b51", "fn:is_platform_admin()": "754f6e8b487bd2d97787a059af238def", "fn:is_salon_logo_write_blocked(uuid)": "e0ae06b95e91aaefbb5227a99c978322", "fn:is_store_accessible(uuid)": "df4e42464567a1aff0cec11c0a321c82", "fn:is_viewer_only_salon_staff(uuid)": "202387d7b46ba37f7816e7d3c3b6b52d", "fn:mark_all_notifications_read()": "7589bcd004de710907ce7b7a3946739f", "fn:mark_notification_read(uuid)": "3fd68572c2d9d57229be279af0b8dc64", "fn:mark_notifications_read_by_entities(jsonb)": "4c3e7fb29becad6a1b43ee65689558c2", "fn:mark_scout_read(uuid)": "95fa123f88ccde34427bf81dcb09684a", "fn:mark_stripe_checkout_expired(uuid,text)": "9951e8278e39588d18fc4fd08315c313", "fn:notify_on_hiring_event()": "b32337b4b3898995565fb69337b5137f", "fn:notify_on_scout_responded()": "567640a1e8ca5246603ce608d87bc3e8", "fn:notify_on_scout_sent()": "46a1df8f8f33af95631df1b546f880e1", "fn:notify_on_store_interest()": "4e09d155cfe4770fc1e19c2e78acb58f", "fn:organization_billing_profiles_guard()": "ade2cc1c6e8d55710e3b3769004dffdf", "fn:organization_contract_events_append_only()": "7d0b0b8081390c57dfa3142f2f8454c7", "fn:organization_contract_json_date(jsonb,text)": "0aa1aa545921a504171b2db9fc80f4f3", "fn:organization_contract_json_int(jsonb,text,integer,integer)": "5857b0b483b42aa86668f165f52b01a2", "fn:organization_contract_no_delete()": "55e9e3f4773d1d376ece077f52f2981c", "fn:organization_contract_settings_guard()": "baa4d9b9deb35c013ddcfa526a04fc5a", "fn:organization_recruiting_blocked(uuid)": "34543bf3127df537c0651023d69676dc", "fn:pgp_armor_headers(text)": "3dae93cabea118661be16d05f5fa828b", "fn:pgp_key_id(bytea)": "d3ef36b21466fda4ddb19c6a8caf1851", "fn:pgp_pub_decrypt(bytea,bytea)": "fa927837e7509c48410fcf4a140f8d73", "fn:pgp_pub_decrypt(bytea,bytea,text)": "ad685d0a8fdbd57a91879cb2e3579bd2", "fn:pgp_pub_decrypt(bytea,bytea,text,text)": "1e4a6410e39a8a80ac70b9df67443875", "fn:pgp_pub_decrypt_bytea(bytea,bytea)": "d1220d45367a799fe185ddb6107521f4", "fn:pgp_pub_decrypt_bytea(bytea,bytea,text)": "8d213c670a9fd37825fa8ab064ec863e", "fn:pgp_pub_decrypt_bytea(bytea,bytea,text,text)": "5723c1c9c8759bd8f45514da4824d6bb", "fn:pgp_pub_encrypt(text,bytea)": "d8f3c34589858de897de408e07248c9d", "fn:pgp_pub_encrypt(text,bytea,text)": "db9c7eea262402012cc249d737cbdf84", "fn:pgp_pub_encrypt_bytea(bytea,bytea)": "3fcd6302f1828a7a3a031c78285dbbc1", "fn:pgp_pub_encrypt_bytea(bytea,bytea,text)": "ca0a5b6222973f836f25d6e0f81becd7", "fn:pgp_sym_decrypt(bytea,text)": "b4e9a7ae9aa22308a258157d0a09e9f5", "fn:pgp_sym_decrypt(bytea,text,text)": "8d4917666fd8c30421c1f664787dbb74", "fn:pgp_sym_decrypt_bytea(bytea,text)": "1eff31417bbf48724891ffc5d50b841d", "fn:pgp_sym_decrypt_bytea(bytea,text,text)": "42ef18eabf1c394ccb134bdbb0fcc5a5", "fn:pgp_sym_encrypt(text,text)": "73ca71f313ca3f91a8c5a14b39ec45f0", "fn:pgp_sym_encrypt(text,text,text)": "cb17af307aa5a6be66bc3984bfe76c33", "fn:pgp_sym_encrypt_bytea(bytea,text)": "4075b183717f66a4154451b726a0cbc8", "fn:pgp_sym_encrypt_bytea(bytea,text,text)": "1af652504d87d6f4a4071ae56432efd5", "fn:prepare_invoice_document(uuid)": "a45ffb99160fb98fcf31f64a86adb576", "fn:prepare_subscription_invoice_document(uuid)": "f21870491c79d5ec93c5b55b3780d85a", "fn:public.gen_random_uuid()": "bfe0d5eeb2665cf74d6f9fd37a1b2974", "fn:record_stripe_refund_or_dispute(text,text,text)": "a27ed8a2c14d0afbcc2dee509b5e08bc", "fn:record_subscription_invoice_payment(text,text,text,text,integer,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,boolean,text)": "ca03c1f4f929bc24b349d77ad849571e", "fn:refresh_stylist_match_verification()": "bb98cb13b9966b46bea9c0338ef1dc00", "fn:register_invoice_document(uuid,text,text)": "cd3aa0b1e3553818ddc051d42e264b12", "fn:register_stripe_customer(uuid,text,boolean)": "ca75c891e533f2792544204cc712043b", "fn:register_stylist_evidence_document(text,text,text)": "296ae2b2cc9a2196950063552adbda89", "fn:register_subscription_invoice_document(uuid,text,text)": "bcaa0c54462776c1cb4c68d047d90cb4", "fn:registration_fee_for_store_count(integer)": "eac5013163e46ec5b99f2667a2116259", "fn:request_stylist_age_disclosure(uuid,uuid)": "537305ce552d8091d85d5486faf25803", "fn:require_performance_offer_opt_in()": "c2b60ecbaa4588af698b432588730f0c", "fn:reserve_rate_limit_slot(text,integer,integer,integer,integer)": "a52efc6e7e4010a4ee7c3e09e1a64c12", "fn:respond_age_disclosure_request(uuid,boolean)": "029527bd684d874bd0ada563d4813633", "fn:respond_salary_offer(uuid,text,text,text)": "551eebf7a3c372e9c1f7bb76f504e228", "fn:respond_scout(uuid,text,text)": "b13940a641639484d80b39b1edf09f50", "fn:review_stylist_evidence_document(uuid,text,text,text)": "3c3dcdf6964e6d8dd6c400b4cac65dba", "fn:salon_can_view_stylist_avatar(text)": "9c1e0aaa26f80562f4591ecb4189821d", "fn:save_core_type_result(uuid)": "1845b18e2f968453832e303058781b9b", "fn:save_salon_culture_analysis_answers(text,jsonb,jsonb)": "60e777a79de26146b5715ffc1a21de55", "fn:save_salon_culture_draft(uuid,jsonb,integer)": "933ac11c83354f5596e75ffc7fd6ec4d", "fn:save_salon_culture_profile(salon_culture_status,salon_culture_respondent_role,integer,jsonb,text[],text)": "de7808e105e104d4a104a2e70e4ff23f", "fn:save_salon_profile(text,text,text,text,text,text,text[],text,text,profile_visibility,text,text)": "2b789a6fc4bb994885ee408d817dedd5", "fn:save_salon_store_culture_analysis_answers(uuid,text,jsonb,jsonb)": "61316b79d73cabe2b9b8820f59d2e32b", "fn:save_salon_store_culture_profile(uuid,salon_culture_status,salon_culture_respondent_role,integer,jsonb,text[],text)": "9146e61a782fe5333e3460af05a99e0f", "fn:save_salon_store_profile(uuid,text,profile_visibility,text,text,text,text,text,text[],text,text)": "8948e0a82de3a907dd2d1873b3770d42", "fn:save_salon_store_profile_v2(uuid,text,profile_visibility,text,text,text,text,text[],text,text,integer,text)": "43bb8b8c9452fb7d63ce8e58a9478a4d", "fn:save_stylist_match_profile(text,text[],text,integer,integer,integer,integer,integer,integer,integer,integer,numeric,integer,integer,text)": "1c9f3a18cf21860a77d7e333657e0bfa", "fn:save_stylist_match_profile_v2(text,text[],text,boolean,integer,integer,integer,integer,integer,integer,integer,integer,numeric,integer,integer,text)": "0ebbdb7e5650c1ef860a9e12d555ab39", "fn:save_stylist_preference_profile(stylist_preference_status,integer,jsonb)": "de3f45f8f12ede117d0a417d56270c5e", "fn:save_stylist_profile(text,text,age_band,gender_type,text,text,integer,text,text[],employment_type,job_change_intent,salary_band,jsonb,text,profile_visibility,boolean,text,text[])": "d7667144d4af00d3dc3d2cb3180b74b6", "fn:save_stylist_profile_v2(text,text,age_band,gender_type,text,text,integer,text,text[],employment_type,job_change_intent,salary_band,jsonb,text,profile_visibility,boolean,text,text[],date,text)": "6e5c2c25f4c2f8e9e992ab84fcf50a37", "fn:save_stylist_profile_v3(text,text,age_band,gender_type,text,text,integer,text,text[],employment_type,job_change_intent,salary_band,jsonb,text,profile_visibility,boolean,text,text[],date,text,text,date,text,date,text)": "e0c25526793658385ec59f9687bc36a1", "fn:save_stylist_profile_v4(text,text,age_band,gender_type,text,text,integer,text,text[],employment_type,job_change_intent,salary_band,jsonb,text,profile_visibility,boolean,text,text[],date,text,text,date,integer,text)": "a2ea6e6ad0a10a8bcb57983c7a94cd86", "fn:schedule_hiring_interview(uuid,timestamp with time zone,text,text,text,text)": "de6e1c4c5905db8e670d8590b9a2d48d", "fn:send_scout(uuid,text,text)": "39dc1ec6d1ff311fe161816d75cde388", "fn:send_scout_v2(uuid,uuid,text,text)": "8096049520d9d24823ddd53268bde74f", "fn:service_prepare_subscription_invoice(uuid)": "3e2f3637153ae1ae2ff4b4d9670100f3", "fn:service_register_subscription_invoice(uuid,text,text)": "a7a0ed9a5093f0e36b5f3a63a32c5fa4", "fn:set_diagnosis_ai_status(uuid,ai_generation_status)": "b3701138e6d34113cf630a43451732ff", "fn:set_favorite_salon(uuid,boolean)": "5aed1334e4dc8e6bf85c01eb647d9491", "fn:set_my_email_notifications(boolean)": "7ccd729348d2b58c85c166fc9bd1b944", "fn:set_payment_method_state(text,boolean,text,text)": "351822517e80661c44f4b09023885a85", "fn:set_salon_interest(uuid,boolean)": "83f9387ec75e7496f61883f060912d8a", "fn:set_store_interest(uuid,boolean)": "47b81da08559733ffbf8b7298e715366", "fn:set_store_interest_v2(uuid,text,boolean)": "ee8e2c5f8c57765d83c50f28172b6a11", "fn:set_store_logo(uuid,text)": "fc97df022eca2f06f4e3cd86362f2794", "fn:set_stylist_age_display_mode(text)": "72292ba67188d2498d139885dd17bc17", "fn:set_stylist_birth_date(date)": "8932df9229a7ad743c25b2e11a7b067c", "fn:set_stylist_career_phase(text,date,text,date,text)": "7acd94ffb08af025cc210fcec362dbad", "fn:set_stylist_value_priorities(text[])": "a20b2f3deb5eab4a71ddc8060d822cad", "fn:set_updated_at()": "39a342382d820c9ed67c581333f32beb", "fn:settle_rate_limit_slot(uuid,text)": "616a0c7b9d132ac82b920371efe1e39b", "fn:start_pending_diagnosis_claim(uuid)": "4499df0c1f0e32774aa2387d47649006", "fn:store_hiring_process_events_append_only()": "b7002e10158ae799cd9f080cbcee1421", "fn:store_hiring_processes_guard()": "294e689a60104bc3167c799660760b6e", "fn:store_hiring_staff_recipients(uuid)": "c74a8c5c61d2f31c72926c94b2cb0eb9", "fn:stripe_assert_company_billing_actor(uuid)": "5ce9be537ed72580a8fa22a9d84249d0", "fn:stripe_begin_checkout_record(uuid,text,uuid,uuid,integer,integer,numeric,integer,integer)": "64ecad051236abdb1de73c21aa37b79d", "fn:stripe_checkout_records_guard()": "247ca503c42997071eb8317800efd718", "fn:stripe_log_issue(text,text,uuid,uuid,uuid,text,text,text)": "554da63dcc1fba43b8568614224ea2c6", "fn:stripe_payment_accounts_guard()": "f6f5bcdf92c10ded20844d71fe3be4ec", "fn:stripe_subscription_payment_state(text)": "a2bc80893c12eb2faf3adc5023dc9702", "fn:stripe_subscriptions_guard()": "96c7f8bbec44fe3cedf1995db4dfac42", "fn:stylist_age_years(date)": "0bb41f409097a36c58f5f4973c788ac0", "fn:stylist_public_extended_enabled()": "f15d5d02b1b2a6c5cfaccb20e89d6f54", "fn:stylist_salon_publishable(uuid)": "ad4bff17a6cc7b211fdbccfe4d36d5f7", "fn:subscription_invoice_documents_guard()": "ab7a666015b9aecd8be88ffc64af91e5", "fn:subscription_invoice_issue_state(uuid)": "2d34539171768ac4ca0ed6f0a03b4294", "fn:subscription_invoice_register(uuid,text,text,uuid)": "1f13f96e9916f0cc9b731d2b091d991f", "fn:update_hiring_internal_note(uuid,text)": "7298ab223eabc7acc972f61acd09d70f", "fn:update_hiring_status(uuid,text,text,text,text,text)": "585a023302f50a9320c00a4267a37a49", "fn:update_organization_billing_profile(uuid,jsonb)": "ab224688b5f307db4617720af2bdc661", "fn:update_salon_logo(text)": "3b8ed380f14ab316262c71d2b042c4a0", "fn:update_salon_photo_sort_order(uuid,integer)": "3f90abb38fe3ab2d905f07fa3b139da7", "fn:update_store_photo_sort_order(uuid,integer)": "4099e5b90ac737a29431ca4687b6fdc3", "fn:validate_and_normalize_avatar_path(uuid,text)": "5b28b70ec350ad03731431de5f940c1d", "fn:validate_and_normalize_salon_photo_path(uuid,text,text)": "89ecc1b033e897f7114582ed42ea72f7", "rel:account_invitation_events": "8a1a9c35f167e524fc77991a8416f061", "rel:account_invitations": "9fc87521ef5996a545f760c44060cc16", "rel:account_recovery_requests": "8129d7dfb76712a308453d8be7e8f78f", "rel:admin_audit_events": "751465782485eb96f08d96358c0d4b21", "rel:admin_invoice_checkouts": "1fed8ed66cd88411aeeac267889edf12", "rel:admin_invoice_lines": "5339280b5641b56c45e5deb023f72f2c", "rel:admin_invoice_webhook_events": "4384825a139389ec46c6d815da2dc911", "rel:admin_invoices": "5d14ed66876e8f1d55241e58333ca86c", "rel:admin_message_deliveries": "d71891e16faf36782044a5491dc3242e", "rel:admin_messages": "348d8ce03f04f8d7991256d17e2d6466", "rel:admin_quotes": "a3301789e4bb5635fdd08f1a59776a9a", "rel:admin_staff": "d0016ca2a5c3226f9ab5f2859aaa2546", "rel:admin_staff_events": "c9be9cccb3f584fea3fdfd1a2de679d1", "rel:admin_staff_invitations": "9281d04031520fc709fdb96502634df9", "rel:admin_threads": "ef90eda1b1f49264b72e524f3687cc28", "rel:admin_unresolved_billing_cases": "efb30e71411e9fe91c4eaceca232b38c", "rel:admin_visit_cases": "a9027a7856994f8aea588216c3423cb6", "rel:admin_visit_confirmations": "5eb65cb80e88b8d65f8a2eeb5a0d5e69", "rel:admin_visit_occurrences": "ea92fa86cdf950235c3a21db693c37de", "rel:admin_visit_request_events": "0f33bb52d10854a136d401314ad0d3e0", "rel:admin_visit_requests": "4f2226c4cfbe957567ce147a88e80dad", "rel:age_disclosure_requests": "86c115b32e4417cc0c8035d00d6526b1", "rel:billing_issuer_settings": "feb990a804248103de9bdc492121bc4f", "rel:billing_issuer_settings_events": "afaa357c0f8f00b3144ec643c87ec623", "rel:diagnosis_ai_outputs": "32cfa66a24f2ea8f2e5e06a5ef6ee813", "rel:diagnosis_change_limits": "f97588277c20d2b1158ad29739d813c7", "rel:diagnosis_results": "fa1c221fd307884cc0052c1fa69d0331", "rel:diagnosis_save_requests": "0c4c3e4cc6e035e9bd1edef175c57562", "rel:employee_size_master": "b2a87299e40e6398a12af4aab0ebba8f", "rel:feature_pauses": "4d5e1af31c920d4b46341fa1fe7bebf4", "rel:hiring_process_billing_basis": "1699d39dabce0878a31839d739f3e622", "rel:hiring_success_fee_events": "c00d2e8027fcf45807568aeb6a123cbf", "rel:hiring_success_fees": "9d307cef31079b7f520c48aef3652df5", "rel:invoice_document_events": "c1f7c2ada0db7e7765e0f98e3b1aafa3", "rel:invoice_documents": "8ca3838c6f59eea41d6791df1184bb32", "rel:invoice_number_counters": "ceb257b9a8ee4b0d205498ae1f10972d", "rel:legal_documents": "ea9f4238fd033a3444527aaf7159f292", "rel:notification_email_config": "194392ba5e97cac46e037edcf81b094e", "rel:notification_email_outbox": "6671a242c22618d4ec3565b400bafd5c", "rel:notification_email_outbox_events": "c7378e8cadb53478fae7ea06a3d7f380", "rel:notification_email_preferences": "e7db06847e6221b35aab99c275340e37", "rel:notifications": "eef241d5246a63ee54219ed9c8c9d584", "rel:organization_billing_profile_events": "75b0e4ee3fd60c6650f919e53b020468", "rel:organization_billing_profiles": "d48a104de0da47589b68c8a2d3d18ab4", "rel:organization_billing_regime": "84369457e18601252ee18c4d55ab04f0", "rel:organization_contract_events": "9a71a10c2d8647ef88b4cdacf6a890af", "rel:organization_contract_events_seq_seq": "eaf2716a32117c353aa41fe7232e1276", "rel:organization_contract_settings": "b683c6c3e81293776d38b7e084022384", "rel:organization_location_events": "c6b031504dc45b4b0fc5534a0b31c95b", "rel:organization_members": "e6715d8aec88e8742fd900f98f50411f", "rel:organization_payment_accounts": "01a4954770f67351aa883abed37b4180", "rel:organization_scout_quotas": "b91754d71782fe5bbde4ae3823c97ba4", "rel:organization_subscriptions": "0eb911482cfed865b3f1eb0817631447", "rel:pending_diagnoses": "175bd37c1f90c9855ab4e65c89a46352", "rel:platform_admins": "1fbd3c257a424736003b4b03b620b950", "rel:profiles": "8e30f849c6e8e4e0296c1d216a3edb02", "rel:rate_limit_counters": "5d5ab26de2ac34e43f3d350d239962a9", "rel:rate_limit_reservations": "9ea7fc8aca7a09378961e14fc4269dbe", "rel:salary_offers": "1c00cd87a78bdade417c75866f8291d5", "rel:salon_culture_ai_outputs": "c08f6c77d65e0572e3aa64a57c6b1e9d", "rel:salon_culture_analysis_answers": "865f0cfe63a862c9bebe2fc3d67b9a2e", "rel:salon_culture_drafts": "f50591dc8aba3888b817028a6e0b0ac1", "rel:salon_culture_profiles": "b5066acaf64b7e417c2d82c290bce52a", "rel:salon_inquiries": "2610469edb9b64a3c17dd0791ff273d6", "rel:salon_links": "955233692d45e3dd99880e7557bb1a71", "rel:salon_onboarding_assignments": "318784a4c5e5a7b1d272527dc28974cd", "rel:salon_organizations": "c9befbae6bccd693134228409146eb4d", "rel:salon_photos": "c1991d8ccbe2f010311ce1fa7c3b67b8", "rel:salon_profile_text_baseline_0088": "7a3bc98d50e7100508e2e9ca8dbe0c17", "rel:salon_profiles": "88543feb5c5bbd22b000c9724cae5671", "rel:salon_scout_quotas": "953ba8f0b9886540cdc41a6f7801fc5e", "rel:salon_store_culture_profiles": "e517bf04c807ff41fa3ea16beae44973", "rel:salon_store_links": "2994cd601e1677a79a72446abe49d088", "rel:salon_store_logos": "c326adadf876bb7da71e97bc9c2feb4c", "rel:salon_store_photos": "659aa079bf66ec6d780e376cef1535c9", "rel:salon_store_profile_backfill_0057": "c8011b5d43e0909f168f11e449053583", "rel:salon_store_profile_text_history": "44293afd87b137cf340d12bb0bf6a19f", "rel:salon_store_profiles": "29eed9b4e8f94fc8131d89e7ec32ca25", "rel:salon_stores": "6ba40cc17b325a0c9c560797516c3b87", "rel:scout_credit_packages": "50c8ab7b321a365f753611e6e2e9013f", "rel:scout_credit_purchases": "a267a3bf6ecb34cdfe7a033740e03385", "rel:scout_optout_migration_0070": "9244e06a3b666f17826bb3d7def2ef06", "rel:scouts": "9e627f7cceb38c5516c2f08b27ab95a5", "rel:store_hiring_process_events": "32e26a42b73cd0a7806e4c8ba68fd9f7", "rel:store_hiring_processes": "2bf975a26cad9b56fb7af7e1debe6fe6", "rel:store_members": "2dc0841b7acad4f88daca039d1bb7dfd", "rel:stripe_checkout_records": "32007ebd1de5b66805475d685a840430", "rel:stripe_integrity_issues": "5ace014839c7e478f4b230baee35a58c", "rel:stripe_webhook_events": "beae9302ccfa96e295d07182ae061c47", "rel:student_diagnosis_results": "7c4261753200c087f00ef2183b2b9ba3", "rel:stylist_core_type_assignments": "38d02c8d0e8cb0071a78643176790966", "rel:stylist_core_type_history": "8ce18f32ac692a43ba17470b881580d5", "rel:stylist_diagnosis_current": "19baf4cf024f1dafd6141d7715ba1245", "rel:stylist_evidence_documents": "9a87734fcfea61ebc99dd9e567efeb85", "rel:stylist_favorite_salons": "3ebe03d961173847ca2f8b0d52f911d8", "rel:stylist_match_profiles": "a342e778b87be00c2b80585656359df3", "rel:stylist_match_verification_snapshots": "9d86cef443c70edb1aad0561f86f0a58", "rel:stylist_preference_profiles": "3294f33839d1d15979ff8da04a06cfeb", "rel:stylist_private": "c578eda34a47d1104111ebd74c6a9e48", "rel:stylist_profiles": "58abbca0155e6df7525cd9f50d73de10", "rel:stylist_salon_interests": "e1c481f3ed59d1307a9222250f9a98ce", "rel:subscription_invoice_document_events": "c45540fbadf61349199a07d13c60fd66", "rel:subscription_invoice_documents": "c274659e6915a8d3f4e5e93d18a423ea", "rel:subscription_invoice_payments": "14589d544d0be3a9e17db5070cc136a2", "rel:success_fee_payments": "66503ccd7ab5ccb31a234e160aac2e2b", "rel:user_legal_acceptances": "7f84fcfbc6c0a8ba218b2d917ca6b617", "rel:user_roles": "b3e004e60ff513256a30caece2c6b693", "rel:user_settings": "b5d7056b10adb08c8618391aca63d5f7", "role:anon": "2ae66f90b7788ab8950e8f81b829c947", "role:authenticated": "700633a1b0f65fa8456a18bd6053193c", "role:postgres": "e8a48653851e28c69d0506508fb27fc5", "role:service_role": "c56ec2e104f2c93fd656087be1e991a0", "type:account_recovery_account_type": "580205963efc9e899b4c248e5efd66bc", "type:account_recovery_status": "81ce4f2c9d4eabb7055b35c53fb502fe", "type:age_band": "f3e17d9e3aced3afb7e699d76182ad26", "type:ai_generation_status": "b568f15d5bfb1091491d06420930609c", "type:ai_output_type": "28f6c385503c4d483899f138000dcb88", "type:diagnosis_mode": "580205963efc9e899b4c248e5efd66bc", "type:employment_type": "5d3c39809925c47bf78f993e3b543744", "type:gender_type": "fcf9f7ff99be88eee1d4e290aee8a362", "type:job_change_intent": "40898a2440df3ed2345f46be0237b530", "type:pending_diagnosis_claim_status": "947cadb5fb3f9da53a789ed5d4066178", "type:profile_visibility": "df3a463b71ca6e5c96eaad2cceefd00f", "type:salary_band": "2be8a39fd4884de6d1f381b002ec623f", "type:salon_culture_respondent_role": "7b6dab952396e72f3e00ee6a7b9c8720", "type:salon_culture_status": "47e12579a2f6a2645f2c0d28e8bfb19e", "type:stylist_core_type": "de3a984f26c91d139953da159cd63f2c", "type:stylist_preference_status": "47e12579a2f6a2645f2c0d28e8bfb19e", "type:user_role": "ce3ed909355aa1ebd74436223e7d6548"}'::jsonb; v_bad text;
begin
  v_cur := (select coalesce(jsonb_object_agg(k, h), '{}'::jsonb) from (select 'fn:' || p.oid::regprocedure::text as k, md5(p.prosrc || '|' || pg_get_function_arguments(p.oid) || '|' || pg_get_function_result(p.oid) || '|' || p.prokind::text || p.prosecdef || p.provolatile::text || p.proparallel::text || p.proleakproof || p.proisstrict || p.proretset || '|' || (select l.lanname from pg_language l where l.oid = p.prolang) || '|' || pg_get_userbyid(p.proowner) || '|' || coalesce((select string_agg(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || '<-' || pg_get_userbyid(a.grantor) || ':' || a.privilege_type || ':' || a.is_grantable, ',' order by case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, pg_get_userbyid(a.grantor), a.privilege_type) from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a),'') || '|' || coalesce(array_to_string(p.proconfig, ','), '')) as h from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f','p') union all select 'rel:' || c.relname, md5(c.relkind::text || '|' || pg_get_userbyid(c.relowner) || '|' || c.relrowsecurity || c.relforcerowsecurity || '|' || coalesce((select string_agg(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || '<-' || pg_get_userbyid(a.grantor) || ':' || a.privilege_type || ':' || a.is_grantable, ',' order by case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, pg_get_userbyid(a.grantor), a.privilege_type) from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a),'') || '|' || coalesce((select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), '') || ':' || a.attidentity::text || a.attgenerated::text, ',' order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped), '') || '|' || coalesce((select string_agg(k.conname || ':' || pg_get_constraintdef(k.oid) || ':' || k.convalidated, ',' order by k.conname) from pg_constraint k where k.conrelid = c.oid), '') || '|' || coalesce((select string_agg(i.indexdef, ',' order by i.indexname) from pg_indexes i where i.schemaname = 'public' and i.tablename = c.relname), '') || '|' || coalesce((select string_agg(o.polname || ':' || o.polcmd::text || ':' || o.polpermissive || ':' || coalesce(pg_get_expr(o.polqual, o.polrelid), '') || ':' || coalesce(pg_get_expr(o.polwithcheck, o.polrelid), '') || ':' || (select coalesce(string_agg(case when r = 0 then 'PUBLIC' else pg_get_userbyid(r) end, ',' order by case when r = 0 then 'PUBLIC' else pg_get_userbyid(r) end), '') from unnest(o.polroles) r), ',' order by o.polname) from pg_policy o where o.polrelid = c.oid), '') || '|' || coalesce((select string_agg(t.tgname || ':' || t.tgenabled::text || ':' || pg_get_triggerdef(t.oid), ',' order by t.tgname) from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal), '')) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m','S','f') union all select 'type:' || t.typname, md5(t.typtype::text || '|' || coalesce((select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid), '')) from pg_type t where t.typnamespace = 'public'::regnamespace and t.typtype = 'e' union all select 'authtrg:' || t.tgname, md5(t.tgenabled::text || pg_get_triggerdef(t.oid)) from pg_trigger t where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal union all select 'deprel:' || c.relname, md5(c.relkind::text || '|' || c.relrowsecurity || c.relforcerowsecurity || '|' || coalesce((select string_agg(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || '<-' || pg_get_userbyid(a.grantor) || ':' || a.privilege_type || ':' || a.is_grantable, ',' order by case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, pg_get_userbyid(a.grantor), a.privilege_type) from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a),'') || '|' || coalesce((select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull, ',' order by a.attname) from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped), '') || '|' || coalesce((select string_agg(k.conname || ':' || pg_get_constraintdef(k.oid), ',' order by k.conname) from pg_constraint k where k.conrelid = c.oid), '') || '|' || coalesce((select string_agg(o.polname || ':' || o.polcmd::text || ':' || coalesce(pg_get_expr(o.polqual, o.polrelid), '') || ':' || coalesce(pg_get_expr(o.polwithcheck, o.polrelid), ''), ',' order by o.polname) from pg_policy o where o.polrelid = c.oid), '') || '|' || coalesce((select string_agg(t.tgname || ':' || t.tgenabled::text || ':' || pg_get_triggerdef(t.oid), ',' order by t.tgname) from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal), '')) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m') union all select 'authcol:' || c.relname || '.' || a.attname, md5(format_type(a.atttypid, a.atttypmod)) from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped where c.relnamespace = 'auth'::regnamespace and c.relname in ('users', 'sessions') and c.relkind in ('r','p') union all select 'authfn:' || p.proname, md5(pg_get_function_identity_arguments(p.oid) || '->' || pg_get_function_result(p.oid)) from pg_proc p where p.pronamespace = 'auth'::regnamespace and p.proname in ('uid', 'jwt', 'role') union all select 'role:' || r.rolname, md5(r.rolname) from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role', 'postgres')) t(k, h));
  select string_agg(e.key, ', ' order by e.key) into v_bad from jsonb_each_text(v_exp) e where v_cur->>e.key is distinct from e.value;
  if v_bad is not null then raise exception 'staff guard [巻き戻し後] 不一致のオブジェクト: %', v_bad using errcode = 'P0001'; end if;
  if (select coalesce(string_agg(k, ',' order by k), '') from jsonb_object_keys(v_cur) k where not ((current_setting('staff.rb_map')::jsonb) ? k)) <> '' then raise exception 'staff guard [巻き戻し後] 想定外の新規オブジェクト' using errcode = 'P0001'; end if;
  if exists (select 1 from unnest(array['fn:_admin_user_is_operator(uuid)','fn:admin_create_visit_thread(uuid,uuid,text,text,text)']::text[]) k where v_cur ? k) then raise exception 'staff guard [巻き戻し後] 削除されるはずのオブジェクトが残っている' using errcode = 'P0001'; end if;
end $guard$;
commit;
