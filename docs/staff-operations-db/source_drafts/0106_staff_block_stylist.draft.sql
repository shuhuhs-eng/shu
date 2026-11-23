-- 0106_staff_block_stylist.draft.sql（草案・未適用・番号は提案）。依存: 0097v2（admin_staff）。共通の新規登録トリガー handle_new_user は変更しない。
-- 目的: 運営スタッフを美容師側の機能（公開候補・美容師としての保存・応答）から締め出す。判定は admin_staff に行があること（招待中・有効・停止中すべて）。
-- 責任者・一般利用者の動作は変えない。基にした本文の指紋が違えば適用中止。
begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('beauty-reach-0106'));
do $guard$
begin
  if to_regclass('public.admin_staff') is null then raise exception '0106 適用中止: 0097v2 がありません'; end if;
  if to_regprocedure('public._ops_staff_account(uuid)') is not null then raise exception '0106 適用中止: 既に存在します'; end if;
  if (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.stylist_salon_publishable(uuid)')) is distinct from '3ec24de6432d2268201712cbb7c8bcf7' then raise exception '0106 適用中止: stylist_salon_publishable の定義が想定と違います'; end if;
  if (select md5(prosrc) from pg_proc where oid = to_regprocedure('calculate_stylist_salon_match(uuid)')) is distinct from '49929d445b7dce70fe922bdcc6b39b4d' then raise exception '0106 適用中止: calculate_stylist_salon_match の定義が想定と違います'; end if;
  if (select md5(prosrc) from pg_proc where oid = to_regprocedure('calculate_stylist_store_match(uuid)')) is distinct from 'f3b0701ddcdbc30cee13b9096770b2a1' then raise exception '0106 適用中止: calculate_stylist_store_match の定義が想定と違います'; end if;
  if (select md5(prosrc) from pg_proc where oid = to_regprocedure('decline_hiring_process(uuid,text)')) is distinct from 'c3fe2ee21599d59cd7ab65a889f656f2' then raise exception '0106 適用中止: decline_hiring_process の定義が想定と違います'; end if;
  if (select md5(prosrc) from pg_proc where oid = to_regprocedure('delete_stylist_evidence_document(uuid)')) is distinct from '3ed9cbffc33eee8ca9b8fea3c5d9e25d' then raise exception '0106 適用中止: delete_stylist_evidence_document の定義が想定と違います'; end if;
  if (select md5(prosrc) from pg_proc where oid = to_regprocedure('get_my_age_disclosure_requests()')) is distinct from 'ddb730fbe70fc5e19a947e06b1dc8dbb' then raise exception '0106 適用中止: get_my_age_disclosure_requests の定義が想定と違います'; end if;
  if (select md5(prosrc) from pg_proc where oid = to_regprocedure('get_my_hiring_processes()')) is distinct from 'ca3f6982c61767da040fca6b5bdab0c9' then raise exception '0106 適用中止: get_my_hiring_processes の定義が想定と違います'; end if;
  if (select md5(prosrc) from pg_proc where oid = to_regprocedure('mark_scout_read(uuid)')) is distinct from 'c95d4d09b457b2bff9ff8a64e76b612d' then raise exception '0106 適用中止: mark_scout_read の定義が想定と違います'; end if;
  if (select md5(prosrc) from pg_proc where oid = to_regprocedure('register_stylist_evidence_document(text,text,text)')) is distinct from '443c405dc9f5487279bde17983d7ea82' then raise exception '0106 適用中止: register_stylist_evidence_document の定義が想定と違います'; end if;
  if (select md5(prosrc) from pg_proc where oid = to_regprocedure('respond_age_disclosure_request(uuid,boolean)')) is distinct from '119a00c339e9db4481b40bc4e7a77ef8' then raise exception '0106 適用中止: respond_age_disclosure_request の定義が想定と違います'; end if;
  if (select md5(prosrc) from pg_proc where oid = to_regprocedure('respond_salary_offer(uuid,text,text,text)')) is distinct from '3ed31960c7a4e7f3011fa3487b0ef123' then raise exception '0106 適用中止: respond_salary_offer の定義が想定と違います'; end if;
  if (select md5(prosrc) from pg_proc where oid = to_regprocedure('respond_scout(uuid,text,text)')) is distinct from 'fa9f3a52d0733c9a8dc664d89a632eb3' then raise exception '0106 適用中止: respond_scout の定義が想定と違います'; end if;
  if (select md5(prosrc) from pg_proc where oid = to_regprocedure('save_stylist_match_profile(text,text[],text,integer,integer,integer,integer,integer,integer,integer,integer,numeric,integer,integer,text)')) is distinct from '7383e7216cb7954a2756ca9075d3ec1e' then raise exception '0106 適用中止: save_stylist_match_profile の定義が想定と違います'; end if;
  if (select md5(prosrc) from pg_proc where oid = to_regprocedure('save_stylist_match_profile_v2(text,text[],text,boolean,integer,integer,integer,integer,integer,integer,integer,integer,numeric,integer,integer,text)')) is distinct from '3881d2eeab57d111a40ce2c0ea9832ac' then raise exception '0106 適用中止: save_stylist_match_profile_v2 の定義が想定と違います'; end if;
  if (select md5(prosrc) from pg_proc where oid = to_regprocedure('save_stylist_preference_profile(stylist_preference_status,integer,jsonb)')) is distinct from '38edace98078373abe706b24f6fc0e65' then raise exception '0106 適用中止: save_stylist_preference_profile の定義が想定と違います'; end if;
  if (select md5(prosrc) from pg_proc where oid = to_regprocedure('save_stylist_profile_v4(text,text,age_band,gender_type,text,text,integer,text,text[],employment_type,job_change_intent,salary_band,jsonb,text,profile_visibility,boolean,text,text[],date,text,text,date,integer,text)')) is distinct from '63830225a286e915dfc9b9e19dcbd82b' then raise exception '0106 適用中止: save_stylist_profile_v4 の定義が想定と違います'; end if;
  if (select md5(prosrc) from pg_proc where oid = to_regprocedure('set_favorite_salon(uuid,boolean)')) is distinct from '8caef21e73a83a534042b4ac48bdce4c' then raise exception '0106 適用中止: set_favorite_salon の定義が想定と違います'; end if;
  if (select md5(prosrc) from pg_proc where oid = to_regprocedure('set_store_interest_v2(uuid,text,boolean)')) is distinct from '76bee50b3ee1efc5d37577e08dfb9a0d' then raise exception '0106 適用中止: set_store_interest_v2 の定義が想定と違います'; end if;
  if (select md5(prosrc) from pg_proc where oid = to_regprocedure('set_stylist_age_display_mode(text)')) is distinct from '43ff4b3a561f5738847114906af48ec1' then raise exception '0106 適用中止: set_stylist_age_display_mode の定義が想定と違います'; end if;
  if (select md5(prosrc) from pg_proc where oid = to_regprocedure('set_stylist_birth_date(date)')) is distinct from 'cfc356e2c126afed93d464648b1142ac' then raise exception '0106 適用中止: set_stylist_birth_date の定義が想定と違います'; end if;
  if (select md5(prosrc) from pg_proc where oid = to_regprocedure('set_stylist_value_priorities(text[])')) is distinct from '7d39bf3da684938432aea16e37d142bc' then raise exception '0106 適用中止: set_stylist_value_priorities の定義が想定と違います'; end if;
end $guard$;
create function public._ops_staff_account(p_user_id uuid) returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select p_user_id is not null and exists (select 1 from public.admin_staff where user_id = p_user_id) $$;
create function public._ops_staff_no_role_rows() returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid := case tg_table_name when 'user_roles' then new.user_id when 'stylist_profiles' then new.user_id else new.user_id end;
begin
  if public._ops_staff_account(v_uid) then raise exception 'operations accounts cannot hold % rows', tg_table_name using errcode = '42501'; end if;
  return new;
end; $$;
revoke all on function public._ops_staff_account(uuid), public._ops_staff_no_role_rows() from public, anon, authenticated, service_role;
create trigger trg_ops_staff_no_user_roles before insert on public.user_roles for each row execute function public._ops_staff_no_role_rows();
create trigger trg_ops_staff_no_stylist_profiles before insert on public.stylist_profiles for each row execute function public._ops_staff_no_role_rows();
create trigger trg_ops_staff_no_stylist_private before insert on public.stylist_private for each row execute function public._ops_staff_no_role_rows();
-- stylist_salon_publishable: スタッフは常に false
CREATE OR REPLACE FUNCTION public.stylist_salon_publishable(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select not public._ops_staff_account(p_user_id) and coalesce((
    select sp.birth_date is not null and sp.age_display_mode is not null
       and (public.stylist_age_years(sp.birth_date) >= 18
            or not coalesce((select paused from public.feature_pauses where feature = 'minor_salon_public'), true))
    from public.stylist_private sp where sp.user_id = p_user_id
  ), false)
$function$;
-- calculate_stylist_salon_match
CREATE OR REPLACE FUNCTION public.calculate_stylist_salon_match(p_salon_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_stylist_uid uuid := auth.uid();
begin
  if public._ops_staff_account(auth.uid()) then raise exception 'operations accounts cannot use stylist features' using errcode = '42501'; end if;
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
-- calculate_stylist_store_match
CREATE OR REPLACE FUNCTION public.calculate_stylist_store_match(p_store_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_stylist_uid uuid := auth.uid();
begin
  if public._ops_staff_account(auth.uid()) then raise exception 'operations accounts cannot use stylist features' using errcode = '42501'; end if;
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
-- decline_hiring_process
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
  if public._ops_staff_account(auth.uid()) then raise exception 'operations accounts cannot use stylist features' using errcode = '42501'; end if;
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
-- delete_stylist_evidence_document
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
  if public._ops_staff_account(auth.uid()) then raise exception 'operations accounts cannot use stylist features' using errcode = '42501'; end if;
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
-- get_my_age_disclosure_requests
CREATE OR REPLACE FUNCTION public.get_my_age_disclosure_requests()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_uid uuid := auth.uid();
begin
  if public._ops_staff_account(auth.uid()) then raise exception 'operations accounts cannot use stylist features' using errcode = '42501'; end if;
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.user_roles where user_id = v_uid and role = 'stylist') then raise exception 'caller is not a stylist'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'request_id', r.id, 'store_id', r.store_id, 'store_name', s.store_name, 'prefecture', s.prefecture, 'city', s.city,
      'status', r.status, 'requested_at', r.requested_at, 'decided_at', r.decided_at) order by r.requested_at desc)
    from public.age_disclosure_requests r join public.salon_stores s on s.id = r.store_id
    where r.stylist_user_id = v_uid), '[]'::jsonb);
