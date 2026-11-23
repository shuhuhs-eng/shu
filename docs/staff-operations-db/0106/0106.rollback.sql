-- 0106 巻き戻し（草案・初期投入以外のデータが無いときだけ。巻き戻し前→本体→巻き戻し後の自己検証つき）
-- ★単独実行形式（psql専用命令なし）。Supabase SQL Editor に全文を貼り付けて実行できる。不一致は例外で全体がロールバックされる。
-- ★失敗したら『rollback;』だけを単独で実行して状態を確認する。期待値は使い捨てDBでの実測（gen_staff_guards.py）。本番の実定義が検証DBと異なれば『適用前』で中止する（保守的）。
-- ★検査は2種類: 『変更対象』(このSQLが置き換える既存オブジェクトが想定の版か) と 『依存先』(このSQLが前提にするが変更しない関数・表・認証側の参照列・ロールが想定どおりか)。
begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtextextended('beauty-reach-staff-0106', 0));
do $guard$
declare v_cur jsonb; v_exp jsonb := '{"deprel:stylist_private": "31b3176a6074297b3fccd6e2177f1cd1", "deprel:stylist_profiles": "e4e51a36ff4c8e6c303f9d18ab87f72a", "deprel:user_roles": "8f21df4a4e609401ad0e7c46397bbcd1", "fn:_ops_staff_account(uuid)": "436fb2f2f5cd9b286de3129af05100ec", "fn:_ops_staff_no_role_rows()": "2143cad37974aae1c494884ed40c7c74", "fn:calculate_stylist_salon_match(uuid)": "d35a07fe64baaa8cd51dcbbe15fa4a82", "fn:calculate_stylist_store_match(uuid)": "8081ec069655c95da366c2e09625a736", "fn:decline_hiring_process(uuid,text)": "1e088b18233bc9185779eb8c1c69d646", "fn:delete_stylist_evidence_document(uuid)": "4fc9b02ca9d2dea022bd89c0869b4a7e", "fn:get_my_age_disclosure_requests()": "2c34efc893f20ffec37aba0969820136", "fn:get_my_hiring_processes()": "0f138602e4c8be5def3a01d8fdc0d0bc", "fn:mark_scout_read(uuid)": "60d4051fd27e1ffcd31fbc00ba316f19", "fn:register_stylist_evidence_document(text,text,text)": "c557783dd7deb7cbdee5edcf44143617", "fn:respond_age_disclosure_request(uuid,boolean)": "1408157f069b0ac31a10c9dda85170e4", "fn:respond_salary_offer(uuid,text,text,text)": "42e2412a657bd69c55ae083e47763fca", "fn:respond_scout(uuid,text,text)": "eae0f80c9d29b7fa626a0453f1f849a6", "fn:save_stylist_match_profile(text,text[],text,integer,integer,integer,integer,integer,integer,integer,integer,numeric,integer,integer,text)": "bfee91e5038f9f1e5dee52f2af6082a3", "fn:save_stylist_match_profile_v2(text,text[],text,boolean,integer,integer,integer,integer,integer,integer,integer,integer,numeric,integer,integer,text)": "84a3e7c820648eab4cc200bc5770091c", "fn:save_stylist_preference_profile(stylist_preference_status,integer,jsonb)": "8eb551f1a971020625c775a90bc7e6d8", "fn:save_stylist_profile_v4(text,text,age_band,gender_type,text,text,integer,text,text[],employment_type,job_change_intent,salary_band,jsonb,text,profile_visibility,boolean,text,text[],date,text,text,date,integer,text)": "a37d4fb237862da0aa68c3a7df1b3210", "fn:set_favorite_salon(uuid,boolean)": "1ce99685b0eb13a6b2f2ef5fb0e3d3d8", "fn:set_store_interest_v2(uuid,text,boolean)": "498d65dde8dc5726e1a1dafe3e08111b", "fn:set_stylist_age_display_mode(text)": "1368b31462e5b52a3d39d9167da37edb", "fn:set_stylist_birth_date(date)": "2dbbb4567ff21b673080d6fd7bea8571", "fn:set_stylist_value_priorities(text[])": "d3c25a1cc1533e315fef5bde311a8df2", "fn:stylist_salon_publishable(uuid)": "94a59a7b9b69cac299ef0fa4335cb9e4", "rel:stylist_private": "bb17748e7755ae14274e62576905bd54", "rel:stylist_profiles": "1c2c5ace8023d3011fcbd86c5d34432a", "rel:user_roles": "9419f06c2c769967972a46a3ab300eb9"}'::jsonb; v_bad text;
begin
  v_cur := (select coalesce(jsonb_object_agg(k, h), '{}'::jsonb) from (select 'fn:' || p.oid::regprocedure::text as k, md5(p.prosrc || '|' || pg_get_function_arguments(p.oid) || '|' || pg_get_function_result(p.oid) || '|' || p.prokind::text || p.prosecdef || p.provolatile::text || p.proparallel::text || p.proleakproof || p.proisstrict || p.proretset || '|' || (select l.lanname from pg_language l where l.oid = p.prolang) || '|' || pg_get_userbyid(p.proowner) || '|' || coalesce((select string_agg(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || '<-' || pg_get_userbyid(a.grantor) || ':' || a.privilege_type || ':' || a.is_grantable, ',' order by case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, pg_get_userbyid(a.grantor), a.privilege_type) from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a),'') || '|' || coalesce(array_to_string(p.proconfig, ','), '')) as h from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f','p') union all select 'rel:' || c.relname, md5(c.relkind::text || '|' || pg_get_userbyid(c.relowner) || '|' || c.relrowsecurity || c.relforcerowsecurity || '|' || coalesce((select string_agg(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || '<-' || pg_get_userbyid(a.grantor) || ':' || a.privilege_type || ':' || a.is_grantable, ',' order by case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, pg_get_userbyid(a.grantor), a.privilege_type) from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a),'') || '|' || coalesce((select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), '') || ':' || a.attidentity::text || a.attgenerated::text, ',' order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped), '') || '|' || coalesce((select string_agg(k.conname || ':' || pg_get_constraintdef(k.oid) || ':' || k.convalidated, ',' order by k.conname) from pg_constraint k where k.conrelid = c.oid), '') || '|' || coalesce((select string_agg(i.indexdef, ',' order by i.indexname) from pg_indexes i where i.schemaname = 'public' and i.tablename = c.relname), '') || '|' || coalesce((select string_agg(o.polname || ':' || o.polcmd::text || ':' || o.polpermissive || ':' || coalesce(pg_get_expr(o.polqual, o.polrelid), '') || ':' || coalesce(pg_get_expr(o.polwithcheck, o.polrelid), '') || ':' || (select coalesce(string_agg(case when r = 0 then 'PUBLIC' else pg_get_userbyid(r) end, ',' order by case when r = 0 then 'PUBLIC' else pg_get_userbyid(r) end), '') from unnest(o.polroles) r), ',' order by o.polname) from pg_policy o where o.polrelid = c.oid), '') || '|' || coalesce((select string_agg(t.tgname || ':' || t.tgenabled::text || ':' || pg_get_triggerdef(t.oid), ',' order by t.tgname) from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal), '')) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m','S','f') union all select 'type:' || t.typname, md5(t.typtype::text || '|' || coalesce((select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid), '')) from pg_type t where t.typnamespace = 'public'::regnamespace and t.typtype = 'e' union all select 'authtrg:' || t.tgname, md5(t.tgenabled::text || pg_get_triggerdef(t.oid)) from pg_trigger t where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal union all select 'deprel:' || c.relname, md5(c.relkind::text || '|' || c.relrowsecurity || c.relforcerowsecurity || '|' || coalesce((select string_agg(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || '<-' || pg_get_userbyid(a.grantor) || ':' || a.privilege_type || ':' || a.is_grantable, ',' order by case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, pg_get_userbyid(a.grantor), a.privilege_type) from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a),'') || '|' || coalesce((select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull, ',' order by a.attname) from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped), '') || '|' || coalesce((select string_agg(k.conname || ':' || pg_get_constraintdef(k.oid), ',' order by k.conname) from pg_constraint k where k.conrelid = c.oid), '') || '|' || coalesce((select string_agg(o.polname || ':' || o.polcmd::text || ':' || coalesce(pg_get_expr(o.polqual, o.polrelid), '') || ':' || coalesce(pg_get_expr(o.polwithcheck, o.polrelid), ''), ',' order by o.polname) from pg_policy o where o.polrelid = c.oid), '') || '|' || coalesce((select string_agg(t.tgname || ':' || t.tgenabled::text || ':' || pg_get_triggerdef(t.oid), ',' order by t.tgname) from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal), '')) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m') union all select 'authcol:' || c.relname || '.' || a.attname, md5(format_type(a.atttypid, a.atttypmod)) from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped where c.relnamespace = 'auth'::regnamespace and c.relname in ('users', 'sessions') and c.relkind in ('r','p') union all select 'authfn:' || p.proname, md5(pg_get_function_identity_arguments(p.oid) || '->' || pg_get_function_result(p.oid)) from pg_proc p where p.pronamespace = 'auth'::regnamespace and p.proname in ('uid', 'jwt', 'role') union all select 'role:' || r.rolname, md5(r.rolname) from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role', 'postgres')) t(k, h));
  select string_agg(e.key, ', ' order by e.key) into v_bad from jsonb_each_text(v_exp) e where v_cur->>e.key is distinct from e.value;
  if v_bad is not null then raise exception 'staff guard [巻き戻し前] 不一致のオブジェクト: %', v_bad using errcode = 'P0001'; end if;
  if exists (select 1 from public.admin_staff) then raise exception 'staff guard [巻き戻し前] スタッフ登録がある。美容師機能の遮断が外れるため中止（スタッフを停止して旧アプリへ戻し、DBは保持する。遮断を外す必要があるときはスタッフ0件が条件）' using errcode = 'P0001'; end if;
  perform set_config('staff.rb_map', v_cur::text, true);
end $guard$;
-- 0106 巻き戻し草案（未適用）。元の定義へ戻し、トリガー・関数を削除する。
select pg_advisory_xact_lock(hashtext('beauty-reach-0106'));
CREATE OR REPLACE FUNCTION public.stylist_salon_publishable(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce((
    select sp.birth_date is not null and sp.age_display_mode is not null
       and (public.stylist_age_years(sp.birth_date) >= 18
            or not coalesce((select paused from public.feature_pauses where feature = 'minor_salon_public'), true))
    from public.stylist_private sp where sp.user_id = p_user_id
  ), false)
$function$;
CREATE OR REPLACE FUNCTION public.calculate_stylist_salon_match(p_salon_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;
CREATE OR REPLACE FUNCTION public.calculate_stylist_store_match(p_store_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;
CREATE OR REPLACE FUNCTION public.decline_hiring_process(p_process_id uuid, p_public_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_p public.store_hiring_processes;
  v_note text := nullif(trim(coalesce(p_public_note, '')), '');
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.user_roles where user_id = v_uid and role = 'stylist') then
    raise exception 'caller is not a stylist';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'note too long';
  end if;

  select * into v_p from public.store_hiring_processes
  where id = p_process_id and stylist_user_id = v_uid for update;
  if v_p.id is null then raise exception 'hiring process not found'; end if;
  if v_p.status in ('hired', 'declined', 'rejected') then
    raise exception 'hiring process is already closed';
  end if;

  update public.store_hiring_processes
  set status = 'declined', declined_by = 'stylist', closed_at = now(), updated_by_user_id = v_uid
  where id = v_p.id;

  insert into public.store_hiring_process_events (
    hiring_process_id, event_type, from_status, to_status, actor_user_id, actor_kind, public_note
  ) values (v_p.id, 'declined', v_p.status, 'declined', v_uid, 'stylist', v_note);

  return jsonb_build_object('id', v_p.id, 'status', 'declined');
end;
$function$;
CREATE OR REPLACE FUNCTION public.delete_stylist_evidence_document(p_document_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_path text;
begin
  delete from public.stylist_evidence_documents
  where id = p_document_id and stylist_user_id = v_uid
  returning storage_path into v_path;
  if v_path is null then raise exception 'document not found'; end if;
  update public.stylist_match_profiles
  set average_ticket = average_ticket
  where stylist_user_id = v_uid;
  return v_path;
end;
$function$;
CREATE OR REPLACE FUNCTION public.get_my_age_disclosure_requests()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;
CREATE OR REPLACE FUNCTION public.get_my_hiring_processes()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.user_roles where user_id = v_uid and role = 'stylist') then
    raise exception 'caller is not a stylist';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'process_id', h.id,
    'store_id', h.store_id,
    'store_name', s.store_name,
    'prefecture', pr.prefecture,
    'city', pr.city,
    'store_is_public', coalesce(pr.visibility = 'PUBLIC', false),
    'status', h.status,
    'interview_at', h.interview_at,
    'interview_type', h.interview_type,
    'interview_location', h.interview_location,
    'candidate_message', h.candidate_message,
    'declined_by', h.declined_by,
    'hired_at', h.hired_at,
    'closed_at', h.closed_at,
    'created_at', h.created_at,
    'updated_at', h.updated_at,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'event_type', e.event_type,
        'to_status', e.to_status,
        'actor_kind', e.actor_kind,
        'interview_at', e.interview_at,
        'public_note', e.public_note,
        'created_at', e.created_at
      ) order by e.created_at, e.id)
      from public.store_hiring_process_events e
      where e.hiring_process_id = h.id
        and e.event_type <> 'internal_note_updated'
    ), '[]'::jsonb)
  ) order by h.updated_at desc), '[]'::jsonb)
  into v_result
  from public.store_hiring_processes h
  join public.salon_stores s on s.id = h.store_id
  left join public.salon_store_profiles pr on pr.store_id = h.store_id
  where h.stylist_user_id = v_uid;

  return v_result;
end;
$function$;
CREATE OR REPLACE FUNCTION public.mark_scout_read(p_scout_id uuid)
 RETURNS scouts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;
CREATE OR REPLACE FUNCTION public.register_stylist_evidence_document(p_document_type text, p_storage_path text, p_original_file_name text)
 RETURNS stylist_evidence_documents
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'storage', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_row public.stylist_evidence_documents;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.user_roles where user_id = v_uid and role = 'stylist') then
    raise exception 'caller is not a stylist';
  end if;
  if p_document_type not in ('pos_sales','payslip','performance_report','other') then
    raise exception 'invalid document type';
  end if;
  if p_storage_path !~ ('^' || v_uid::text || '/(pos_sales|payslip|performance_report|other)/[0-9a-f-]+\.(jpg|png|pdf)$') then
    raise exception 'invalid storage path';
  end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'stylist-evidence' and name = p_storage_path and owner = v_uid
  ) then raise exception 'evidence object not found'; end if;
  if (select count(*) from public.stylist_evidence_documents where stylist_user_id = v_uid) >= 5 then
    raise exception 'document limit reached';
  end if;
  if not exists (
    select 1 from public.stylist_match_profiles
    where stylist_user_id = v_uid and career_stage = 'results_stylist'
  ) then raise exception 'results profile required'; end if;

  insert into public.stylist_evidence_documents (
    stylist_user_id, document_type, storage_path, original_file_name
  ) values (
    v_uid, p_document_type, p_storage_path, left(trim(p_original_file_name), 180)
  ) returning * into v_row;

  update public.stylist_match_profiles
  set average_ticket = average_ticket
  where stylist_user_id = v_uid;
  return v_row;
