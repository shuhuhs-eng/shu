-- 0098_staff_operator_access.draft.sql（草案・未適用・番号は提案）。依存: 0097v2（is_admin_operator）。
-- 目的: スタッフに許す通常業務（見学受付・担当変更・日程調整・双方確認・連絡）の既存RPC15本と、連絡メッセージの作成者規則を、責任者のみ→運営（責任者＋有効なスタッフ）へ広げる。
-- 変更するのは「入口の判定1行」と「担当者・作成者が運営かの判定」だけ。本文のそれ以外は生成元の定義のまま（置換が想定どおり1件であることを生成時に確認済み）。
-- 責任者専用のまま（本草案では一切触れない）: 請求・決済・返金・料金・契約・権限・設定・個人情報の閲覧範囲が未決の一覧（admin_list_stylists 等）。
begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('beauty-reach-0098'));
do $guard$
begin
  if to_regprocedure('public.is_admin_operator()') is null or to_regprocedure('public.admin_operator_role()') is null then raise exception '0098 適用中止: 0097v2 がありません'; end if;
    if (select md5(prosrc) from pg_proc where oid = to_regprocedure('admin_assign_visit_request(uuid,uuid,timestamp with time zone)')) is distinct from '15c70c07a11a2a1ea61617c1fb493b88' then raise exception '0098 適用中止: admin_assign_visit_request の定義が想定と違います(基にした版ではない)'; end if;
    if (select md5(prosrc) from pg_proc where oid = to_regprocedure('admin_claim_visit_request(text,uuid)')) is distinct from '924bfbca0b7336017d8e73349005a4e8' then raise exception '0098 適用中止: admin_claim_visit_request の定義が想定と違います(基にした版ではない)'; end if;
    if (select md5(prosrc) from pg_proc where oid = to_regprocedure('admin_get_thread(uuid)')) is distinct from '098f3d206cae5846ccf11ac7c9ebd3e0' then raise exception '0098 適用中止: admin_get_thread の定義が想定と違います(基にした版ではない)'; end if;
    if (select md5(prosrc) from pg_proc where oid = to_regprocedure('admin_get_visit_request(uuid)')) is distinct from 'deba2a6f55d129c99f4d43e037336572' then raise exception '0098 適用中止: admin_get_visit_request の定義が想定と違います(基にした版ではない)'; end if;
    if (select md5(prosrc) from pg_proc where oid = to_regprocedure('admin_list_hiring_processes(text,text,timestamp with time zone,timestamp with time zone,uuid,uuid,integer,integer)')) is distinct from '8e473d73ca2d0e48b59921f9527f6686' then raise exception '0098 適用中止: admin_list_hiring_processes の定義が想定と違います(基にした版ではない)'; end if;
    if (select md5(prosrc) from pg_proc where oid = to_regprocedure('admin_list_store_culture_readiness(text,text,uuid,integer,integer)')) is distinct from '12f4f28ea1b52fdd6160591a9b7ccfc1' then raise exception '0098 適用中止: admin_list_store_culture_readiness の定義が想定と違います(基にした版ではない)'; end if;
    if (select md5(prosrc) from pg_proc where oid = to_regprocedure('admin_list_store_interests(text,timestamp with time zone,timestamp with time zone,uuid,uuid,integer,integer)')) is distinct from '583dfde9a3f5a572d737141a543d555b' then raise exception '0098 適用中止: admin_list_store_interests の定義が想定と違います(基にした版ではない)'; end if;
    if (select md5(prosrc) from pg_proc where oid = to_regprocedure('admin_list_threads(uuid,uuid,uuid,text,integer,integer)')) is distinct from '942780646d9014a0a31d0262bbed799e' then raise exception '0098 適用中止: admin_list_threads の定義が想定と違います(基にした版ではない)'; end if;
    if (select md5(prosrc) from pg_proc where oid = to_regprocedure('admin_list_visit_requests(text,text,text,uuid,boolean,integer,integer)')) is distinct from '45cdb07810197bf33df966fb1cae6c35' then raise exception '0098 適用中止: admin_list_visit_requests の定義が想定と違います(基にした版ではない)'; end if;
    if (select md5(prosrc) from pg_proc where oid = to_regprocedure('admin_post_message(uuid,uuid,text,text)')) is distinct from '9f6af8f54f670ca198ef7a50fc25d65b' then raise exception '0098 適用中止: admin_post_message の定義が想定と違います(基にした版ではない)'; end if;
    if (select md5(prosrc) from pg_proc where oid = to_regprocedure('admin_record_delivery(uuid,text,text)')) is distinct from '34bd7092743fbc0bf05e2b57985e5fe6' then raise exception '0098 適用中止: admin_record_delivery の定義が想定と違います(基にした版ではない)'; end if;
    if (select md5(prosrc) from pg_proc where oid = to_regprocedure('admin_record_visit_confirmation(uuid,text,text,text,text,timestamp with time zone)')) is distinct from '3cad9ba90aa0ae1e2b62da7bade457a1' then raise exception '0098 適用中止: admin_record_visit_confirmation の定義が想定と違います(基にした版ではない)'; end if;
    if (select md5(prosrc) from pg_proc where oid = to_regprocedure('admin_set_thread_status(uuid,text)')) is distinct from '22daac445ca91d07f41f9ffc64a36221' then raise exception '0098 適用中止: admin_set_thread_status の定義が想定と違います(基にした版ではない)'; end if;
    if (select md5(prosrc) from pg_proc where oid = to_regprocedure('admin_update_visit_request(uuid,text,timestamp with time zone,date,text,text,uuid)')) is distinct from 'e7b112abd5eacaea1dc17c9f89c78a81' then raise exception '0098 適用中止: admin_update_visit_request の定義が想定と違います(基にした版ではない)'; end if;
    if (select md5(prosrc) from pg_proc where oid = to_regprocedure('_admin_messages_rules()')) is distinct from '1eedb9c4adc806ec48f98ebc295d20a7' then raise exception '0098 適用中止: _admin_messages_rules の定義が想定と違います(基にした版ではない)'; end if;
