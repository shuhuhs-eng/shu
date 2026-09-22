-- ============================================================================
-- Beauty Reach — 0020_stylist_evidence_verification
-- 実績証明資料（非公開）と、自己申告値の自動整合性チェックを追加する。
-- ============================================================================

alter table public.stylist_match_profiles
  add column verification_status text not null default 'self_reported'
    check (verification_status in ('self_reported','submitted','needs_review','verified','rejected')),
  add column consistency_issues text[] not null default '{}';

create table public.stylist_evidence_documents (
  id uuid primary key default gen_random_uuid(),
  stylist_user_id uuid not null references auth.users(id) on delete cascade,
  document_type text not null check (document_type in ('pos_sales','payslip','performance_report','other')),
  storage_path text not null unique,
  original_file_name text not null check (char_length(original_file_name) between 1 and 180),
  review_status text not null default 'submitted'
    check (review_status in ('submitted','verified','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

alter table public.stylist_evidence_documents enable row level security;
create policy stylist_evidence_documents_select_own on public.stylist_evidence_documents
  for select using (stylist_user_id = auth.uid());
grant select on public.stylist_evidence_documents to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'stylist-evidence', 'stylist-evidence', false, 10485760,
  array['image/jpeg','image/png','application/pdf']
)
on conflict (id) do nothing;

create policy stylist_evidence_storage_select_own on storage.objects
  for select to authenticated using (
    bucket_id = 'stylist-evidence' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy stylist_evidence_storage_insert_own on storage.objects
  for insert to authenticated with check (
    bucket_id = 'stylist-evidence' and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy stylist_evidence_storage_delete_own on storage.objects
  for delete to authenticated using (
    bucket_id = 'stylist-evidence' and (storage.foldername(name))[1] = auth.uid()::text
  );

create or replace function public.calculate_stylist_match_consistency(
  p_avg_monthly_technical_sales integer,
  p_avg_monthly_clients integer,
  p_average_ticket integer,
  p_self_acquired_clients integer
) returns text[]
language plpgsql immutable
set search_path = public, pg_temp
as $$
declare
  v_issues text[] := '{}';
  v_calculated_ticket numeric;
begin
  if p_avg_monthly_technical_sales is not null and p_avg_monthly_clients is not null
     and p_avg_monthly_clients > 0 and p_average_ticket is not null and p_average_ticket > 0 then
    v_calculated_ticket := p_avg_monthly_technical_sales::numeric / p_avg_monthly_clients;
    if abs(p_average_ticket - v_calculated_ticket) / v_calculated_ticket > 0.20 then
      v_issues := array_append(v_issues, 'average_ticket_mismatch');
    end if;
  end if;
  if p_self_acquired_clients is not null and p_avg_monthly_clients is not null
     and p_self_acquired_clients > p_avg_monthly_clients then
    v_issues := array_append(v_issues, 'self_acquired_exceeds_total');
  end if;
  return v_issues;
end;
$$;

create or replace function public.refresh_stylist_match_verification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_document_count integer;
begin
  new.consistency_issues := public.calculate_stylist_match_consistency(
    new.avg_monthly_technical_sales, new.avg_monthly_clients,
    new.average_ticket, new.self_acquired_clients
  );
  select count(*) into v_document_count
  from public.stylist_evidence_documents
  where stylist_user_id = new.stylist_user_id;
  new.verification_status := case
    when v_document_count = 0 then 'self_reported'
    when cardinality(new.consistency_issues) > 0 then 'needs_review'
    else 'submitted'
  end;
  return new;
end;
$$;

create trigger trg_stylist_match_verification
  before insert or update of career_stage, evidence_period_months,
    avg_monthly_technical_sales, avg_monthly_retail_sales, avg_monthly_clients,
    avg_monthly_named_clients, average_ticket, repeat_rate, monthly_working_days,
    average_daily_hours, self_acquired_clients, expected_transfer_clients, assistant_usage
  on public.stylist_match_profiles
  for each row execute function public.refresh_stylist_match_verification();

create or replace function public.register_stylist_evidence_document(
  p_document_type text,
  p_storage_path text,
  p_original_file_name text
) returns public.stylist_evidence_documents
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
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
$$;

create or replace function public.delete_stylist_evidence_document(p_document_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
$$;

revoke all on function public.register_stylist_evidence_document(text,text,text) from public, anon;
grant execute on function public.register_stylist_evidence_document(text,text,text) to authenticated;
revoke all on function public.delete_stylist_evidence_document(uuid) from public, anon;
grant execute on function public.delete_stylist_evidence_document(uuid) to authenticated;

-- サロンへは資料そのものを渡さず、確認状態・件数・自動チェック結果だけを返す。
create or replace function public.get_received_salon_interests()
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
  select coalesce(jsonb_agg(jsonb_build_object(
    'stylist_user_id', i.stylist_user_id, 'created_at', i.created_at,
    'public_name', sp.public_name, 'prefecture', sp.prefecture,
    'desired_work_location', sp.desired_work_location,
    'experience_years', sp.experience_years, 'current_position', sp.current_position,
    'specialties', sp.specialties, 'job_change_intent', sp.job_change_intent, 'bio', sp.bio,
    'match_profile', case when mp.stylist_user_id is null then null else jsonb_build_object(
      'primary_goal', mp.primary_goal, 'secondary_goals', mp.secondary_goals,
      'career_stage', mp.career_stage, 'evidence_period_months', mp.evidence_period_months,
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
  where i.salon_user_id = v_salon_uid;
  return v_result;
end;
$$;

revoke all on function public.get_received_salon_interests() from public, anon;
grant execute on function public.get_received_salon_interests() to authenticated;