end;
$function$;
CREATE OR REPLACE FUNCTION public.respond_age_disclosure_request(p_request_id uuid, p_approve boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;
CREATE OR REPLACE FUNCTION public.respond_salary_offer(p_offer_id uuid, p_response text, p_reason text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS salary_offers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_row public.salary_offers;
  v_stylist_name text;
  v_notif_type text;
  v_title text;
  v_message text;
begin
  if p_response not in ('accepted','revision_requested','declined') then raise exception 'invalid response'; end if;
  if p_response='revision_requested' and (
    p_reason is null
    or p_reason not in ('workdays','guarantee_period','role','performance_basis','other')
  ) then
    raise exception 'reason required';
  end if;
  update public.salary_offers set status=p_response,
    response_reason=case when p_response='revision_requested' then p_reason end,
    response_note=case when p_response='revision_requested' then nullif(left(trim(coalesce(p_note,'')),500),'') end,
    responded_at=now()
  where id=p_offer_id and stylist_user_id=v_uid and status='pending'
  returning * into v_row;
  if v_row.id is null then raise exception 'offer not found'; end if;

  select public_name into v_stylist_name from public.stylist_profiles where user_id = v_uid;
  v_stylist_name := coalesce(v_stylist_name, '美容師') || 'さん';
  v_notif_type := case p_response
    when 'accepted' then 'salary_offer_accepted'
    when 'revision_requested' then 'salary_offer_revision_requested'
    else 'salary_offer_declined'
  end;
  v_title := case p_response
    when 'accepted' then v_stylist_name || 'が給与条件を承諾しました'
    when 'revision_requested' then v_stylist_name || 'から条件相談が届きました'
    else v_stylist_name || 'が給与条件を辞退しました'
  end;
  v_message := case p_response
    when 'accepted' then v_stylist_name || 'が提示した給与条件を承諾しました。'
    when 'revision_requested' then v_stylist_name || 'から条件について相談したいという連絡がありました。'
    else v_stylist_name || 'が今回の給与条件を辞退しました。'
  end;
  perform public.create_notification(v_row.salon_user_id, v_notif_type, v_title, v_message, 'salary_offer', v_row.id);

  return v_row;
end;
$function$;
CREATE OR REPLACE FUNCTION public.respond_scout(p_scout_id uuid, p_response text, p_response_message text DEFAULT NULL::text)
 RETURNS scouts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_message text := nullif(trim(coalesce(p_response_message, '')), '');
  v_row public.scouts;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_response is null or p_response not in ('visit_requested','trial_requested','interested','question','considering','declined') then
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
$function$;
CREATE OR REPLACE FUNCTION public.save_stylist_match_profile(p_primary_goal text, p_secondary_goals text[], p_career_stage text, p_evidence_period_months integer, p_avg_monthly_technical_sales integer, p_avg_monthly_retail_sales integer, p_avg_monthly_clients integer, p_avg_monthly_named_clients integer, p_average_ticket integer, p_repeat_rate integer, p_monthly_working_days integer, p_average_daily_hours numeric, p_self_acquired_clients integer, p_expected_transfer_clients integer, p_assistant_usage text)
 RETURNS stylist_match_profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_allowed_goals constant text[] := array[
    'fair_evaluation','keep_clients','increase_clients','higher_unit_price',
    'income_growth','more_days_off','flexible_hours','education_growth',
    'management_career','independence','personal_brand','better_relationships'
  ];
  v_row public.stylist_match_profiles;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.user_roles where user_id = v_uid and role = 'stylist') then
    raise exception 'caller is not a stylist';
  end if;
  if not (p_primary_goal = any(v_allowed_goals)) then raise exception 'invalid primary goal'; end if;
  if cardinality(coalesce(p_secondary_goals, '{}')) > 2
     or cardinality(coalesce(p_secondary_goals, '{}')) <>
        (select count(distinct g) from unnest(coalesce(p_secondary_goals, '{}')) g)
     or exists (select 1 from unnest(coalesce(p_secondary_goals, '{}')) g where not (g = any(v_allowed_goals)))
     or p_primary_goal = any(coalesce(p_secondary_goals, '{}')) then
    raise exception 'invalid secondary goals';
  end if;
  if p_career_stage not in ('results_stylist','growing_stylist','assistant_newcomer') then
    raise exception 'invalid career stage';
  end if;

  insert into public.stylist_match_profiles (
    stylist_user_id, primary_goal, secondary_goals, career_stage,
    evidence_period_months, avg_monthly_technical_sales, avg_monthly_retail_sales,
    avg_monthly_clients, avg_monthly_named_clients, average_ticket, repeat_rate,
    monthly_working_days, average_daily_hours, self_acquired_clients,
    expected_transfer_clients, assistant_usage
  ) values (
    v_uid, p_primary_goal, coalesce(p_secondary_goals, '{}'), p_career_stage,
    case when p_career_stage = 'results_stylist' then p_evidence_period_months else null end,
    case when p_career_stage = 'results_stylist' then p_avg_monthly_technical_sales else null end,
    case when p_career_stage = 'results_stylist' then p_avg_monthly_retail_sales else null end,
    case when p_career_stage = 'results_stylist' then p_avg_monthly_clients else null end,
    case when p_career_stage = 'results_stylist' then p_avg_monthly_named_clients else null end,
    case when p_career_stage = 'results_stylist' then p_average_ticket else null end,
    case when p_career_stage = 'results_stylist' then p_repeat_rate else null end,
    case when p_career_stage = 'results_stylist' then p_monthly_working_days else null end,
    case when p_career_stage = 'results_stylist' then p_average_daily_hours else null end,
    case when p_career_stage = 'results_stylist' then p_self_acquired_clients else null end,
    case when p_career_stage = 'results_stylist' then p_expected_transfer_clients else null end,
    case when p_career_stage = 'results_stylist' then p_assistant_usage else null end
  )
  on conflict (stylist_user_id) do update set
    primary_goal = excluded.primary_goal,
    secondary_goals = excluded.secondary_goals,
    career_stage = excluded.career_stage,
    evidence_period_months = excluded.evidence_period_months,
    avg_monthly_technical_sales = excluded.avg_monthly_technical_sales,
    avg_monthly_retail_sales = excluded.avg_monthly_retail_sales,
    avg_monthly_clients = excluded.avg_monthly_clients,
    avg_monthly_named_clients = excluded.avg_monthly_named_clients,
    average_ticket = excluded.average_ticket,
    repeat_rate = excluded.repeat_rate,
    monthly_working_days = excluded.monthly_working_days,
    average_daily_hours = excluded.average_daily_hours,
    self_acquired_clients = excluded.self_acquired_clients,
    expected_transfer_clients = excluded.expected_transfer_clients,
    assistant_usage = excluded.assistant_usage
  returning * into v_row;
  return v_row;
end;
$function$;
CREATE OR REPLACE FUNCTION public.save_stylist_match_profile_v2(p_primary_goal text, p_secondary_goals text[], p_career_stage text, p_wants_performance_offer boolean, p_evidence_period_months integer, p_avg_monthly_technical_sales integer, p_avg_monthly_retail_sales integer, p_avg_monthly_clients integer, p_avg_monthly_named_clients integer, p_average_ticket integer, p_repeat_rate integer, p_monthly_working_days integer, p_average_daily_hours numeric, p_self_acquired_clients integer, p_expected_transfer_clients integer, p_assistant_usage text)
 RETURNS stylist_match_profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_enabled boolean := coalesce(p_wants_performance_offer, false) and p_career_stage = 'results_stylist';
  v_allowed_goals constant text[] := array[
    'fair_evaluation','keep_clients','increase_clients','higher_unit_price','income_growth','more_days_off',
    'flexible_hours','education_growth','management_career','independence','personal_brand','better_relationships'
  ];
  v_row public.stylist_match_profiles;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.user_roles where user_id = v_uid and role = 'stylist') then raise exception 'caller is not a stylist'; end if;
  if not (p_primary_goal = any(v_allowed_goals)) then raise exception 'invalid primary goal'; end if;
  if cardinality(coalesce(p_secondary_goals, '{}')) > 2
     or cardinality(coalesce(p_secondary_goals, '{}')) <> (select count(distinct g) from unnest(coalesce(p_secondary_goals, '{}')) g)
     or exists (select 1 from unnest(coalesce(p_secondary_goals, '{}')) g where not (g = any(v_allowed_goals)))
     or p_primary_goal = any(coalesce(p_secondary_goals, '{}')) then raise exception 'invalid secondary goals'; end if;
  if p_career_stage not in ('results_stylist','growing_stylist','assistant_newcomer') then raise exception 'invalid career stage'; end if;

  insert into public.stylist_match_profiles (
    stylist_user_id, primary_goal, secondary_goals, career_stage, wants_performance_offer,
    evidence_period_months, avg_monthly_technical_sales, avg_monthly_retail_sales,
    avg_monthly_clients, avg_monthly_named_clients, average_ticket, repeat_rate,
    monthly_working_days, average_daily_hours, self_acquired_clients, expected_transfer_clients, assistant_usage
  ) values (
    v_uid, p_primary_goal, coalesce(p_secondary_goals, '{}'), p_career_stage, v_enabled,
    case when v_enabled then p_evidence_period_months end,
    case when v_enabled then p_avg_monthly_technical_sales end,
    case when v_enabled then p_avg_monthly_retail_sales end,
    case when v_enabled then p_avg_monthly_clients end,
    case when v_enabled then p_avg_monthly_named_clients end,
    case when v_enabled then p_average_ticket end,
    case when v_enabled then p_repeat_rate end,
    case when v_enabled then p_monthly_working_days end,
    case when v_enabled then p_average_daily_hours end,
    case when v_enabled then p_self_acquired_clients end,
    case when v_enabled then p_expected_transfer_clients end,
    case when v_enabled then p_assistant_usage end
  ) on conflict (stylist_user_id) do update set
    primary_goal=excluded.primary_goal, secondary_goals=excluded.secondary_goals,
    career_stage=excluded.career_stage, wants_performance_offer=excluded.wants_performance_offer,
    evidence_period_months=excluded.evidence_period_months,
    avg_monthly_technical_sales=excluded.avg_monthly_technical_sales,
    avg_monthly_retail_sales=excluded.avg_monthly_retail_sales,
    avg_monthly_clients=excluded.avg_monthly_clients,
    avg_monthly_named_clients=excluded.avg_monthly_named_clients,
    average_ticket=excluded.average_ticket, repeat_rate=excluded.repeat_rate,
    monthly_working_days=excluded.monthly_working_days, average_daily_hours=excluded.average_daily_hours,
    self_acquired_clients=excluded.self_acquired_clients,
    expected_transfer_clients=excluded.expected_transfer_clients, assistant_usage=excluded.assistant_usage
  returning * into v_row;
  return v_row;
end;
$function$;
CREATE OR REPLACE FUNCTION public.save_stylist_preference_profile(p_status stylist_preference_status, p_current_step integer, p_answers jsonb)
 RETURNS stylist_preference_profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_axes jsonb;
  v_row public.stylist_preference_profiles;

  v_a1 numeric; v_a2 numeric; v_a3 numeric; v_a4 numeric;
  v_a5 numeric; v_a6 numeric; v_a7 numeric; v_a8 numeric;

  v_education numeric; v_challenge numeric; v_brand numeric; v_collab numeric;
  v_autonomy numeric; v_flexibility numeric; v_reldist numeric; v_hierarchy numeric;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- ★「1 auth user = 1 role」「user_rolesを正とする」という既存方針（0008
  -- user_roles_single_role.sql・lib/auth/user-roles.tsのhasCompletedRole()と
  -- 同じ判定基準）に合わせ、salon roleのユーザーがこのRPCを直接呼べない
  -- ようにする。stylist roleを持たない場合は例外にする（防御的処理。
  -- 通常はmiddleware/ページ側のrole guardで弾かれるが、RPCはSECURITY
  -- DEFINERであり、middlewareを経由しない直接呼び出しからも保護する）。
  if not exists (
    select 1 from public.user_roles where user_id = v_uid and role = 'stylist'
  ) then
    raise exception 'caller is not a stylist';
  end if;

  v_a1 := nullif((p_answers->>'q1_education_preference'), '')::numeric;
  v_a2 := nullif((p_answers->>'q2_challenge_preference'), '')::numeric;
  v_a3 := nullif((p_answers->>'q3_personal_brand_preference'), '')::numeric;
  v_a4 := nullif((p_answers->>'q4_collaboration_preference'), '')::numeric;
  v_a5 := nullif((p_answers->>'q5_autonomy_preference'), '')::numeric;
  v_a6 := nullif((p_answers->>'q6_work_flexibility_preference'), '')::numeric;
  v_a7 := nullif((p_answers->>'q7_relationship_distance_preference'), '')::numeric;
  v_a8 := nullif((p_answers->>'q8_hierarchy_preference'), '')::numeric;

  -- 1〜5の範囲外の値は不正な入力として扱い、未回答(null)にする（防御的処理）。
  if v_a1 is not null and (v_a1 < 1 or v_a1 > 5) then v_a1 := null; end if;
  if v_a2 is not null and (v_a2 < 1 or v_a2 > 5) then v_a2 := null; end if;
  if v_a3 is not null and (v_a3 < 1 or v_a3 > 5) then v_a3 := null; end if;
  if v_a4 is not null and (v_a4 < 1 or v_a4 > 5) then v_a4 := null; end if;
  if v_a5 is not null and (v_a5 < 1 or v_a5 > 5) then v_a5 := null; end if;
  if v_a6 is not null and (v_a6 < 1 or v_a6 > 5) then v_a6 := null; end if;
  if v_a7 is not null and (v_a7 < 1 or v_a7 > 5) then v_a7 := null; end if;
  if v_a8 is not null and (v_a8 < 1 or v_a8 > 5) then v_a8 := null; end if;

  -- 1→0, 2→25, 3→50, 4→75, 5→100
  v_education   := case when v_a1 is null then null else (v_a1 - 1) * 25 end;
  v_challenge   := case when v_a2 is null then null else (v_a2 - 1) * 25 end;
  v_brand       := case when v_a3 is null then null else (v_a3 - 1) * 25 end;
  v_collab      := case when v_a4 is null then null else (v_a4 - 1) * 25 end;
  v_autonomy    := case when v_a5 is null then null else (v_a5 - 1) * 25 end;
  v_flexibility := case when v_a6 is null then null else (v_a6 - 1) * 25 end;
  v_reldist     := case when v_a7 is null then null else (v_a7 - 1) * 25 end;
  v_hierarchy   := case when v_a8 is null then null else (v_a8 - 1) * 25 end;

  -- 未回答の軸はキー自体を含めない（jsonb_strip_nulls、salon_culture_profilesと同じ方針）。
  v_axes := jsonb_strip_nulls(jsonb_build_object(
    'education_preference', v_education,
    'challenge_preference', v_challenge,
    'personal_brand_preference', v_brand,
    'collaboration_preference', v_collab,
    'autonomy_preference', v_autonomy,
    'work_flexibility_preference', v_flexibility,
    'relationship_distance_preference', v_reldist,
    'hierarchy_preference', v_hierarchy
  ));

  insert into public.stylist_preference_profiles (
    stylist_user_id, status, current_step, answers, preference_axes
  ) values (
    v_uid, p_status, p_current_step, coalesce(p_answers, '{}'::jsonb), v_axes
  )
  on conflict (stylist_user_id) do update set
    status           = excluded.status,
    current_step     = excluded.current_step,
    answers          = excluded.answers,
    preference_axes  = excluded.preference_axes
  returning * into v_row;

  return v_row;