end;
$function$;
-- get_my_hiring_processes
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
  if public._ops_staff_account(auth.uid()) then raise exception 'operations accounts cannot use stylist features' using errcode = '42501'; end if;
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
-- mark_scout_read
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
  if public._ops_staff_account(auth.uid()) then raise exception 'operations accounts cannot use stylist features' using errcode = '42501'; end if;
  if v_uid is null then raise exception 'not authenticated'; end if;

  update public.scouts
  set read_status = 'read', read_at = coalesce(read_at, now())
  where id = p_scout_id and stylist_user_id = v_uid
  returning * into v_row;

  if v_row.id is null then raise exception 'scout not found'; end if;
  return v_row;
end;
$function$;
-- register_stylist_evidence_document
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
  if public._ops_staff_account(auth.uid()) then raise exception 'operations accounts cannot use stylist features' using errcode = '42501'; end if;
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
-- respond_age_disclosure_request
CREATE OR REPLACE FUNCTION public.respond_age_disclosure_request(p_request_id uuid, p_approve boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid(); v_req public.age_disclosure_requests; v_want text; v_stylist_label text;
begin
  if public._ops_staff_account(auth.uid()) then raise exception 'operations accounts cannot use stylist features' using errcode = '42501'; end if;
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
-- respond_salary_offer
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
  if public._ops_staff_account(auth.uid()) then raise exception 'operations accounts cannot use stylist features' using errcode = '42501'; end if;
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
-- respond_scout
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
  if public._ops_staff_account(auth.uid()) then raise exception 'operations accounts cannot use stylist features' using errcode = '42501'; end if;
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
-- save_stylist_match_profile
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
  if public._ops_staff_account(auth.uid()) then raise exception 'operations accounts cannot use stylist features' using errcode = '42501'; end if;
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
-- save_stylist_match_profile_v2
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
  if public._ops_staff_account(auth.uid()) then raise exception 'operations accounts cannot use stylist features' using errcode = '42501'; end if;
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
-- save_stylist_preference_profile
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
  if public._ops_staff_account(auth.uid()) then raise exception 'operations accounts cannot use stylist features' using errcode = '42501'; end if;
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
-- save_stylist_profile_v4
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
  if public._ops_staff_account(auth.uid()) then raise exception 'operations accounts cannot use stylist features' using errcode = '42501'; end if;
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
-- set_favorite_salon
CREATE OR REPLACE FUNCTION public.set_favorite_salon(p_salon_user_id uuid, p_favorite boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_stylist_uid uuid := auth.uid();
begin
  if public._ops_staff_account(auth.uid()) then raise exception 'operations accounts cannot use stylist features' using errcode = '42501'; end if;
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
-- set_store_interest_v2
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
  if public._ops_staff_account(auth.uid()) then raise exception 'operations accounts cannot use stylist features' using errcode = '42501'; end if;
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
-- set_stylist_age_display_mode
CREATE OR REPLACE FUNCTION public.set_stylist_age_display_mode(p_mode text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_uid uuid := auth.uid();
begin
  if public._ops_staff_account(auth.uid()) then raise exception 'operations accounts cannot use stylist features' using errcode = '42501'; end if;
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
-- set_stylist_birth_date
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
  if public._ops_staff_account(auth.uid()) then raise exception 'operations accounts cannot use stylist features' using errcode = '42501'; end if;
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
-- set_stylist_value_priorities
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
  if public._ops_staff_account(auth.uid()) then raise exception 'operations accounts cannot use stylist features' using errcode = '42501'; end if;
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
commit;