end $guard$;
-- 運営かの判定（ユーザーIDを指定。セッション照合はしない＝作成者・担当者の資格確認用）。内部関数。
create function public._admin_user_is_operator(p_user_id uuid) returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select p_user_id is not null and (exists (select 1 from public.platform_admins where user_id = p_user_id) or exists (select 1 from public.admin_staff where user_id = p_user_id and status = 'active')) $$;
revoke all on function public._admin_user_is_operator(uuid) from public, anon, authenticated, service_role;
-- 受付案件を起点にした連絡の作成（運営）。宛先は『案件』からサーバー側で確定する（呼び出し側は案件IDと宛先の種類だけを渡す）。
-- 任意の宛先ID・会社・店舗は受け取らない。一般の新規スレッド作成 admin_create_thread は責任者専用のまま（本草案では変更しない）。
create function public.admin_create_visit_thread(p_request_id uuid, p_visit_request_id uuid, p_audience text, p_subject text, p_body text)
 returns uuid language plpgsql security definer set search_path to 'public', 'pg_temp'
as $fn$
declare v_uid uuid := auth.uid(); r public.admin_visit_requests; v_org uuid; v_rcp uuid; v_store uuid; v_thread uuid; v_msg uuid; v_hash text; v_prev record; v_body text := btrim(coalesce(p_body, ''));
begin
  if not public.is_admin_operator() then raise exception 'admin access required'; end if;
  if p_request_id is null or p_visit_request_id is null then raise exception 'request id required'; end if;
  if p_audience is null or p_audience not in ('stylist', 'salon') then raise exception 'invalid audience'; end if;
  if char_length(v_body) = 0 then raise exception 'invalid body'; end if;
  v_hash := public._admin_request_hash('create_visit_thread', p_audience, p_visit_request_id::text, btrim(coalesce(p_subject, '')), v_body, '', '', '');
  perform public._admin_lock_request(v_uid, p_request_id);
  select m.thread_id, m.request_hash into v_prev from public.admin_messages m where m.author_user_id = v_uid and m.request_id = p_request_id;
  if found then
    if v_prev.request_hash <> v_hash then raise exception 'request id content mismatch'; end if;
    return v_prev.thread_id;
  end if;
  select * into r from public.admin_visit_requests where id = p_visit_request_id;
  if not found then raise exception 'request not found'; end if;
  if r.merged_into_request_id is not null then raise exception 'request was merged'; end if;
  if p_audience = 'stylist' then
    v_rcp := r.stylist_user_id;
  else
    select s.organization_id into v_org from public.salon_stores s where s.id = r.store_id;
    if v_org is null then raise exception 'store has no organization'; end if;
    v_store := r.store_id;
  end if;
  insert into public.admin_threads (audience, recipient_user_id, organization_id, store_id, visit_case_id, subject, created_by)
    values (p_audience, v_rcp, v_org, v_store, null, btrim(coalesce(p_subject, '')), v_uid) returning id into v_thread;
  insert into public.admin_messages (thread_id, kind, author_user_id, body, request_id, request_hash) values (v_thread, 'to_recipient', v_uid, v_body, p_request_id, v_hash) returning id into v_msg;
  insert into public.admin_message_deliveries (message_id) values (v_msg);
  insert into public.admin_audit_events (actor_user_id, action, target_type, target_id, organization_id, store_id, after_value)
    values (v_uid, 'thread_created', 'thread', v_thread, v_org, v_store, jsonb_build_object('audience', p_audience, 'visit_request_id', p_visit_request_id));
  return v_thread;
