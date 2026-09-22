-- ============================================================================
-- Beauty Reach — 0021_evidence_admin_review
-- Beauty Reach管理者による実績資料の確認・承認・差し戻し。
-- ============================================================================

create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
-- ブラウザからの直接参照は許可しない。専用RPCだけが判定する。

alter table public.stylist_evidence_documents
  add column review_reason text check (review_reason is null or review_reason in (
    'valid','unrelated','unreadable','insufficient','numbers_mismatch','suspected_tampering'
  )),
  add column review_note text check (review_note is null or char_length(review_note) <= 500),
  add column reviewed_by uuid references auth.users(id) on delete set null;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1 from public.platform_admins where user_id = auth.uid()
  );
$$;
revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;

create policy stylist_evidence_storage_select_admin on storage.objects
  for select to authenticated using (
    bucket_id = 'stylist-evidence' and public.is_platform_admin()
  );

create or replace function public.get_admin_evidence_queue()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_result jsonb;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id,
    'stylist_user_id', d.stylist_user_id,
    'public_name', sp.public_name,
    'document_type', d.document_type,
    'storage_path', d.storage_path,
    'original_file_name', d.original_file_name,
    'review_status', d.review_status,
    'review_reason', d.review_reason,
    'review_note', d.review_note,
    'created_at', d.created_at,
    'reviewed_at', d.reviewed_at,
    'declared_metrics', jsonb_build_object(
      'evidence_period_months', mp.evidence_period_months,
      'avg_monthly_technical_sales', mp.avg_monthly_technical_sales,
      'avg_monthly_clients', mp.avg_monthly_clients,
      'avg_monthly_named_clients', mp.avg_monthly_named_clients,
      'average_ticket', mp.average_ticket,
      'expected_transfer_clients', mp.expected_transfer_clients
    )
  ) order by case d.review_status when 'submitted' then 0 when 'rejected' then 1 else 2 end, d.created_at), '[]'::jsonb)
  into v_result
  from public.stylist_evidence_documents d
  join public.stylist_profiles sp on sp.user_id = d.stylist_user_id
  join public.stylist_match_profiles mp on mp.stylist_user_id = d.stylist_user_id;
  return v_result;
end;
$$;

create or replace function public.review_stylist_evidence_document(
  p_document_id uuid,
  p_decision text,
  p_reason text,
  p_note text default null
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_stylist_uid uuid;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if p_decision not in ('verified','rejected') then raise exception 'invalid decision'; end if;
  if p_decision = 'verified' and p_reason <> 'valid' then raise exception 'verified requires valid reason'; end if;
  if p_decision = 'rejected' and p_reason not in ('unrelated','unreadable','insufficient','numbers_mismatch','suspected_tampering') then
    raise exception 'invalid rejection reason';
  end if;

  update public.stylist_evidence_documents set
    review_status = p_decision,
    review_reason = p_reason,
    review_note = nullif(left(trim(coalesce(p_note, '')), 500), ''),
    reviewed_by = auth.uid(),
    reviewed_at = now()
  where id = p_document_id
  returning stylist_user_id into v_stylist_uid;
  if v_stylist_uid is null then raise exception 'document not found'; end if;

  update public.stylist_match_profiles
  set verification_status = case
    when cardinality(consistency_issues) > 0 then 'needs_review'
    when exists (select 1 from public.stylist_evidence_documents where stylist_user_id = v_stylist_uid and review_status = 'verified') then 'verified'
    when not exists (select 1 from public.stylist_evidence_documents where stylist_user_id = v_stylist_uid and review_status = 'submitted') then 'rejected'
    else 'submitted'
  end
  where stylist_user_id = v_stylist_uid;
  return true;
end;
$$;

revoke all on function public.get_admin_evidence_queue() from public, anon;
grant execute on function public.get_admin_evidence_queue() to authenticated;
revoke all on function public.review_stylist_evidence_document(uuid,text,text,text) from public, anon;
grant execute on function public.review_stylist_evidence_document(uuid,text,text,text) to authenticated;

-- 0020の資料追加・削除後の状態計算を、審査結果も含むように更新する。
create or replace function public.refresh_stylist_match_verification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_document_count integer;
  v_submitted_count integer;
  v_verified_count integer;
begin
  new.consistency_issues := public.calculate_stylist_match_consistency(
    new.avg_monthly_technical_sales, new.avg_monthly_clients,
    new.average_ticket, new.self_acquired_clients
  );
  select count(*), count(*) filter (where review_status = 'submitted'), count(*) filter (where review_status = 'verified')
  into v_document_count, v_submitted_count, v_verified_count
  from public.stylist_evidence_documents where stylist_user_id = new.stylist_user_id;
  new.verification_status := case
    when v_document_count = 0 then 'self_reported'
    when cardinality(new.consistency_issues) > 0 then 'needs_review'
    when v_verified_count > 0 then 'verified'
    when v_submitted_count = 0 then 'rejected'
    else 'submitted'
  end;
  return new;
end;
$$;