end;
$function$;
CREATE OR REPLACE FUNCTION public.save_stylist_profile_v4(p_public_name text, p_full_name text, p_age_band age_band, p_gender gender_type, p_prefecture text, p_desired_work_location text, p_experience_years integer, p_current_position text, p_specialties text[], p_employment_type employment_type, p_job_change_intent job_change_intent, p_desired_salary_range salary_band, p_sns_links jsonb, p_bio text, p_visibility profile_visibility, p_scout_enabled boolean, p_avatar_path text, p_value_priorities text[], p_birth_date date, p_age_display_mode text, p_career_phase text, p_graduation_ym date, p_blank_period_value integer, p_blank_period_unit text)
 RETURNS profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'storage', 'pg_temp'
AS $function$
declare
  v_uid   uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  v_m0    date := date_trunc('month', v_today)::date;
  v_grad  date := case when p_graduation_ym is null then null else date_trunc('month', p_graduation_ym)::date end;
  v_max   integer;
  v_profile public.profiles;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  -- 立場と入力の検証（何かを保存する前）
  if p_career_phase is null or p_career_phase not in ('new_graduate','experienced','blank') then
    raise exception 'career_phase_required' using errcode = '23514', hint = '立場は「新卒」「現役の美容師」「ブランクあり」から選んでください';
  end if;
  if p_career_phase = 'new_graduate' then
    if p_blank_period_value is not null or p_blank_period_unit is not null then raise exception 'blank period must be empty for this phase'; end if;
    if v_grad is null then raise exception 'graduation month required'; end if;
    if extract(month from v_grad) not in (3, 10) then raise exception 'graduation_month_invalid' using errcode = '23514', hint = '卒業（予定）の月は3月か10月から選んでください'; end if;
    if v_grad < (v_m0 - interval '3 years') or v_grad > (v_m0 + interval '5 years') then raise exception 'graduation month out of range'; end if;
  elsif p_career_phase = 'experienced' then
    if v_grad is not null or p_blank_period_value is not null or p_blank_period_unit is not null then raise exception 'graduation and blank period must be empty for this phase'; end if;
  else
    if v_grad is not null then raise exception 'graduation must be empty for this phase'; end if;
    if (p_blank_period_value is null) <> (p_blank_period_unit is null) then raise exception 'blank period value and unit must be set together'; end if;
    if p_blank_period_value is not null then
      if p_blank_period_unit not in ('months','years') then raise exception 'invalid blank period unit'; end if;
      v_max := (case when p_blank_period_unit = 'months' then 720 else 60 end);
      if p_blank_period_value < 1 or p_blank_period_value > v_max then raise exception 'blank period out of range'; end if;
    end if;
  end if;

  v_profile := public.save_stylist_profile_v2(
    p_public_name, p_full_name, p_age_band, p_gender, p_prefecture, p_desired_work_location, p_experience_years, p_current_position,
    p_specialties, p_employment_type, p_job_change_intent, p_desired_salary_range, p_sns_links, p_bio, p_visibility, p_scout_enabled,
    p_avatar_path, p_value_priorities, p_birth_date, p_age_display_mode);

  -- 旧3項目（卒業の区分・就業開始・免許）は読まない・書かない（保存済みの値はそのまま残る）
  update public.stylist_profiles
     set career_phase = p_career_phase,
         graduation_ym = case when p_career_phase = 'new_graduate' then v_grad end,
         blank_period_value = case when p_career_phase = 'blank' then p_blank_period_value end,
         blank_period_unit = case when p_career_phase = 'blank' then p_blank_period_unit end
   where user_id = v_uid;
  if not found then raise exception 'stylist profile not found'; end if;
  return v_profile;
end;
$function$;
CREATE OR REPLACE FUNCTION public.set_favorite_salon(p_salon_user_id uuid, p_favorite boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_stylist_uid uuid := auth.uid();
begin
  if v_stylist_uid is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1 from public.user_roles
    where user_id = v_stylist_uid and role = 'stylist'
  ) then
    raise exception 'caller is not a stylist';
  end if;

  if not exists (
    select 1
    from public.user_roles ur
    join public.salon_profiles sp on sp.user_id = ur.user_id
    where ur.user_id = p_salon_user_id
      and ur.role = 'salon'
      and sp.visibility = 'PUBLIC'
  ) then
    raise exception 'target salon is not public';
  end if;

  if p_favorite then
    insert into public.stylist_favorite_salons (stylist_user_id, salon_user_id)
    values (v_stylist_uid, p_salon_user_id)
    on conflict (stylist_user_id, salon_user_id) do nothing;
  else
    delete from public.stylist_favorite_salons
    where stylist_user_id = v_stylist_uid
      and salon_user_id = p_salon_user_id;
  end if;

  return p_favorite;
end;
$function$;
CREATE OR REPLACE FUNCTION public.set_store_interest_v2(p_store_id uuid, p_kind text, p_interested boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.user_roles where user_id = v_uid and role = 'stylist') then raise exception 'caller is not a stylist'; end if;
  if p_kind is null or p_kind not in ('visit', 'trial') then raise exception 'invalid interest kind'; end if;
  if p_interested is null then raise exception 'interested required'; end if;
  if p_interested then
    if not exists (select 1 from public.salon_store_profiles where store_id = p_store_id and visibility = 'PUBLIC') then raise exception 'target store is not public'; end if;
    if not exists (select 1 from public.stylist_salon_interests where stylist_user_id = v_uid and store_id = p_store_id and kind = p_kind) then
      perform public.assert_store_recruiting_allowed(p_store_id);
    end if;
    insert into public.stylist_salon_interests (stylist_user_id, store_id, kind) values (v_uid, p_store_id, p_kind)
      on conflict (stylist_user_id, store_id, kind) where store_id is not null do nothing returning id into v_id;
    -- 店舗の担当者への通知（と、そのメール送信待ち）は、トリガーが行う。
  else
    -- 種別と店舗で対象を特定して取り消す（もう一方の種別は残す）。取消は店舗の公開・停止状態にかかわらず可能。運営の受付・履歴は消えない（0087）。
    delete from public.stylist_salon_interests where stylist_user_id = v_uid and store_id = p_store_id and kind = p_kind returning id into v_id;
    if v_id is not null then
      perform public._cancel_interest_notifications(v_id, p_store_id, v_uid, p_kind);
    end if;
  end if;
  return p_interested;
end;
$function$;
CREATE OR REPLACE FUNCTION public.set_stylist_age_display_mode(p_mode text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;
CREATE OR REPLACE FUNCTION public.set_stylist_birth_date(p_birth_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;
CREATE OR REPLACE FUNCTION public.set_stylist_value_priorities(p_value_priorities text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid     uuid := auth.uid();
  v_allowed text[] := array[
    'work_life_balance','skill_growth','teamwork','independence','income_stability','customer_relationship',
    'education_support','brand_customer_base','work_flexibility','evaluation_fairness','location_convenience','culture_fit'];
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_value_priorities is null or array_ndims(p_value_priorities) is distinct from 1 or cardinality(p_value_priorities) <> 3 then
    raise exception 'invalid_value_priorities: exactly 3 items required' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_value_priorities) c where c is null) then
    raise exception 'invalid_value_priorities: null item' using errcode = '22023';
  end if;
  if (select count(distinct c) from unnest(p_value_priorities) c) <> 3 then
    raise exception 'invalid_value_priorities: duplicate items' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_value_priorities) c where c <> all (v_allowed)) then
    raise exception 'invalid_value_priorities: item not allowed' using errcode = '22023';
  end if;
  -- この1列だけを、本人の行にだけ書く。他の列は SET に含めない。
  update public.stylist_profiles set value_priorities = p_value_priorities where user_id = v_uid;
  if not found then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;
end;
$function$;
drop trigger trg_ops_staff_no_user_roles on public.user_roles;
drop trigger trg_ops_staff_no_stylist_profiles on public.stylist_profiles;
drop trigger trg_ops_staff_no_stylist_private on public.stylist_private;
drop function public._ops_staff_no_role_rows(), public._ops_staff_account(uuid);