end $fn$;
revoke all on function public.admin_create_visit_thread(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.admin_create_visit_thread(uuid, uuid, text, text, text) to authenticated;
-- admin_assign_visit_request
CREATE OR REPLACE FUNCTION public.admin_assign_visit_request(p_id uuid, p_admin uuid, p_expected_updated_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_uid uuid := auth.uid(); r public.admin_visit_requests;
begin
  if not public.is_admin_operator() then raise exception 'admin access required'; end if;
  if p_admin is not null and not public._admin_user_is_operator(p_admin) then raise exception 'assignee must be an admin'; end if;
  select * into r from public.admin_visit_requests where id = p_id for update;
  if not found then raise exception 'request not found'; end if;
  if r.updated_at is distinct from p_expected_updated_at then raise exception 'request was updated by someone else'; end if;
  if r.status in ('attended', 'closed') then raise exception 'request is already finished'; end if;
  update public.admin_visit_requests set assigned_admin_id = p_admin where id = r.id;
  insert into public.admin_visit_request_events (request_id, actor_user_id, action, before_value, after_value)
    values (r.id, v_uid, 'assigned', jsonb_build_object('assigned_admin_id', r.assigned_admin_id), jsonb_build_object('assigned_admin_id', p_admin));
end;
$function$;
-- admin_claim_visit_request
CREATE OR REPLACE FUNCTION public.admin_claim_visit_request(p_source_kind text, p_source_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_uid uuid := auth.uid(); v_kind text; v_stylist uuid; v_store uuid; v_id uuid;
begin
  if not public.is_admin_operator() then raise exception 'admin access required'; end if;
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
-- admin_get_thread
CREATE OR REPLACE FUNCTION public.admin_get_thread(p_thread_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_result jsonb;
begin
  if not public.is_admin_operator() then raise exception 'admin access required'; end if;
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
-- admin_get_visit_request
CREATE OR REPLACE FUNCTION public.admin_get_visit_request(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v jsonb;
begin
  if not public.is_admin_operator() then raise exception 'admin access required'; end if;
  select to_jsonb(r) || jsonb_build_object(
      'source_cancelled', (case r.source_kind when 'direct_interest' then not exists (select 1 from public.stylist_salon_interests i where i.id = r.source_interest_id) else not exists (select 1 from public.scouts s where s.id = r.source_scout_id) end),
      'confirmations', coalesce((select jsonb_agg(to_jsonb(c) order by c.party) from public.admin_visit_confirmations c where c.occurrence_id = r.occurrence_id), '[]'::jsonb),
      'events', coalesce((select jsonb_agg(jsonb_build_object('action', e.action, 'actor_user_id', e.actor_user_id, 'before_value', e.before_value, 'after_value', e.after_value, 'created_at', e.created_at) order by e.created_at) from public.admin_visit_request_events e where e.request_id = r.id), '[]'::jsonb))
    into v from public.admin_visit_requests r where r.id = p_id;
  if v is null then raise exception 'request not found'; end if;
  return v;
end;
$function$;
-- admin_list_hiring_processes
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
  if not public.is_admin_operator() then raise exception 'admin access required'; end if;
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
-- admin_list_store_culture_readiness
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
  if not public.is_admin_operator() then raise exception 'admin access required'; end if;
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
-- admin_list_store_interests
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
  if not public.is_admin_operator() then raise exception 'admin access required'; end if;
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
-- admin_list_threads
CREATE OR REPLACE FUNCTION public.admin_list_threads(p_organization_id uuid DEFAULT NULL::uuid, p_store_id uuid DEFAULT NULL::uuid, p_visit_case_id uuid DEFAULT NULL::uuid, p_status text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100); v_offset int := greatest(coalesce(p_offset, 0), 0); v_result jsonb;
begin
  if not public.is_admin_operator() then raise exception 'admin access required'; end if;
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
-- admin_list_visit_requests
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
  if not public.is_admin_operator() then raise exception 'admin access required'; end if;
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
-- admin_post_message
CREATE OR REPLACE FUNCTION public.admin_post_message(p_request_id uuid, p_thread_id uuid, p_kind text, p_body text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_uid uuid := auth.uid(); v_msg uuid; v_hash text; v_prev record; v_body text := btrim(coalesce(p_body, ''));
begin
  if not public.is_admin_operator() then raise exception 'admin access required'; end if;
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
-- admin_record_delivery
CREATE OR REPLACE FUNCTION public.admin_record_delivery(p_message_id uuid, p_status text, p_error_code text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.is_admin_operator() then raise exception 'admin access required'; end if;
  if p_status not in ('sent','failed','skipped') then raise exception 'invalid status'; end if;
  update public.admin_message_deliveries set status = p_status, error_code = case when p_status = 'failed' then left(p_error_code, 80) else null end,
    attempts = attempts + 1, last_attempt_at = now()
  where message_id = p_message_id;
  if not found then raise exception 'delivery not found'; end if;
end $function$;
-- admin_record_visit_confirmation
CREATE OR REPLACE FUNCTION public.admin_record_visit_confirmation(p_request_id uuid, p_party text, p_result text, p_channel text, p_note text DEFAULT NULL::text, p_confirmed_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_uid uuid := auth.uid(); r public.admin_visit_requests; o public.admin_visit_occurrences; v_before jsonb;
begin
  if not public.is_admin_operator() then raise exception 'admin access required'; end if;
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
-- admin_set_thread_status
CREATE OR REPLACE FUNCTION public.admin_set_thread_status(p_thread_id uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_old text;
begin
  if not public.is_admin_operator() then raise exception 'admin access required'; end if;
  if p_status not in ('open_internal','waiting_recipient','waiting_admin','done') then raise exception 'invalid status'; end if;
  select status into v_old from public.admin_threads where id = p_thread_id for update;   -- ③
  if not found then raise exception 'thread not found'; end if;
  if v_old = p_status then return; end if;
  update public.admin_threads set status = p_status, updated_at = now() where id = p_thread_id;
  insert into public.admin_audit_events (actor_user_id, action, target_type, target_id, before_value, after_value)
    values (auth.uid(), 'thread_status_changed', 'thread', p_thread_id, jsonb_build_object('status', v_old), jsonb_build_object('status', p_status));
end $function$;
-- admin_update_visit_request
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
  if not public.is_admin_operator() then raise exception 'admin access required'; end if;
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
-- _admin_messages_rules
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
  if new.kind in ('to_recipient','internal_note','offline_log') and not public._admin_user_is_operator(new.author_user_id) then
    raise exception 'only admins can write this kind of message';
  end if;
  if new.kind = 'from_recipient' and not public._admin_thread_visible_to(new.thread_id, new.author_user_id) then
    raise exception 'author cannot access this thread';
  end if;
  return new;
end $function$;
commit;