do $guard$
declare v_cur jsonb; v_exp jsonb := '{"authcol:sessions.aal": "85abaead201b7fc99b48cdb913ac8432", "authcol:sessions.created_at": "78a4814f9534f1fcc5c04078c5611170", "authcol:sessions.factor_id": "ef7c876f00f3acddd00fa671f52d0b1f", "authcol:sessions.id": "ef7c876f00f3acddd00fa671f52d0b1f", "authcol:sessions.ip": "8a04744caa2093ec5bfa9c2084166336", "authcol:sessions.not_after": "78a4814f9534f1fcc5c04078c5611170", "authcol:sessions.oauth_client_id": "ef7c876f00f3acddd00fa671f52d0b1f", "authcol:sessions.refresh_token_counter": "428fda282c5955ae90508b5edf6812cf", "authcol:sessions.refresh_token_hmac_key": "1cb251ec0d568de6a929b520c4aed8d1", "authcol:sessions.refreshed_at": "81ffa33bf51e38bb80e14641b2745988", "authcol:sessions.scopes": "1cb251ec0d568de6a929b520c4aed8d1", "authcol:sessions.tag": "1cb251ec0d568de6a929b520c4aed8d1", "authcol:sessions.updated_at": "78a4814f9534f1fcc5c04078c5611170", "authcol:sessions.user_agent": "1cb251ec0d568de6a929b520c4aed8d1", "authcol:sessions.user_id": "ef7c876f00f3acddd00fa671f52d0b1f", "authcol:users.created_at": "78a4814f9534f1fcc5c04078c5611170", "authcol:users.email": "a20daa930d502ea043e41d242e6be226", "authcol:users.email_confirmed_at": "78a4814f9534f1fcc5c04078c5611170", "authcol:users.id": "ef7c876f00f3acddd00fa671f52d0b1f", "authcol:users.last_sign_in_at": "78a4814f9534f1fcc5c04078c5611170", "authcol:users.raw_user_meta_data": "cd8a1292080b231b3e9a85d440b02023", "authfn:jwt": "0d29593f5ddb1c1ef765cb9e1e55ca50", "authfn:role": "2e7ce5d2fc1dfc8799711e493191b018", "authfn:uid": "58627ab0dc7622a31c473a39e78ac4aa", "authtrg:on_auth_user_created": "ad50206fdcc3118d46c1098042f6791e", "deprel:account_invitation_events": "a45e7de5b01068a0489169b7080d8195", "deprel:account_invitations": "2c8766654a740ada050875e4b7d54bda", "deprel:account_recovery_requests": "3c0835c89b6708f5e0c2ca5112583662", "deprel:admin_audit_events": "c39ec7c8bc9b5a3a5788a6e4d14a1e20", "deprel:admin_invoice_checkouts": "a7da5ba852e09c95396202a27139ce34", "deprel:admin_invoice_lines": "11a2cf5a90b3b0490be6c05722c629ed", "deprel:admin_invoice_webhook_events": "b94ff03459db2a9e93a7ad430e4bc186", "deprel:admin_invoices": "4040758b34b82b0fe772935a5e63c9f7", "deprel:admin_message_deliveries": "8d997e98e7d913f69ac16120f44ae376", "deprel:admin_messages": "ddf0638465f8f886e45435db70c31af4", "deprel:admin_quotes": "50ede29ec3e9a050ff649ce576818bac", "deprel:admin_staff": "61aeae355319b94d91adabce30d68033", "deprel:admin_staff_events": "f9b74f137c98d065f1f582dca3142c4a", "deprel:admin_staff_invitations": "b23a4ad71092467ce0652285af7e48d4", "deprel:admin_threads": "641fef2578fbae21d50c10921bc752e3", "deprel:admin_unresolved_billing_cases": "09771cee3b9e2442f8bdcf24f0aaee2d", "deprel:admin_visit_cases": "dafa2816aefbdacf7e6a03f6ab72a974", "deprel:admin_visit_confirmations": "78861422d157f44429741af3c6b5d1c5", "deprel:admin_visit_occurrences": "0c79b58fbd6b070420296f8664d51336", "deprel:admin_visit_request_events": "6ee3ce544f321d87611cf31cac3a0439", "deprel:admin_visit_requests": "c2dbc019d5c5220dba03ef1e605b49fa", "deprel:admin_work_attributions": "c6a2e8da272dcb0800cf33cb5dc51961", "deprel:admin_work_notes": "d459e48e5486f2aceb1262ff88ba9671", "deprel:admin_work_operation_catalog": "3ff3b1cac1c641eb6cf03291ef647a66", "deprel:admin_work_records": "e0144cc8309faaf81a64f8be92c271e7", "deprel:age_disclosure_requests": "4442abe63f2b28dcd40b3c181b98731a", "deprel:billing_issuer_settings": "aa3c51ae88deeca93493cf9088aeccdd", "deprel:billing_issuer_settings_events": "a5c17b5ba634e212a972a37d559bb3d1", "deprel:diagnosis_ai_outputs": "b7fd2b8601f28985ada4d66af2dcfbe9", "deprel:diagnosis_change_limits": "1b143a089a3be626c77c37e64faa5352", "deprel:diagnosis_results": "2f5b15a5fa689d02e4e44badc5a6b017", "deprel:diagnosis_save_requests": "2cba77f1ae529aa236f240a0f047b9e1", "deprel:employee_size_master": "316b3cd91e06190523f524c0924c13b9", "deprel:feature_pauses": "deb1c17796711b045cbbb7c01a76ba92", "deprel:hiring_process_billing_basis": "abeb71bd3d4d7c32e3d1581572a916d3", "deprel:hiring_success_fee_events": "a9434c63e6c9970441a558098c002908", "deprel:hiring_success_fees": "005414387f5612fef6e22a7938c36fe3", "deprel:invoice_document_events": "62169a4830d003278f2b747e7a190135", "deprel:invoice_documents": "b877b1bc310394e79844d878af66d6f2", "deprel:invoice_number_counters": "5b7579a68a7714ad46f5668124e05bd6", "deprel:legal_documents": "4258db53dc567d89e606fea139133e8a", "deprel:notification_email_config": "aef329c586275fabaad40504db544528", "deprel:notification_email_outbox": "07321470468b8b536f68f415ac81be18", "deprel:notification_email_outbox_events": "4397a687caaf4acc7b0673c9da435e57", "deprel:notification_email_preferences": "07659d6601d4f4250dd27c90756b6ec3", "deprel:notifications": "40cd194be3c9ee7c238c85799051eaba", "deprel:organization_billing_profile_events": "cef5122e5fa4aad4fea0fb4770bf6c91", "deprel:organization_billing_profiles": "4370e118badfde7727fd6f0ae0e7a332", "deprel:organization_billing_regime": "cc73971ba5936767e659a1aadd522385", "deprel:organization_contract_events": "833d01c75852523b83feff7062b3c1d3", "deprel:organization_contract_settings": "a805447edaf93f700f21f992aaa8c116", "deprel:organization_location_events": "dcaedd3dd9b925ded958561b3ecb8c0b", "deprel:organization_members": "f4ac63a805b2f84cbeb9da23a7877bb9", "deprel:organization_payment_accounts": "563207b9ba5145600b2a3f15a18bc2be", "deprel:organization_scout_quotas": "223acf334e004171b1a7d52f3c2a93fc", "deprel:organization_subscriptions": "ccf60844bf3d262880daccf36bd0f88f", "deprel:pending_diagnoses": "92d19ec43029721fa38006b9372aa81c", "deprel:platform_admins": "6f50dd58e387003d7474ebbea5215ee0", "deprel:profiles": "3a706c60a4f8fe06aa423eca00eac873", "deprel:rate_limit_counters": "189478b5cf168f74faef62281130c1da", "deprel:rate_limit_reservations": "2cd14dfbbd7b9b6f9feb34f29d3ee556", "deprel:salary_offers": "83033e3eaaa5b574a2f5c6694d5999e7", "deprel:salon_culture_ai_outputs": "3b9fbb61c49e0c7f42d23cf31f029147", "deprel:salon_culture_analysis_answers": "c09908521b66625d2cf3d584e525fe4f", "deprel:salon_culture_drafts": "b16b3799e802b2ef9373283d3d9218b9", "deprel:salon_culture_profiles": "95df4f043eef5b7ba4ba4d4bf570b183", "deprel:salon_inquiries": "387ce83e9452ced91c6c42eaecd4b31d", "deprel:salon_links": "9e6ca6629ee5d98c281c4674875247b1", "deprel:salon_onboarding_assignments": "5bd81eb49d756438c62cd3de041a63ef", "deprel:salon_organizations": "f7b4fcd6393d980fd13e0b3ee0cd91d0", "deprel:salon_photos": "a6a625e3659828bc393302069e29e6b0", "deprel:salon_profile_text_baseline_0088": "a4977f6aad18431a9648f3fd85f97fcf", "deprel:salon_profiles": "fee6b51cf6a1b8c357a4276d1afdca5f", "deprel:salon_scout_quotas": "dbd26f6d2cb2a76b874e1793b8f94cc8", "deprel:salon_store_culture_profiles": "8d75b7bd5c661781d9301b5f128ea4cb", "deprel:salon_store_links": "27534882df870791b724562d09b3eaeb", "deprel:salon_store_logos": "9a73c12613038d609975a6f24121fc2b", "deprel:salon_store_photos": "f0f840d4123dfed63ab7e47c1d689506", "deprel:salon_store_profile_backfill_0057": "8174308fe0b27cfcc4f5e07a0e36d246", "deprel:salon_store_profile_text_history": "dffc318c261d6e50ae47afe2d147b27e", "deprel:salon_store_profiles": "b8a48f5530e6873fe1c4596ef70b9fa4", "deprel:salon_stores": "19d3e76cca9047f9202f385fbf2b6539", "deprel:scout_credit_packages": "563df6fd7ccd60c4ff1bd32729d660c0", "deprel:scout_credit_purchases": "c56125c4a6478cfa04b4b4cf8e0d2374", "deprel:scout_optout_migration_0070": "cc036222bbf59687b79020fca4f523a0", "deprel:scouts": "5f9b8d0cbad8371b0d34040cf160194a", "deprel:store_hiring_process_events": "93eac6b00e2b0e77ea54792a5af5c525", "deprel:store_hiring_processes": "752dc73c404649ecc0f2d8cbfbd99539", "deprel:store_members": "b9d86e3ee727ae655cb76e3fc2d2060d", "deprel:stripe_checkout_records": "8ef707cfabeebcf0c5066df35df38020", "deprel:stripe_integrity_issues": "966bd59b37048970a30e4b3d2ae59a77", "deprel:stripe_webhook_events": "f30ef1af429529b4e0ea27ae11cb622f", "deprel:student_diagnosis_results": "358fd2ab00d59a769ad091c23419570a", "deprel:stylist_core_type_assignments": "07fc745bcd29738961f10681b788b65f", "deprel:stylist_core_type_history": "a2ee54774662b25a66c31879424808b0", "deprel:stylist_diagnosis_current": "2122965ed2ee962f7ba4055840f07d00", "deprel:stylist_evidence_documents": "e0dccdd78b795e14a8e1067948393b33", "deprel:stylist_favorite_salons": "9a5d9574ce63c7bf40de19025418c29d", "deprel:stylist_match_profiles": "9d03d98276d49daaa270a1199433ccac", "deprel:stylist_match_verification_snapshots": "504f28eec22493886401b6a6d92da66a", "deprel:stylist_preference_profiles": "0f1fdd596c7e0becdc219482f938a4d4", "deprel:stylist_private": "1a2ba6bc5ff6fc17cf08ce58da83d046", "deprel:stylist_profiles": "bc59aab5a142db28572b32787c58347b", "deprel:stylist_salon_interests": "d2387781135c0bf75d42a4e2ade605da", "deprel:subscription_invoice_document_events": "12071cd43f545782a1a4b28cd6e2503f", "deprel:subscription_invoice_documents": "bfa733bffd516cbd1ed2be06e93ebd61", "deprel:subscription_invoice_payments": "09ae5f4e3317209d7356dc202bf483c3", "deprel:success_fee_payments": "acb96b12f5cee56728603c7fd047d62a", "deprel:user_legal_acceptances": "ec9d0384b31ff36a1026caab5fd6758c", "deprel:user_roles": "01d8fd0aaa9ac87da79ebe94b4614d9d", "deprel:user_settings": "93ed8219f0c8c37ddae024ec89809560", "fn:_admin_assert_invoice_correctable(uuid)": "f87a7df722237671749db9dee59c5637", "fn:_admin_axis_problems(jsonb,text[])": "abb2dd939127c820699335aca98fc18a", "fn:_admin_inbox_can_see(uuid,uuid)": "78b11ad581116398ad58c8d84f4fd7b8", "fn:_admin_invoice_line_rules()": "83dd9ae300915cd301d281e115fb793c", "fn:_admin_invoice_payable_by(uuid,uuid)": "c0b7ed450b74003ed2dcea190f056e5f", "fn:_admin_invoice_requires_amounts()": "3535d0ba410186474c3c8b93a7656cca", "fn:_admin_is_stylist_account(uuid)": "506eaf0f856ca424e0b04a54fe3a32fb", "fn:_admin_known_prefectures()": "cd6f7c0855c1aefb718758dd64dc41f3", "fn:_admin_lock_request(uuid,uuid)": "7e518ea018fb3b48866d90835df5bcb0", "fn:_admin_lock_sender(uuid)": "4dbf696ebf5ab10053f7c4ff7b749d61", "fn:_admin_messages_rules()": "b1677bc07423de967a49be5457b8b23a", "fn:_admin_org_billing_actor(uuid,uuid)": "02874e55b10f48b1ee23503012b6c1b4", "fn:_admin_quotes_rules()": "31136bfea18318f19427790402cf7354", "fn:_admin_record_work(text,text,uuid,text,timestamp with time zone,jsonb)": "894f961593df65569d6f59b7942a1c0e", "fn:_admin_request_hash(text,text[])": "028bdd7636b7722b1952dab164362561", "fn:_admin_salon_access(uuid,uuid,uuid)": "b5b7453d091a1b4bb0f0eb41e74e8e9a", "fn:_admin_store_culture_state(boolean,text,jsonb)": "8fbf93c3c5975cf80c28ada332e731c6", "fn:_admin_tax(integer)": "715d0acf595936a21c10b96e24604975", "fn:_admin_thread_visible_to(uuid,uuid)": "5dab89d084aafb9cadb84c0900f5634a", "fn:_admin_threads_consistency()": "a4bcf377b34dd45a3f16847606667dc0", "fn:_admin_user_is_operator(uuid)": "727706a1de97f6cf3843a8e958367281", "fn:_admin_visit_case_fee_guard()": "44a4214504088f4bbd4dc25617a5ae18", "fn:_admin_visit_event_op(text,jsonb,jsonb)": "868be06f9f7466568ecf07dfe7df39a2", "fn:_admin_visit_event_to_work()": "f3916a842d39474dfba876cf87196a9c", "fn:_admin_visit_occurrence_guard()": "e66797319ba6c2ce90141b4660e755be", "fn:_admin_visit_transition_ok(text,text)": "75b6fb75bc31b7cc2c495319e06b6cc7", "fn:_billing_append_only()": "982b61b251f3a538fe6a4988c1a6ccea", "fn:_billing_regime_active(uuid,timestamp with time zone)": "3bc5bd0ff2528c3ec39a532609fb224f", "fn:_cancel_interest_notifications(uuid,uuid,uuid,text)": "3e3cd54ce701d9087d02c69427ad61a0", "fn:_diag_gate_close()": "a8523a5e54bdbc51159f635b1896e9c3", "fn:_diag_gate_open(text)": "8558e43f7ff82197a97e032e3d6ff3ee", "fn:_diag_owner_lock(text,uuid,uuid)": "a1aef4b469fec6e43856c75c73d13c5e", "fn:_diagnosis_limit_gate(text,uuid,uuid,uuid,boolean,boolean,boolean,text)": "86f8c3b5f4642b72d2a834b82e92f0e6", "fn:_email_admin_valid(uuid)": "d5539b5dd794683a02c25bbedbf38f1a", "fn:_email_cancel_for_notification(uuid)": "3a230a7bd390c1200debeb31932fb949", "fn:_email_link_path(text,text)": "3e13003a8674fa22b88468a6c57c3d90", "fn:_email_notification_store(uuid)": "7acc9838aa3be3e5e91fd3181072b8ca", "fn:_email_recipient_entitled(uuid)": "21036faba762dc087224a7f8ccff8150", "fn:_email_template_key(text,text,uuid)": "a908cad044b164a4210927f8a30c9334", "fn:_enqueue_notification_email()": "90fdceac53ee577fa58b8fbc0375e1df", "fn:_hiring_has_active_hire_line(uuid)": "1ce8f5c2844d5fcc98cf7381877c9f86", "fn:_hiring_lock(uuid)": "a04858c069ddce2c938590de74761003", "fn:_hiring_process_basis(uuid)": "b79f41186a89e8eafb64ee45fe1e1ae2", "fn:_notify_on_admin_message()": "deb5263e5f59fd482f3beb3273b4925d", "fn:_salon_analysis_base_snapshot(jsonb,text)": "e1b6bccf147e7a566b79b7c2f54c9d0e", "fn:_salon_analysis_normalize_answers(text,jsonb)": "ea0dc30441b00f8c2371f669d558898f", "fn:_salon_store_profile_bump_revision()": "f63f62ac749938719365f57adde1006a", "fn:_salon_store_profile_history()": "95392ee3bf52454ef00995efe0007fee", "fn:_staff_auth_user_unused(uuid,uuid)": "06b16f30bfe05414cfaea0139d180337", "fn:_staff_session_ok(timestamp with time zone)": "d43b8fa537c10c060377ca4dd6e5a9cc", "fn:_store_asset_folder_store_id(text)": "9160084af58a23a4375b84bed4215a51", "fn:_store_asset_name_ok(text)": "bc9cb7b767282e9c0e41a69375a9525b", "fn:_store_asset_readable_by_stylist(text)": "22b1b84adfaa52775852418b12307e02", "fn:_store_assets_json(uuid)": "07f69567b6ec5cdff0a26e625a97a428", "fn:_stylist_age_info(uuid,uuid)": "f8ea97a8304ee59807e54108722e473b", "fn:_trg_blank_period_follow_phase()": "26ea7387f9b363415535e1d13b52250d", "fn:_trg_career_phase_required_on_insert()": "683c4995025aeec56733e8bfcadd5b30", "fn:_trg_career_phase_valid()": "ff11fc31116fa24d9c34a1f2be942a71", "fn:_trg_checkout_basis()": "b423d87242066468fa08bddb27346cf4", "fn:_trg_diagnosis_results_limit()": "0ba6ab433d2688f3d7802cc2ba101945", "fn:_trg_fee_insert_basis()": "04768947f87ceef2d7929aeefb4fd45b", "fn:_trg_fee_update_basis()": "8b7ec94540e3b1b0e06c6e4d837f929b", "fn:_trg_graduation_month_valid()": "830074be298f6f7ea6690ea2e744cb2b", "fn:_trg_hire_line_regime_guard()": "1c0bb0b812fcd33ba7f86535012a4f04", "fn:_trg_salon_culture_analysis_limit()": "0f3d45e2e0fd456b6714fea3f7edfb62", "fn:_trg_salon_culture_profiles_limit()": "69b70921bbaf23066c09cee72fa52228", "fn:_trg_salon_store_culture_profiles_limit()": "df63923a318b1b7cf49699e62ab3917c", "fn:_trg_scouts_publishable_guard()": "01d746ea0430bc5ef11f7f050b9b3c30", "fn:_trg_set_current_diagnosis()": "d65a74edcf253667d799150bca4b8a62", "fn:_trg_student_diagnosis_limit()": "21feb5c384de987e210b6b3a607aa892", "fn:_trg_stylist_private_birth_guard()": "66f40b9b7df788c23fd0dfa60b7aeabe", "fn:_trg_stylist_profiles_birth_required()": "ea911f4cc4128140b1e65927adf0e285", "fn:_validate_store_asset_path(uuid,text,text)": "8aadb782361a21fb81ea2511d866e9d8", "fn:accept_legal_documents(jsonb)": "b0d4f66d855bcbc1f64286481b727886", "fn:activate_ai_output(uuid)": "f66134e3eb50a52997c6fe74b66c3a34", "fn:activate_salon_culture_ai_output(uuid)": "378cf24cff850b11d1f20ede74eb98c4", "fn:add_hiring_candidate(uuid,uuid,text)": "6de89145c84778447937b6f3ddeb7713", "fn:add_salon_photo(text,text,integer)": "000959028ffefae45816deb4085884cf", "fn:add_store_link(uuid,text,text,text)": "36602896953c286f7212cd17169a60d6", "fn:add_store_photo(uuid,text,text,integer)": "da7c544a330721c14c6bcb35f6b6ba77", "fn:admin_add_fee_line(uuid,text,uuid)": "18e39779065c5c188c4d91ec297b33b2", "fn:admin_add_registration_line(uuid)": "3ebeabeb6a4b4eaef4b00f41d6bd73b8", "fn:admin_advance_invoice(uuid,text)": "9864302ff183130f9dfbf2b1ffe9acaa", "fn:admin_assign_visit_request(uuid,uuid,timestamp with time zone)": "f8e96bb867d04de466ec08a3c65b04d4", "fn:admin_billing_regime_status(uuid)": "95efcf7fdf8db58eca11c5cabbd22bc3", "fn:admin_billing_summary(uuid)": "0e7933d286304855268354eccd747887", "fn:admin_claim_visit_request(text,uuid)": "7c96f496bab9688c379d36cf7a2953d2", "fn:admin_correct_hire_line(uuid,text)": "5890bc590cf6cdb01ec1a5cf55cf5763", "fn:admin_create_invoice(uuid,uuid)": "dfb51415849c31a96fd748364509c2bd", "fn:admin_create_thread(uuid,text,uuid,uuid,uuid,uuid,text,text)": "8e409344ed92d73f7618194e87240c3d", "fn:admin_create_visit_thread(uuid,uuid,text,text,text)": "cd694387b339c7b23d3acd925d26e3e0", "fn:admin_email_outbox_action(uuid,text,text,text,text)": "3659c628227c8a62a4668eafd7938481", "fn:admin_email_outbox_find(text)": "996771f467e57f1ddfe966c34dffe1e8", "fn:admin_email_outbox_overview(integer)": "3abade161137233cb8f6ae14d4683cbc", "fn:admin_flag_billing_case(uuid,text,text)": "40508021c1e7a40cca5c9f8e219fd85d", "fn:admin_get_invoice(uuid)": "35ea9068462e2d44fe5deeedaa320d6d", "fn:admin_get_organization(uuid)": "d2f16968e41a6a12432559660fa7ccae", "fn:admin_get_organization_location(uuid)": "6781be8a73beaf6cb921d844ce0edac6", "fn:admin_get_stylist(uuid)": "a423c6cd344c0dc692cbaf4f821594bd", "fn:admin_get_thread(uuid)": "6b1a2cf1d8382f8041cbc962f860ad57", "fn:admin_get_visit_request(uuid)": "c50b9e89afc2e7d96633f04b87cd65fe", "fn:admin_list_billable_cases(uuid,integer,integer)": "7403a112b3b513fb54533f2935f22012", "fn:admin_list_hiring_processes(text,text,timestamp with time zone,timestamp with time zone,uuid,uuid,integer,integer)": "8f6b34d4a679501814cfa9a041945057", "fn:admin_list_invoices(uuid,text,integer,integer)": "4baa78cd500b1dfb2b194cb3b855d492", "fn:admin_list_organizations(text,text[],boolean,text,text,integer,integer)": "4caf069dd43c2ad3dbb944df9f1ad75a", "fn:admin_list_quotes(uuid,integer,integer)": "a0f2678e06fa5ab8f8e898261cb51e7a", "fn:admin_list_salon_registrants_without_company(integer,integer)": "553a8b70ec906a054a7b232650330a1d", "fn:admin_list_store_culture_readiness(text,text,uuid,integer,integer)": "7a15482b37568a35de5671a02affe274", "fn:admin_list_store_interests(text,timestamp with time zone,timestamp with time zone,uuid,uuid,integer,integer)": "a8849f1f494ca313e8f5fd38e90d7459", "fn:admin_list_stylists(text,text[],boolean,text[],text,text,integer,integer)": "2c9da980d9ea9ec2ca038f3215b3e48e", "fn:admin_list_threads(uuid,uuid,uuid,text,integer,integer)": "bf7f99043fc3f0088bb1ec20af093e13", "fn:admin_list_unresolved_billing_cases(uuid,boolean,integer,integer)": "37e5ac671204e9e3ab92719e73762914", "fn:admin_list_visit_requests(text,text,text,uuid,boolean,integer,integer)": "c605b07548f8d366490b7220d9474314", "fn:admin_my_operator_state()": "d51a09ff2f3da5d117a4ea503525a54b", "fn:admin_operator_directory()": "d33771ee6732c6f2d7739c2c5b99830c", "fn:admin_operator_role()": "36ceb5a9c8f964de76f506a5ee6e442b", "fn:admin_post_message(uuid,uuid,text,text)": "af5a271ba96bde690f608d0f32be9f07", "fn:admin_propose_quote(uuid,integer,text)": "339822bcb5eece9732890f58a82b18fa", "fn:admin_publish_legal_document(text,text,text,text,timestamp with time zone)": "64cdc38139e15d9885148597dbe04200", "fn:admin_recalculate_registration_line(uuid)": "b75d40bef8aba2507c09436d68f9d57a", "fn:admin_record_delivery(uuid,text,text)": "78aa8ba9a0991944b246e79c5cd21ba8", "fn:admin_record_visit_confirmation(uuid,text,text,text,text,timestamp with time zone)": "5cab8c4151898dd4bc582e764604a35a", "fn:admin_resolve_stripe_integrity_issue(uuid,text)": "0491728b022774c378a23a5808c3f663", "fn:admin_set_billing_regime(uuid,timestamp with time zone)": "0b7ed56305298094b7ff8f541f68ecb2", "fn:admin_set_email_notifications_enabled(boolean)": "b3038b24e2798205e4be4ff8ffef9ad3", "fn:admin_set_organization_location(uuid,text,text,text)": "98fbb3deb56a4f6dbf3717028fe0efb2", "fn:admin_set_process_billing_basis(uuid,text,text)": "3f468e95a9d55b90b0691de1f8ac35a6", "fn:admin_set_thread_status(uuid,text)": "b41abf1a6643c3e46ac07b1f8a56ac24", "fn:admin_staff_accept()": "c457fa9d8eb4d061e5f74d3afa16579f", "fn:admin_staff_events_immutable()": "5211a4181aaa961863ff8b0eed92a5ab", "fn:admin_staff_invitations_open()": "b9d65d6d678b7e14142790c513b79ce4", "fn:admin_staff_invite_begin(uuid,text,text)": "7290634ea34489703e98ddd45ab5092b", "fn:admin_staff_invite_compensation_begin(uuid)": "004381817a02fa30425d1b8155f24292", "fn:admin_staff_invite_compensation_done(uuid,boolean,text)": "3db39a309126db6fe653858a770326d7", "fn:admin_staff_invite_mark_auth_created(uuid,uuid)": "33e946cde32b1e5e4ef6226b962bb28b", "fn:admin_staff_invite_register(uuid)": "0daace1f242d2e0cb9407baaee203c5c", "fn:admin_staff_invite_resend(uuid)": "be2aaa359a278319938959d7140dbf08", "fn:admin_staff_list()": "68a032cc03e5eab27877f942b1bdef91", "fn:admin_staff_password_reset_begin(uuid)": "bbfae4bd12e0b765f2a3371e016c7205", "fn:admin_staff_rename(uuid,text)": "3bc689e24d51a1217629759f126108b7", "fn:admin_staff_set_status(uuid,text,text)": "4c58990ff284a5a2a779724006730c0f", "fn:admin_update_billing_issuer_settings(jsonb,text)": "3b055addfa6fc1b5f6d78f3461ac6941", "fn:admin_update_organization_contract(uuid,jsonb,text)": "bc5d68b6be42aba8623db3795c3600f5", "fn:admin_update_success_fee(uuid,text,integer,integer,text,date,numeric)": "2303fedc2a55bcaada1a2548a904da3f", "fn:admin_update_visit_request(uuid,text,timestamp with time zone,date,text,text,uuid)": "070565636bae46758b6d935d8b2ab7d9", "fn:admin_upsert_scout_credit_package(uuid,text,integer,integer,numeric,boolean)": "d9a80ca4a0bbfd23d5bcc6d63c9f9c0b", "fn:admin_void_line(uuid)": "59fabfb6a0f141099d6b1eef52f99c74", "fn:admin_withdraw_quote(uuid)": "496a9bf6ac0b11290061922fac0b004b", "fn:admin_work_attribution_add(uuid,uuid,text)": "5d329d8e49f17b933428ece5fcf2a586", "fn:admin_work_note_add(text,uuid,uuid,text)": "eea36ce147e1b0ed31cd9f86e13c0ef4", "fn:admin_work_notes_for(text,uuid,integer)": "5248be305ea002b521f16d5286e6bf8a", "fn:admin_work_records_for(text,uuid,integer)": "ecd8504ec84ee237dbd8cd4df2342bfc", "fn:admin_work_records_immutable()": "670a150ceef4d9f1eb2bed1fe83a4a09", "fn:allocate_invoice_number(integer)": "af1679450e9a6490c2b458c35d15cf82", "fn:apply_payment_method_setup(uuid,text,text,text,text,text)": "ce25b0a6ef55924b17b66c136cbd8ef8", "fn:apply_scout_credit_payment(uuid,text,text,text,integer,text,text,text)": "dd2001def9cfd71f214ac7e0b777e3d4", "fn:apply_stripe_invoice_result(text,text,text,timestamp with time zone,text)": "3e6b065579aaf4d412f7308c955349f4", "fn:apply_stripe_subscription_snapshot(text,text,text,timestamp with time zone,timestamp with time zone,boolean,integer,text,timestamp with time zone,text)": "7618748ac4f9036d0fc42f687c7886e8", "fn:apply_subscription_checkout_completed(uuid,text,text,text,text)": "45112d9ab23cb532416b877ec9f14364", "fn:apply_success_fee_card_payment(uuid,text,text,text,integer,text,text,text)": "0e88a081a52d22639b2a44c70139d1c7", "fn:armor(bytea)": "6bf3d0a76729906165904ac1bc0be434", "fn:armor(bytea,text[],text[])": "959e932f6df16bc34aa2bdaacdee091b", "fn:assert_organization_recruiting_allowed(uuid)": "8bc3dfcea42abdb828fac9c4195f0ae1", "fn:assert_salon_target_recruiting_allowed(uuid)": "d97a28c438b4eb79aa4d3f87c722e938", "fn:assert_store_recruiting_allowed(uuid)": "9ed798cc134c34d2670637dd166b3eb2", "fn:assert_user_recruiting_allowed(uuid)": "37cc3f9c8932443c2a9fb712c9ef5fc5", "fn:attach_stripe_checkout_session(uuid,text)": "4875e108b9364d45ed8cd71d4fe7c33e", "fn:authorize_invoice_document_download(uuid)": "606a6f499d1c69cb537f5484d68ab6b3", "fn:authorize_subscription_invoice_download(uuid)": "fa3eeafada373aedd599bd232a4c1ac4", "fn:backfill_legacy_salary_offer_store_context()": "3923d921b16cfffd2d99b4c30e2ee1e7", "fn:begin_monthly_subscription_checkout(uuid)": "c73c62c1fd68406923849dd910cbdbef", "fn:begin_payment_method_setup(uuid)": "e8bdab315c4d969c2e7669c9c17dbfdd", "fn:begin_scout_credit_checkout(uuid,uuid)": "c2ddbf4f1081bc98db334b3627f47a2d", "fn:begin_success_fee_card_checkout(uuid)": "4b75403b05d24b1787533f8956b1d20d", "fn:billing_append_only()": "2bc0e6a83220c49a2227ecab8f52d5c2", "fn:billing_begin_checkout(uuid)": "d2b7a35f814471e3abe723b55c1edbb5", "fn:billing_default_tax_rate()": "4640c8ec3e6b90b9b39b165f0d4d13c4", "fn:billing_field_max_length(text)": "04c3d988f29c3a9af969400b99978a8b", "fn:billing_issuer_settings_guard()": "e0a7ed2ade84c7bc0249921e3e6b4b22", "fn:billing_json_text(jsonb,text,integer)": "cfa5e98dc161207c1792d354487fc946", "fn:billing_list_invoices(uuid)": "52f70e9ecd759968a8dedb3cf6469f01", "fn:billing_normalize_postal_code(text)": "f1ee7567608c2de29f3c7ff4e97a59b1", "fn:billing_normalize_registration_number(text)": "ccc909f305561ce13bdf2a3e77281e27", "fn:billing_standard_due_date(date)": "b6dc4fbeae3010ec6027091e1c238357", "fn:billing_tax_amount(integer,numeric)": "a0ce3105c4876027b7f3f09c3138ba98", "fn:block_salary_offer_insert_when_paused()": "4e42570bd714998ff38c9b9e95b39c73", "fn:calculate_match_axes(uuid,uuid)": "06565d93e4ec6341654b4d823d76d2a7", "fn:calculate_match_axes_by_store(uuid,uuid)": "ecf39de00546b6e8268df85d5904ea6d", "fn:calculate_salon_stylist_match(uuid)": "950c912758494dcd82017a2192384997", "fn:calculate_store_stylist_match(uuid,uuid)": "8d88d0312f73e7d415dd55acd84eddb5", "fn:calculate_stylist_match_consistency(integer,integer,integer,integer)": "c6d8515fbf5a0b90bf03889986036a9b", "fn:calculate_stylist_salon_match(uuid)": "405127f1fe8b7bb0a8982783f4021dcf", "fn:calculate_stylist_store_match(uuid)": "369c3c750ce79b47fb6aec48e510fc13", "fn:can_edit_store_assets(uuid)": "4b8a482ee18ed2fa1610920c4fd0e7cd", "fn:can_edit_store_culture_analysis(uuid)": "c3ad7b6c99a08b357d33a5cfef51d3a4", "fn:can_manage_organization_billing_profile(uuid)": "a4fffceca9fa53f7281d459a815a9d65", "fn:can_manage_store_hiring(uuid)": "54018ace4375d3f6355582cb88569885", "fn:check_rate_limit(text,integer,integer)": "9a7e8aa658c6afeb08f052880ae25ebc", "fn:claim_stripe_webhook_event(text,text,boolean)": "781f1202f04b9316d7760871919d1450", "fn:cleanup_expired_pending_diagnoses()": "be0e98854014d063c575f19bb32383e2", "fn:cleanup_rate_limit_counters(interval)": "31e9d5551f84849c78117e3c8f1d6ffe", "fn:cleanup_rate_limit_reservations()": "6bbf98d6befa2c733b48dd7e77fd9211", "fn:commit_diagnosis_result(uuid,uuid,boolean,text,diagnosis_mode,jsonb,smallint,smallint,smallint,smallint,smallint,smallint,text,text,smallint,text,uuid,timestamp with time zone)": "30901b87a7b3631281571d781a870eb5", "fn:commit_student_diagnosis(uuid,uuid,text,jsonb,jsonb)": "0b84437cb295fa4adf88622ad7424eea", "fn:company_billing_overview(uuid)": "4666036d086a0b781d9fd5865a55200b", "fn:company_get_invoice(uuid)": "0722df5a48e562d2205219b9536421f9", "fn:company_list_quotes(uuid)": "66d0bdde80c6e2a16972f3bfe501b43b", "fn:company_respond_quote(uuid,boolean)": "b84ebbfdb848dcb2399f64e0ee9d21af", "fn:complete_pending_diagnosis_claim(uuid)": "a45044c560bbe46146b61b7e6705fbc2", "fn:complete_stripe_webhook_event(text,text,text)": "a22fd67d0745236d6405a8f762781167", "fn:confirm_salon_culture_diagnosis(uuid,uuid,integer)": "1ba24905475ed697e82234a3cb25a9e0", "fn:create_ai_output(uuid,ai_output_type,text,text,text,jsonb)": "4335ea28a44dca58d9c8bf6d7aecd6e3", "fn:create_hiring_notification(uuid,text,text,text,uuid,text)": "f02cf47046795068bbdd4a03dd7aefaf", "fn:create_notification(uuid,text,text,text,text,uuid)": "2c233dcc18ca82814fb1ef17bbfd734a", "fn:create_salary_offer(uuid,integer,integer,integer,text,text)": "4923dc699098338c81b0b149d296e531", "fn:create_salary_offer_v2(uuid,uuid,integer,integer,integer,text,text)": "a047773ec12f96c1055317e3cb2f59fa", "fn:create_salon_culture_ai_output(uuid,ai_output_type,text,text,text,jsonb)": "b8bacdb21930c575e4a84a1b529b1eb6", "fn:create_scout_notification(uuid,text,text,text,uuid,text)": "5485620429b03c91b1c02ea2f76c233c", "fn:create_store_interest_notification(uuid,uuid,uuid,text,text,text)": "1c789dab29fe018dc33d1b187d86af29", "fn:crypt(text,text)": "c535e8f16d99f4963ef043624f176b50", "fn:current_legal_documents()": "4999f8dbca3396724e4c22983a398a2b", "fn:dearmor(text)": "7291a465dc6359cce99c67fe8708fbf3", "fn:decline_hiring_process(uuid,text)": "2891d9b0789785391d6ccf38ce1df9c7", "fn:decrypt(bytea,bytea,text)": "b4dddb96b7568a510c6c9b098b37127d", "fn:decrypt_iv(bytea,bytea,bytea,text)": "c5323c5b9c6758ca8ae41c957798095f", "fn:delete_salon_photo(uuid)": "d9b9e1f4c8f52105c3f9229bf463a4ee", "fn:delete_store_link(uuid)": "138a030b938e33c5b9a18fefb2c339ef", "fn:delete_store_photo(uuid)": "daea5354c85e6e531311ec3289fa7648", "fn:delete_stylist_evidence_document(uuid)": "d1377ff7d9974482a917cfac896a1619", "fn:digest(bytea,text)": "dfc1d6babe9ed6689863605de1627aa7", "fn:digest(text,text)": "66e930544c6b69d9b0ef70ee7797187e", "fn:discard_salon_culture_draft(uuid)": "b320210668595816d9688532ad7b49e4", "fn:email_outbox_claim(text,integer,integer)": "f9fd80c1bed1720bec954f726499a807", "fn:email_outbox_confirm_send(uuid,uuid)": "bc126973df28f96813afc2a2ab13241c", "fn:email_outbox_finish(uuid,uuid,text,text,text)": "74ba85666ef60ae496e9f31f7f7b6152", "fn:email_outbox_release(uuid,uuid)": "0fe8fd2462e99388cdcdabc179f518f4", "fn:email_template_keys()": "c26796d738a12967e239317c4e83fc32", "fn:encrypt(bytea,bytea,text)": "35cd296e38915d35ba6415d789d3f1da", "fn:encrypt_iv(bytea,bytea,bytea,text)": "a821cab989afa3b14581401991637891", "fn:enforce_ai_output_immutable_fields()": "0a68274c02b463e6664186ff5e7155f1", "fn:enforce_salon_culture_ai_output_immutable_fields()": "ce4d701c79dfd21f32002c4c1ba6c49a", "fn:gen_random_bytes(integer)": "47e8398d3ccfa31f1f648422a012a27d", "fn:gen_salt(text)": "925913dfcc25c1c44f05db9242994a48", "fn:gen_salt(text,integer)": "8662724f7b7d56ec664ea4210a6af335", "fn:get_admin_billing_integrity_issues()": "4ae06d14982a0bb5bc5dcdd1a3ed0535", "fn:get_admin_billing_issuer_settings()": "89c61c01461750b6e12aa1dd85e8431c", "fn:get_admin_evidence_queue()": "2160c2d02893fe3620e455ff3a28b680", "fn:get_admin_invoice_document(uuid)": "755991e0399920193a56c818fc475fce", "fn:get_admin_invoice_documents(uuid)": "d2d807990bd7b4c90154fdfa705002de", "fn:get_admin_legal_documents()": "8bff87d5b2b41009f812cef626560bbc", "fn:get_admin_organization_contract(uuid)": "3dd92ccb5a2d170a17c736617eed4138", "fn:get_admin_organization_contracts()": "ecf655e146476cb34a854b7754d249e7", "fn:get_admin_organization_overview()": "330808e498ba3c27588354bd901e01bb", "fn:get_admin_organization_stores(uuid)": "33f328968e2452ddd72bcf77e5aa2992", "fn:get_admin_scout_credit_packages()": "df319d8284f2d910277a25334585f935", "fn:get_admin_stripe_integrity_issues(boolean)": "86d24ec478689eaae1d4a4ad0db12542", "fn:get_admin_stripe_organization_detail(uuid)": "bfdda097ee7ccd28c6df05197d3c01eb", "fn:get_admin_stripe_overview()": "257b72d8df282e326b12fa7349ad61eb", "fn:get_admin_subscription_invoices(uuid)": "c81e316c628d156a44c7b7656fd5df3e", "fn:get_admin_success_fee_payments()": "5612e3367d18ca4116afcaa6ccfcbeed", "fn:get_admin_success_fees(text)": "3383efaf46e4b4425d748efe1685f840", "fn:get_admin_unissued_subscription_invoices()": "c138359b3ef42ca31cf06e7843a5619b", "fn:get_admin_user_legal_acceptances(uuid)": "611d59b90740833e8ac6f7b87549a43d", "fn:get_company_contract_settings(uuid)": "cbe30619d2c7eed150b2400985b3b195", "fn:get_company_hiring_analytics(uuid)": "b5720401b112d2a7fd4adf13d8d7519d", "fn:get_company_hiring_cohort_analytics(timestamp with time zone,timestamp with time zone,uuid)": "be819304558e7201e7a0455da367812f", "fn:get_company_hiring_period_analytics(timestamp with time zone,timestamp with time zone,uuid)": "c71693b4bd8c99ab65c2ff02418bb33b", "fn:get_company_invoice_documents(uuid)": "d7b238bc42dd0f8f557a06691ae404a4", "fn:get_company_payment_overview(uuid)": "a87ed4ead8b2371b6f1175f6d3c9b578", "fn:get_company_subscription_invoices(uuid)": "f8e3afd8141f944bc229d4ac95ce5341", "fn:get_company_success_fee_payment_info(uuid)": "14cb4273a48ea020ca78fdbaa572c01f", "fn:get_company_success_fees(uuid)": "d9c4b01a4561d66c486937872bf39b87", "fn:get_current_legal_documents()": "cbe3ea4bae0a9d7f27482e167a2a2801", "fn:get_diagnosis_change_status(text,uuid)": "457a0d7ba9ae891ffd928639ae020e34", "fn:get_hiring_process_events(uuid)": "cb67f2d096a9715a292b09f0dd945be0", "fn:get_invoice_issue_readiness(uuid)": "b52b5efddc606f3882971aba9e2a34b6", "fn:get_my_age_disclosure_requests()": "f99fc043bd88bf786150c493ad98172c", "fn:get_my_email_notifications()": "b2ad409f555dbe57392d6768b2f8cb1a", "fn:get_my_hiring_processes()": "e7d3d97461921aa0dd3de07d27fa731f", "fn:get_my_legal_acceptance_status()": "222ca4fa08e020f34e8e0e8b16e99c5d", "fn:get_organization_billing_profile(uuid)": "c28dd461d02ad4ecdaf5179cc5bc1877", "fn:get_organization_stripe_customer(uuid)": "f4e04c60ae6483f548bf0530d085c0a8", "fn:get_public_salon_culture_detail(uuid)": "ce15ca037e0400f44e9d1471b7985dd7", "fn:get_public_salon_links(uuid)": "3303a3ed36a5c1b84a8444e113e6a233", "fn:get_public_salon_photos(uuid)": "47d4e73ee800cb932bbc14503035daed", "fn:get_public_salon_store_detail(uuid)": "19840f56277c388509126900481bd9fc", "fn:get_public_salon_stores()": "f2aed429b8b253cd42a03a63c4581afe", "fn:get_public_store_assets(uuid)": "024b4efa35491cca5fcd9d47667b24eb", "fn:get_public_stylists_for_scout(uuid)": "86e6418641b7cf0bb5e5a283e751b546", "fn:get_received_salon_interests()": "315eb4e177a79f19769a7731e4214b06", "fn:get_store_assets(uuid)": "bcf598a779ed329be81770ce9355c4ff", "fn:get_store_hiring_processes(uuid)": "4c83f791ce4dffa8d880f3eda485da22", "fn:get_store_received_interests(uuid)": "d1b6b1f011fb25f2ad408edea94e3569", "fn:get_store_recruiting_access(uuid)": "8793e3fa66c630299052d76a1ff55974", "fn:get_store_salary_offers(uuid)": "782143dd75a426d10556d0533445f5c0", "fn:get_store_scout_quota(uuid)": "acdd36614b17294d160a0099aee3d88d", "fn:get_store_scouts(uuid)": "dbd271c66dce707a4c3f19e84356d9be", "fn:get_store_stylist_age_infos(uuid,uuid[])": "5a54ce9a5dc9c6c382cde95b6754abb3", "fn:get_stylist_public_extended_enabled()": "3cc7606f574f6b9cbd5f734557f615ea", "fn:get_subscription_invoice_issue_readiness(uuid)": "c8076c6945da0ec7ad97e1bb27ed96e2", "fn:handle_new_user()": "06af429eda950547532557b7333b3793", "fn:hiring_create_success_fee()": "829262dfa77631bbefc68f5495339714", "fn:hiring_fee_transition_allowed(text,text)": "76e28ecaf0a182213cf5063e0ea4f1dc", "fn:hiring_lock_process_for_store_staff(uuid)": "75d496fee5ff4f12c20fcc79b5a8238a", "fn:hiring_stage_rank(text)": "438370664e15aaf8451134aefaf9cebe", "fn:hiring_success_fee_events_append_only()": "50d9d9d7cda2a5575b7fc5cbb7f3f04f", "fn:hiring_success_fee_no_delete()": "55e9e3f4773d1d376ece077f52f2981c", "fn:hiring_success_fees_contract_snapshot_guard()": "f81d86fae66a8cdee29d2c2c546dcc04", "fn:hiring_success_fees_guard()": "26288fdf053b8d0892fde348cc7195aa", "fn:hiring_success_fees_invoice_guard()": "59b2596df4c6474d8b53f9b633fa73ee", "fn:hiring_transition_allowed(text,text)": "728c2ea50f09266c41961970c866812f", "fn:hmac(bytea,bytea,text)": "21593490f9d87b53060c5d93c78cfb40", "fn:hmac(text,text,text)": "239db7c0ddfbbca7b1005c61a85a9dc6", "fn:inbox_get_thread(uuid)": "f2c70f8503e6926817732a9fb0000d49", "fn:inbox_list_threads(integer,integer)": "36b8e23a5b504cb3261ffd6caf9a0d40", "fn:inbox_reply(uuid,uuid,text)": "8fe87f48a23952d2133a7aa862fe4719", "fn:invoice_documents_guard()": "c596dfb37074b0108da4113fdda86af5", "fn:invoice_issue_state(uuid)": "ec32ef35dfb4acb4a8de1711cfcdc0bf", "fn:invoice_number_counters_guard()": "4edf3ddd6a57d08718fb5c880f59a59e", "fn:invoice_snapshot_digest(jsonb,jsonb,jsonb)": "5de9f613412f8c2d074b703ec11bc06a", "fn:is_admin_operator()": "6fb15c8e5089c734712b369b23bfb5d5", "fn:is_admin_staff_active()": "b2d97b3ea7eb049c87311497566f93d2", "fn:is_known_prefecture(text)": "5d8678a5e8b992db4c4dc301324ebdaf", "fn:is_organization_member(uuid)": "f5cfb91105c551b3b5b2f1f64cf99b51", "fn:is_platform_admin()": "754f6e8b487bd2d97787a059af238def", "fn:is_salon_logo_write_blocked(uuid)": "e0ae06b95e91aaefbb5227a99c978322", "fn:is_store_accessible(uuid)": "df4e42464567a1aff0cec11c0a321c82", "fn:is_viewer_only_salon_staff(uuid)": "202387d7b46ba37f7816e7d3c3b6b52d", "fn:mark_all_notifications_read()": "7589bcd004de710907ce7b7a3946739f", "fn:mark_notification_read(uuid)": "3fd68572c2d9d57229be279af0b8dc64", "fn:mark_notifications_read_by_entities(jsonb)": "4c3e7fb29becad6a1b43ee65689558c2", "fn:mark_scout_read(uuid)": "95fa123f88ccde34427bf81dcb09684a", "fn:mark_stripe_checkout_expired(uuid,text)": "9951e8278e39588d18fc4fd08315c313", "fn:notify_on_hiring_event()": "b32337b4b3898995565fb69337b5137f", "fn:notify_on_scout_responded()": "567640a1e8ca5246603ce608d87bc3e8", "fn:notify_on_scout_sent()": "46a1df8f8f33af95631df1b546f880e1", "fn:notify_on_store_interest()": "4e09d155cfe4770fc1e19c2e78acb58f", "fn:organization_billing_profiles_guard()": "ade2cc1c6e8d55710e3b3769004dffdf", "fn:organization_contract_events_append_only()": "7d0b0b8081390c57dfa3142f2f8454c7", "fn:organization_contract_json_date(jsonb,text)": "0aa1aa545921a504171b2db9fc80f4f3", "fn:organization_contract_json_int(jsonb,text,integer,integer)": "5857b0b483b42aa86668f165f52b01a2", "fn:organization_contract_no_delete()": "55e9e3f4773d1d376ece077f52f2981c", "fn:organization_contract_settings_guard()": "baa4d9b9deb35c013ddcfa526a04fc5a", "fn:organization_recruiting_blocked(uuid)": "34543bf3127df537c0651023d69676dc", "fn:pgp_armor_headers(text)": "3dae93cabea118661be16d05f5fa828b", "fn:pgp_key_id(bytea)": "d3ef36b21466fda4ddb19c6a8caf1851", "fn:pgp_pub_decrypt(bytea,bytea)": "fa927837e7509c48410fcf4a140f8d73", "fn:pgp_pub_decrypt(bytea,bytea,text)": "ad685d0a8fdbd57a91879cb2e3579bd2", "fn:pgp_pub_decrypt(bytea,bytea,text,text)": "1e4a6410e39a8a80ac70b9df67443875", "fn:pgp_pub_decrypt_bytea(bytea,bytea)": "d1220d45367a799fe185ddb6107521f4", "fn:pgp_pub_decrypt_bytea(bytea,bytea,text)": "8d213c670a9fd37825fa8ab064ec863e", "fn:pgp_pub_decrypt_bytea(bytea,bytea,text,text)": "5723c1c9c8759bd8f45514da4824d6bb", "fn:pgp_pub_encrypt(text,bytea)": "d8f3c34589858de897de408e07248c9d", "fn:pgp_pub_encrypt(text,bytea,text)": "db9c7eea262402012cc249d737cbdf84", "fn:pgp_pub_encrypt_bytea(bytea,bytea)": "3fcd6302f1828a7a3a031c78285dbbc1", "fn:pgp_pub_encrypt_bytea(bytea,bytea,text)": "ca0a5b6222973f836f25d6e0f81becd7", "fn:pgp_sym_decrypt(bytea,text)": "b4e9a7ae9aa22308a258157d0a09e9f5", "fn:pgp_sym_decrypt(bytea,text,text)": "8d4917666fd8c30421c1f664787dbb74", "fn:pgp_sym_decrypt_bytea(bytea,text)": "1eff31417bbf48724891ffc5d50b841d", "fn:pgp_sym_decrypt_bytea(bytea,text,text)": "42ef18eabf1c394ccb134bdbb0fcc5a5", "fn:pgp_sym_encrypt(text,text)": "73ca71f313ca3f91a8c5a14b39ec45f0", "fn:pgp_sym_encrypt(text,text,text)": "cb17af307aa5a6be66bc3984bfe76c33", "fn:pgp_sym_encrypt_bytea(bytea,text)": "4075b183717f66a4154451b726a0cbc8", "fn:pgp_sym_encrypt_bytea(bytea,text,text)": "1af652504d87d6f4a4071ae56432efd5", "fn:prepare_invoice_document(uuid)": "a45ffb99160fb98fcf31f64a86adb576", "fn:prepare_subscription_invoice_document(uuid)": "f21870491c79d5ec93c5b55b3780d85a", "fn:public.gen_random_uuid()": "bfe0d5eeb2665cf74d6f9fd37a1b2974", "fn:record_stripe_refund_or_dispute(text,text,text)": "a27ed8a2c14d0afbcc2dee509b5e08bc", "fn:record_subscription_invoice_payment(text,text,text,text,integer,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,boolean,text)": "ca03c1f4f929bc24b349d77ad849571e", "fn:refresh_stylist_match_verification()": "bb98cb13b9966b46bea9c0338ef1dc00", "fn:register_invoice_document(uuid,text,text)": "cd3aa0b1e3553818ddc051d42e264b12", "fn:register_stripe_customer(uuid,text,boolean)": "ca75c891e533f2792544204cc712043b", "fn:register_stylist_evidence_document(text,text,text)": "296ae2b2cc9a2196950063552adbda89", "fn:register_subscription_invoice_document(uuid,text,text)": "bcaa0c54462776c1cb4c68d047d90cb4", "fn:registration_fee_for_store_count(integer)": "eac5013163e46ec5b99f2667a2116259", "fn:request_stylist_age_disclosure(uuid,uuid)": "537305ce552d8091d85d5486faf25803", "fn:require_performance_offer_opt_in()": "c2b60ecbaa4588af698b432588730f0c", "fn:reserve_rate_limit_slot(text,integer,integer,integer,integer)": "a52efc6e7e4010a4ee7c3e09e1a64c12", "fn:respond_age_disclosure_request(uuid,boolean)": "029527bd684d874bd0ada563d4813633", "fn:respond_salary_offer(uuid,text,text,text)": "551eebf7a3c372e9c1f7bb76f504e228", "fn:respond_scout(uuid,text,text)": "b13940a641639484d80b39b1edf09f50", "fn:review_stylist_evidence_document(uuid,text,text,text)": "3c3dcdf6964e6d8dd6c400b4cac65dba", "fn:salon_can_view_stylist_avatar(text)": "9c1e0aaa26f80562f4591ecb4189821d", "fn:save_core_type_result(uuid)": "1845b18e2f968453832e303058781b9b", "fn:save_salon_culture_analysis_answers(text,jsonb,jsonb)": "60e777a79de26146b5715ffc1a21de55", "fn:save_salon_culture_draft(uuid,jsonb,integer)": "933ac11c83354f5596e75ffc7fd6ec4d", "fn:save_salon_culture_profile(salon_culture_status,salon_culture_respondent_role,integer,jsonb,text[],text)": "de7808e105e104d4a104a2e70e4ff23f", "fn:save_salon_profile(text,text,text,text,text,text,text[],text,text,profile_visibility,text,text)": "2b789a6fc4bb994885ee408d817dedd5", "fn:save_salon_store_culture_analysis_answers(uuid,text,jsonb,jsonb)": "61316b79d73cabe2b9b8820f59d2e32b", "fn:save_salon_store_culture_profile(uuid,salon_culture_status,salon_culture_respondent_role,integer,jsonb,text[],text)": "9146e61a782fe5333e3460af05a99e0f", "fn:save_salon_store_profile(uuid,text,profile_visibility,text,text,text,text,text,text[],text,text)": "8948e0a82de3a907dd2d1873b3770d42", "fn:save_salon_store_profile_v2(uuid,text,profile_visibility,text,text,text,text,text[],text,text,integer,text)": "43bb8b8c9452fb7d63ce8e58a9478a4d", "fn:save_stylist_match_profile(text,text[],text,integer,integer,integer,integer,integer,integer,integer,integer,numeric,integer,integer,text)": "1c9f3a18cf21860a77d7e333657e0bfa", "fn:save_stylist_match_profile_v2(text,text[],text,boolean,integer,integer,integer,integer,integer,integer,integer,integer,numeric,integer,integer,text)": "0ebbdb7e5650c1ef860a9e12d555ab39", "fn:save_stylist_preference_profile(stylist_preference_status,integer,jsonb)": "de3f45f8f12ede117d0a417d56270c5e", "fn:save_stylist_profile(text,text,age_band,gender_type,text,text,integer,text,text[],employment_type,job_change_intent,salary_band,jsonb,text,profile_visibility,boolean,text,text[])": "d7667144d4af00d3dc3d2cb3180b74b6", "fn:save_stylist_profile_v2(text,text,age_band,gender_type,text,text,integer,text,text[],employment_type,job_change_intent,salary_band,jsonb,text,profile_visibility,boolean,text,text[],date,text)": "6e5c2c25f4c2f8e9e992ab84fcf50a37", "fn:save_stylist_profile_v3(text,text,age_band,gender_type,text,text,integer,text,text[],employment_type,job_change_intent,salary_band,jsonb,text,profile_visibility,boolean,text,text[],date,text,text,date,text,date,text)": "e0c25526793658385ec59f9687bc36a1", "fn:save_stylist_profile_v4(text,text,age_band,gender_type,text,text,integer,text,text[],employment_type,job_change_intent,salary_band,jsonb,text,profile_visibility,boolean,text,text[],date,text,text,date,integer,text)": "a2ea6e6ad0a10a8bcb57983c7a94cd86", "fn:schedule_hiring_interview(uuid,timestamp with time zone,text,text,text,text)": "de6e1c4c5905db8e670d8590b9a2d48d", "fn:send_scout(uuid,text,text)": "39dc1ec6d1ff311fe161816d75cde388", "fn:send_scout_v2(uuid,uuid,text,text)": "8096049520d9d24823ddd53268bde74f", "fn:service_prepare_subscription_invoice(uuid)": "3e2f3637153ae1ae2ff4b4d9670100f3", "fn:service_register_subscription_invoice(uuid,text,text)": "a7a0ed9a5093f0e36b5f3a63a32c5fa4", "fn:set_diagnosis_ai_status(uuid,ai_generation_status)": "b3701138e6d34113cf630a43451732ff", "fn:set_favorite_salon(uuid,boolean)": "5aed1334e4dc8e6bf85c01eb647d9491", "fn:set_my_email_notifications(boolean)": "7ccd729348d2b58c85c166fc9bd1b944", "fn:set_payment_method_state(text,boolean,text,text)": "351822517e80661c44f4b09023885a85", "fn:set_salon_interest(uuid,boolean)": "83f9387ec75e7496f61883f060912d8a", "fn:set_store_interest(uuid,boolean)": "47b81da08559733ffbf8b7298e715366", "fn:set_store_interest_v2(uuid,text,boolean)": "ee8e2c5f8c57765d83c50f28172b6a11", "fn:set_store_logo(uuid,text)": "fc97df022eca2f06f4e3cd86362f2794", "fn:set_stylist_age_display_mode(text)": "72292ba67188d2498d139885dd17bc17", "fn:set_stylist_birth_date(date)": "8932df9229a7ad743c25b2e11a7b067c", "fn:set_stylist_career_phase(text,date,text,date,text)": "7acd94ffb08af025cc210fcec362dbad", "fn:set_stylist_value_priorities(text[])": "a20b2f3deb5eab4a71ddc8060d822cad", "fn:set_updated_at()": "39a342382d820c9ed67c581333f32beb", "fn:settle_rate_limit_slot(uuid,text)": "616a0c7b9d132ac82b920371efe1e39b", "fn:start_pending_diagnosis_claim(uuid)": "4499df0c1f0e32774aa2387d47649006", "fn:store_hiring_process_events_append_only()": "b7002e10158ae799cd9f080cbcee1421", "fn:store_hiring_processes_guard()": "294e689a60104bc3167c799660760b6e", "fn:store_hiring_staff_recipients(uuid)": "c74a8c5c61d2f31c72926c94b2cb0eb9", "fn:stripe_assert_company_billing_actor(uuid)": "5ce9be537ed72580a8fa22a9d84249d0", "fn:stripe_begin_checkout_record(uuid,text,uuid,uuid,integer,integer,numeric,integer,integer)": "64ecad051236abdb1de73c21aa37b79d", "fn:stripe_checkout_records_guard()": "247ca503c42997071eb8317800efd718", "fn:stripe_log_issue(text,text,uuid,uuid,uuid,text,text,text)": "554da63dcc1fba43b8568614224ea2c6", "fn:stripe_payment_accounts_guard()": "f6f5bcdf92c10ded20844d71fe3be4ec", "fn:stripe_subscription_payment_state(text)": "a2bc80893c12eb2faf3adc5023dc9702", "fn:stripe_subscriptions_guard()": "96c7f8bbec44fe3cedf1995db4dfac42", "fn:stylist_age_years(date)": "0bb41f409097a36c58f5f4973c788ac0", "fn:stylist_public_extended_enabled()": "f15d5d02b1b2a6c5cfaccb20e89d6f54", "fn:stylist_salon_publishable(uuid)": "ad4bff17a6cc7b211fdbccfe4d36d5f7", "fn:subscription_invoice_documents_guard()": "ab7a666015b9aecd8be88ffc64af91e5", "fn:subscription_invoice_issue_state(uuid)": "2d34539171768ac4ca0ed6f0a03b4294", "fn:subscription_invoice_register(uuid,text,text,uuid)": "1f13f96e9916f0cc9b731d2b091d991f", "fn:update_hiring_internal_note(uuid,text)": "7298ab223eabc7acc972f61acd09d70f", "fn:update_hiring_status(uuid,text,text,text,text,text)": "585a023302f50a9320c00a4267a37a49", "fn:update_organization_billing_profile(uuid,jsonb)": "ab224688b5f307db4617720af2bdc661", "fn:update_salon_logo(text)": "3b8ed380f14ab316262c71d2b042c4a0", "fn:update_salon_photo_sort_order(uuid,integer)": "3f90abb38fe3ab2d905f07fa3b139da7", "fn:update_store_photo_sort_order(uuid,integer)": "4099e5b90ac737a29431ca4687b6fdc3", "fn:validate_and_normalize_avatar_path(uuid,text)": "5b28b70ec350ad03731431de5f940c1d", "fn:validate_and_normalize_salon_photo_path(uuid,text,text)": "89ecc1b033e897f7114582ed42ea72f7", "rel:account_invitation_events": "8a1a9c35f167e524fc77991a8416f061", "rel:account_invitations": "9fc87521ef5996a545f760c44060cc16", "rel:account_recovery_requests": "8129d7dfb76712a308453d8be7e8f78f", "rel:admin_audit_events": "751465782485eb96f08d96358c0d4b21", "rel:admin_invoice_checkouts": "1fed8ed66cd88411aeeac267889edf12", "rel:admin_invoice_lines": "5339280b5641b56c45e5deb023f72f2c", "rel:admin_invoice_webhook_events": "4384825a139389ec46c6d815da2dc911", "rel:admin_invoices": "5d14ed66876e8f1d55241e58333ca86c", "rel:admin_message_deliveries": "d71891e16faf36782044a5491dc3242e", "rel:admin_messages": "348d8ce03f04f8d7991256d17e2d6466", "rel:admin_quotes": "a3301789e4bb5635fdd08f1a59776a9a", "rel:admin_staff": "d0016ca2a5c3226f9ab5f2859aaa2546", "rel:admin_staff_events": "c9be9cccb3f584fea3fdfd1a2de679d1", "rel:admin_staff_invitations": "9281d04031520fc709fdb96502634df9", "rel:admin_threads": "ef90eda1b1f49264b72e524f3687cc28", "rel:admin_unresolved_billing_cases": "efb30e71411e9fe91c4eaceca232b38c", "rel:admin_visit_cases": "a9027a7856994f8aea588216c3423cb6", "rel:admin_visit_confirmations": "5eb65cb80e88b8d65f8a2eeb5a0d5e69", "rel:admin_visit_occurrences": "ea92fa86cdf950235c3a21db693c37de", "rel:admin_visit_request_events": "c7ad548729d322f7f5b618d7a007078a", "rel:admin_visit_requests": "4f2226c4cfbe957567ce147a88e80dad", "rel:admin_work_attributions": "650ee0c392851d3e712e73c574cdd114", "rel:admin_work_notes": "d003511afe4d924258aec3e9ef0e5c0f", "rel:admin_work_operation_catalog": "6e9094eabaa18dd82582b540f0d84421", "rel:admin_work_records": "04157656d5d6ca415ad90e40379f28c8", "rel:age_disclosure_requests": "86c115b32e4417cc0c8035d00d6526b1", "rel:billing_issuer_settings": "feb990a804248103de9bdc492121bc4f", "rel:billing_issuer_settings_events": "afaa357c0f8f00b3144ec643c87ec623", "rel:diagnosis_ai_outputs": "32cfa66a24f2ea8f2e5e06a5ef6ee813", "rel:diagnosis_change_limits": "f97588277c20d2b1158ad29739d813c7", "rel:diagnosis_results": "fa1c221fd307884cc0052c1fa69d0331", "rel:diagnosis_save_requests": "0c4c3e4cc6e035e9bd1edef175c57562", "rel:employee_size_master": "b2a87299e40e6398a12af4aab0ebba8f", "rel:feature_pauses": "4d5e1af31c920d4b46341fa1fe7bebf4", "rel:hiring_process_billing_basis": "1699d39dabce0878a31839d739f3e622", "rel:hiring_success_fee_events": "c00d2e8027fcf45807568aeb6a123cbf", "rel:hiring_success_fees": "9d307cef31079b7f520c48aef3652df5", "rel:invoice_document_events": "c1f7c2ada0db7e7765e0f98e3b1aafa3", "rel:invoice_documents": "8ca3838c6f59eea41d6791df1184bb32", "rel:invoice_number_counters": "ceb257b9a8ee4b0d205498ae1f10972d", "rel:legal_documents": "ea9f4238fd033a3444527aaf7159f292", "rel:notification_email_config": "194392ba5e97cac46e037edcf81b094e", "rel:notification_email_outbox": "6671a242c22618d4ec3565b400bafd5c", "rel:notification_email_outbox_events": "c7378e8cadb53478fae7ea06a3d7f380", "rel:notification_email_preferences": "e7db06847e6221b35aab99c275340e37", "rel:notifications": "eef241d5246a63ee54219ed9c8c9d584", "rel:organization_billing_profile_events": "75b0e4ee3fd60c6650f919e53b020468", "rel:organization_billing_profiles": "d48a104de0da47589b68c8a2d3d18ab4", "rel:organization_billing_regime": "84369457e18601252ee18c4d55ab04f0", "rel:organization_contract_events": "9a71a10c2d8647ef88b4cdacf6a890af", "rel:organization_contract_events_seq_seq": "eaf2716a32117c353aa41fe7232e1276", "rel:organization_contract_settings": "b683c6c3e81293776d38b7e084022384", "rel:organization_location_events": "c6b031504dc45b4b0fc5534a0b31c95b", "rel:organization_members": "e6715d8aec88e8742fd900f98f50411f", "rel:organization_payment_accounts": "01a4954770f67351aa883abed37b4180", "rel:organization_scout_quotas": "b91754d71782fe5bbde4ae3823c97ba4", "rel:organization_subscriptions": "0eb911482cfed865b3f1eb0817631447", "rel:pending_diagnoses": "175bd37c1f90c9855ab4e65c89a46352", "rel:platform_admins": "1fbd3c257a424736003b4b03b620b950", "rel:profiles": "8e30f849c6e8e4e0296c1d216a3edb02", "rel:rate_limit_counters": "5d5ab26de2ac34e43f3d350d239962a9", "rel:rate_limit_reservations": "9ea7fc8aca7a09378961e14fc4269dbe", "rel:salary_offers": "1c00cd87a78bdade417c75866f8291d5", "rel:salon_culture_ai_outputs": "c08f6c77d65e0572e3aa64a57c6b1e9d", "rel:salon_culture_analysis_answers": "865f0cfe63a862c9bebe2fc3d67b9a2e", "rel:salon_culture_drafts": "f50591dc8aba3888b817028a6e0b0ac1", "rel:salon_culture_profiles": "b5066acaf64b7e417c2d82c290bce52a", "rel:salon_inquiries": "2610469edb9b64a3c17dd0791ff273d6", "rel:salon_links": "955233692d45e3dd99880e7557bb1a71", "rel:salon_onboarding_assignments": "318784a4c5e5a7b1d272527dc28974cd", "rel:salon_organizations": "c9befbae6bccd693134228409146eb4d", "rel:salon_photos": "c1991d8ccbe2f010311ce1fa7c3b67b8", "rel:salon_profile_text_baseline_0088": "7a3bc98d50e7100508e2e9ca8dbe0c17", "rel:salon_profiles": "88543feb5c5bbd22b000c9724cae5671", "rel:salon_scout_quotas": "953ba8f0b9886540cdc41a6f7801fc5e", "rel:salon_store_culture_profiles": "e517bf04c807ff41fa3ea16beae44973", "rel:salon_store_links": "2994cd601e1677a79a72446abe49d088", "rel:salon_store_logos": "c326adadf876bb7da71e97bc9c2feb4c", "rel:salon_store_photos": "659aa079bf66ec6d780e376cef1535c9", "rel:salon_store_profile_backfill_0057": "c8011b5d43e0909f168f11e449053583", "rel:salon_store_profile_text_history": "44293afd87b137cf340d12bb0bf6a19f", "rel:salon_store_profiles": "29eed9b4e8f94fc8131d89e7ec32ca25", "rel:salon_stores": "6ba40cc17b325a0c9c560797516c3b87", "rel:scout_credit_packages": "50c8ab7b321a365f753611e6e2e9013f", "rel:scout_credit_purchases": "a267a3bf6ecb34cdfe7a033740e03385", "rel:scout_optout_migration_0070": "9244e06a3b666f17826bb3d7def2ef06", "rel:scouts": "9e627f7cceb38c5516c2f08b27ab95a5", "rel:store_hiring_process_events": "32e26a42b73cd0a7806e4c8ba68fd9f7", "rel:store_hiring_processes": "2bf975a26cad9b56fb7af7e1debe6fe6", "rel:store_members": "2dc0841b7acad4f88daca039d1bb7dfd", "rel:stripe_checkout_records": "32007ebd1de5b66805475d685a840430", "rel:stripe_integrity_issues": "5ace014839c7e478f4b230baee35a58c", "rel:stripe_webhook_events": "beae9302ccfa96e295d07182ae061c47", "rel:student_diagnosis_results": "7c4261753200c087f00ef2183b2b9ba3", "rel:stylist_core_type_assignments": "38d02c8d0e8cb0071a78643176790966", "rel:stylist_core_type_history": "8ce18f32ac692a43ba17470b881580d5", "rel:stylist_diagnosis_current": "19baf4cf024f1dafd6141d7715ba1245", "rel:stylist_evidence_documents": "9a87734fcfea61ebc99dd9e567efeb85", "rel:stylist_favorite_salons": "3ebe03d961173847ca2f8b0d52f911d8", "rel:stylist_match_profiles": "a342e778b87be00c2b80585656359df3", "rel:stylist_match_verification_snapshots": "9d86cef443c70edb1aad0561f86f0a58", "rel:stylist_preference_profiles": "3294f33839d1d15979ff8da04a06cfeb", "rel:stylist_private": "c578eda34a47d1104111ebd74c6a9e48", "rel:stylist_profiles": "58abbca0155e6df7525cd9f50d73de10", "rel:stylist_salon_interests": "e1c481f3ed59d1307a9222250f9a98ce", "rel:subscription_invoice_document_events": "c45540fbadf61349199a07d13c60fd66", "rel:subscription_invoice_documents": "c274659e6915a8d3f4e5e93d18a423ea", "rel:subscription_invoice_payments": "14589d544d0be3a9e17db5070cc136a2", "rel:success_fee_payments": "66503ccd7ab5ccb31a234e160aac2e2b", "rel:user_legal_acceptances": "7f84fcfbc6c0a8ba218b2d917ca6b617", "rel:user_roles": "b3e004e60ff513256a30caece2c6b693", "rel:user_settings": "b5d7056b10adb08c8618391aca63d5f7", "role:anon": "2ae66f90b7788ab8950e8f81b829c947", "role:authenticated": "700633a1b0f65fa8456a18bd6053193c", "role:postgres": "e8a48653851e28c69d0506508fb27fc5", "role:service_role": "c56ec2e104f2c93fd656087be1e991a0", "type:account_recovery_account_type": "580205963efc9e899b4c248e5efd66bc", "type:account_recovery_status": "81ce4f2c9d4eabb7055b35c53fb502fe", "type:age_band": "f3e17d9e3aced3afb7e699d76182ad26", "type:ai_generation_status": "b568f15d5bfb1091491d06420930609c", "type:ai_output_type": "28f6c385503c4d483899f138000dcb88", "type:diagnosis_mode": "580205963efc9e899b4c248e5efd66bc", "type:employment_type": "5d3c39809925c47bf78f993e3b543744", "type:gender_type": "fcf9f7ff99be88eee1d4e290aee8a362", "type:job_change_intent": "40898a2440df3ed2345f46be0237b530", "type:pending_diagnosis_claim_status": "947cadb5fb3f9da53a789ed5d4066178", "type:profile_visibility": "df3a463b71ca6e5c96eaad2cceefd00f", "type:salary_band": "2be8a39fd4884de6d1f381b002ec623f", "type:salon_culture_respondent_role": "7b6dab952396e72f3e00ee6a7b9c8720", "type:salon_culture_status": "47e12579a2f6a2645f2c0d28e8bfb19e", "type:stylist_core_type": "de3a984f26c91d139953da159cd63f2c", "type:stylist_preference_status": "47e12579a2f6a2645f2c0d28e8bfb19e", "type:user_role": "ce3ed909355aa1ebd74436223e7d6548"}'::jsonb; v_bad text;
begin
  v_cur := (select coalesce(jsonb_object_agg(k, h), '{}'::jsonb) from (select 'fn:' || p.oid::regprocedure::text as k, md5(p.prosrc || '|' || pg_get_function_arguments(p.oid) || '|' || pg_get_function_result(p.oid) || '|' || p.prokind::text || p.prosecdef || p.provolatile::text || p.proparallel::text || p.proleakproof || p.proisstrict || p.proretset || '|' || (select l.lanname from pg_language l where l.oid = p.prolang) || '|' || pg_get_userbyid(p.proowner) || '|' || coalesce((select string_agg(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || '<-' || pg_get_userbyid(a.grantor) || ':' || a.privilege_type || ':' || a.is_grantable, ',' order by case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, pg_get_userbyid(a.grantor), a.privilege_type) from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a),'') || '|' || coalesce(array_to_string(p.proconfig, ','), '')) as h from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f','p') union all select 'rel:' || c.relname, md5(c.relkind::text || '|' || pg_get_userbyid(c.relowner) || '|' || c.relrowsecurity || c.relforcerowsecurity || '|' || coalesce((select string_agg(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || '<-' || pg_get_userbyid(a.grantor) || ':' || a.privilege_type || ':' || a.is_grantable, ',' order by case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, pg_get_userbyid(a.grantor), a.privilege_type) from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a),'') || '|' || coalesce((select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), '') || ':' || a.attidentity::text || a.attgenerated::text, ',' order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped), '') || '|' || coalesce((select string_agg(k.conname || ':' || pg_get_constraintdef(k.oid) || ':' || k.convalidated, ',' order by k.conname) from pg_constraint k where k.conrelid = c.oid), '') || '|' || coalesce((select string_agg(i.indexdef, ',' order by i.indexname) from pg_indexes i where i.schemaname = 'public' and i.tablename = c.relname), '') || '|' || coalesce((select string_agg(o.polname || ':' || o.polcmd::text || ':' || o.polpermissive || ':' || coalesce(pg_get_expr(o.polqual, o.polrelid), '') || ':' || coalesce(pg_get_expr(o.polwithcheck, o.polrelid), '') || ':' || (select coalesce(string_agg(case when r = 0 then 'PUBLIC' else pg_get_userbyid(r) end, ',' order by case when r = 0 then 'PUBLIC' else pg_get_userbyid(r) end), '') from unnest(o.polroles) r), ',' order by o.polname) from pg_policy o where o.polrelid = c.oid), '') || '|' || coalesce((select string_agg(t.tgname || ':' || t.tgenabled::text || ':' || pg_get_triggerdef(t.oid), ',' order by t.tgname) from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal), '')) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m','S','f') union all select 'type:' || t.typname, md5(t.typtype::text || '|' || coalesce((select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid), '')) from pg_type t where t.typnamespace = 'public'::regnamespace and t.typtype = 'e' union all select 'authtrg:' || t.tgname, md5(t.tgenabled::text || pg_get_triggerdef(t.oid)) from pg_trigger t where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal union all select 'deprel:' || c.relname, md5(c.relkind::text || '|' || c.relrowsecurity || c.relforcerowsecurity || '|' || coalesce((select string_agg(case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || '<-' || pg_get_userbyid(a.grantor) || ':' || a.privilege_type || ':' || a.is_grantable, ',' order by case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, pg_get_userbyid(a.grantor), a.privilege_type) from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a),'') || '|' || coalesce((select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull, ',' order by a.attname) from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped), '') || '|' || coalesce((select string_agg(k.conname || ':' || pg_get_constraintdef(k.oid), ',' order by k.conname) from pg_constraint k where k.conrelid = c.oid), '') || '|' || coalesce((select string_agg(o.polname || ':' || o.polcmd::text || ':' || coalesce(pg_get_expr(o.polqual, o.polrelid), '') || ':' || coalesce(pg_get_expr(o.polwithcheck, o.polrelid), ''), ',' order by o.polname) from pg_policy o where o.polrelid = c.oid), '') || '|' || coalesce((select string_agg(t.tgname || ':' || t.tgenabled::text || ':' || pg_get_triggerdef(t.oid), ',' order by t.tgname) from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal), '')) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m') union all select 'authcol:' || c.relname || '.' || a.attname, md5(format_type(a.atttypid, a.atttypmod)) from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped where c.relnamespace = 'auth'::regnamespace and c.relname in ('users', 'sessions') and c.relkind in ('r','p') union all select 'authfn:' || p.proname, md5(pg_get_function_identity_arguments(p.oid) || '->' || pg_get_function_result(p.oid)) from pg_proc p where p.pronamespace = 'auth'::regnamespace and p.proname in ('uid', 'jwt', 'role') union all select 'role:' || r.rolname, md5(r.rolname) from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role', 'postgres')) t(k, h));
  select string_agg(e.key, ', ' order by e.key) into v_bad from jsonb_each_text(v_exp) e where v_cur->>e.key is distinct from e.value;
  if v_bad is not null then raise exception 'staff guard [巻き戻し後] 不一致のオブジェクト: %', v_bad using errcode = 'P0001'; end if;
  if (select coalesce(string_agg(k, ',' order by k), '') from jsonb_object_keys(v_cur) k where not ((current_setting('staff.rb_map')::jsonb) ? k)) <> '' then raise exception 'staff guard [巻き戻し後] 想定外の新規オブジェクト' using errcode = 'P0001'; end if;
  if exists (select 1 from unnest(array['fn:_ops_staff_account(uuid)','fn:_ops_staff_no_role_rows()']::text[]) k where v_cur ? k) then raise exception 'staff guard [巻き戻し後] 削除されるはずのオブジェクトが残っている' using errcode = 'P0001'; end if;
end $guard$;
commit;
