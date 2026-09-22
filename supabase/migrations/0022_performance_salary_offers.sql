-- ============================================================================
-- Beauty Reach — 0022_performance_salary_offers
-- 希望者だけが利用する、確認済み実績に基づく給与オファー。
-- ============================================================================

alter table public.stylist_match_profiles
  add column wants_performance_offer boolean not null default false;

create or replace function public.require_performance_offer_opt_in()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.stylist_match_profiles
    where stylist_user_id = new.stylist_user_id
      and career_stage = 'results_stylist' and wants_performance_offer
  ) then raise exception 'performance offer opt-in required'; end if;
  return new;
end;
$$;
create trigger trg_evidence_requires_offer_opt_in
  before insert on public.stylist_evidence_documents
  for each row execute function public.require_performance_offer_opt_in();

-- 既に実績と資料を登録している利用者の意図は維持する。
update public.stylist_match_profiles
set wants_performance_offer = true
where career_stage = 'results_stylist' and avg_monthly_technical_sales is not null;

create or replace function public.refresh_stylist_match_verification()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_document_count integer; v_submitted_count integer; v_verified_count integer;
begin
  new.consistency_issues := public.calculate_stylist_match_consistency(
    new.avg_monthly_technical_sales,new.avg_monthly_clients,new.average_ticket,new.self_acquired_clients
  );
  select count(*),count(*) filter(where review_status='submitted'),count(*) filter(where review_status='verified')
  into v_document_count,v_submitted_count,v_verified_count
  from public.stylist_evidence_documents where stylist_user_id=new.stylist_user_id;
  new.verification_status := case
    when not new.wants_performance_offer then 'self_reported'
    when v_document_count=0 then 'self_reported'
    when cardinality(new.consistency_issues)>0 then 'needs_review'
    when v_verified_count>0 then 'verified'
    when v_submitted_count=0 then 'rejected'
    else 'submitted' end;
  return new;
end;
$$;

alter table public.stylist_match_profiles drop constraint stylist_match_profile_results_core_required;
alter table public.stylist_match_profiles add constraint stylist_match_profile_results_core_required check (
  not wants_performance_offer
  or (career_stage = 'results_stylist' and evidence_period_months is not null
      and avg_monthly_technical_sales is not null and avg_monthly_clients is not null
      and monthly_working_days is not null)
);

create or replace function public.save_stylist_match_profile_v2(
  p_primary_goal text, p_secondary_goals text[], p_career_stage text,
  p_wants_performance_offer boolean,
  p_evidence_period_months integer, p_avg_monthly_technical_sales integer,
  p_avg_monthly_retail_sales integer, p_avg_monthly_clients integer,
  p_avg_monthly_named_clients integer, p_average_ticket integer,
  p_repeat_rate integer, p_monthly_working_days integer, p_average_daily_hours numeric,
  p_self_acquired_clients integer, p_expected_transfer_clients integer, p_assistant_usage text
) returns public.stylist_match_profiles
language plpgsql security definer set search_path = public, pg_temp
as $$
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
$$;
revoke all on function public.save_stylist_match_profile_v2(text,text[],text,boolean,integer,integer,integer,integer,integer,integer,integer,integer,numeric,integer,integer,text) from public, anon;
grant execute on function public.save_stylist_match_profile_v2(text,text[],text,boolean,integer,integer,integer,integer,integer,integer,integer,integer,numeric,integer,integer,text) to authenticated;

create table public.salary_offers (
  id uuid primary key default gen_random_uuid(),
  salon_user_id uuid not null references auth.users(id) on delete cascade,
  stylist_user_id uuid not null references auth.users(id) on delete cascade,
  monthly_guarantee integer not null check (monthly_guarantee between 100000 and 2000000),
  performance_addition integer not null default 0 check (performance_addition between 0 and 1000000),
  guarantee_months integer not null check (guarantee_months in (1,3,6,12)),
  salon_message text check (salon_message is null or char_length(salon_message) <= 500),
  status text not null default 'pending' check (status in ('pending','accepted','revision_requested','declined','withdrawn')),
  response_reason text check (response_reason is null or response_reason in ('workdays','guarantee_period','role','performance_basis','other')),
  response_note text check (response_note is null or char_length(response_note) <= 500),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index salary_offers_one_pending_per_pair on public.salary_offers(salon_user_id, stylist_user_id) where status = 'pending';
alter table public.salary_offers enable row level security;
create policy salary_offers_select_participant on public.salary_offers for select using (
  salon_user_id = auth.uid() or stylist_user_id = auth.uid()
);
grant select on public.salary_offers to authenticated;
create trigger trg_salary_offers_updated before update on public.salary_offers for each row execute function public.set_updated_at();

create or replace function public.create_salary_offer(
  p_stylist_user_id uuid, p_monthly_guarantee integer, p_performance_addition integer,
  p_guarantee_months integer, p_salon_message text
) returns public.salary_offers
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid(); v_row public.salary_offers;
begin
  if not exists (select 1 from public.user_roles where user_id=v_uid and role='salon') then raise exception 'caller is not a salon'; end if;
  if not exists (select 1 from public.stylist_salon_interests where salon_user_id=v_uid and stylist_user_id=p_stylist_user_id) then raise exception 'interest required'; end if;
  if not exists (select 1 from public.stylist_match_profiles where stylist_user_id=p_stylist_user_id and wants_performance_offer and verification_status='verified') then raise exception 'verified opt-in profile required'; end if;
  insert into public.salary_offers(salon_user_id,stylist_user_id,monthly_guarantee,performance_addition,guarantee_months,salon_message)
  values(v_uid,p_stylist_user_id,p_monthly_guarantee,coalesce(p_performance_addition,0),p_guarantee_months,nullif(trim(coalesce(p_salon_message,'')),''))
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.respond_salary_offer(
  p_offer_id uuid, p_response text, p_reason text default null, p_note text default null
) returns public.salary_offers
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid(); v_row public.salary_offers;
begin
  if p_response not in ('accepted','revision_requested','declined') then raise exception 'invalid response'; end if;
  if p_response='revision_requested' and p_reason not in ('workdays','guarantee_period','role','performance_basis','other') then raise exception 'reason required'; end if;
  update public.salary_offers set status=p_response,
    response_reason=case when p_response='revision_requested' then p_reason end,
    response_note=case when p_response='revision_requested' then nullif(left(trim(coalesce(p_note,'')),500),'') end,
    responded_at=now()
  where id=p_offer_id and stylist_user_id=v_uid and status='pending'
  returning * into v_row;
  if v_row.id is null then raise exception 'offer not found'; end if;
  return v_row;
end;
$$;
revoke all on function public.create_salary_offer(uuid,integer,integer,integer,text) from public, anon;
grant execute on function public.create_salary_offer(uuid,integer,integer,integer,text) to authenticated;
revoke all on function public.respond_salary_offer(uuid,text,text,text) from public, anon;
grant execute on function public.respond_salary_offer(uuid,text,text,text) to authenticated;

-- 受信一覧に、給与相談への意思だけを追加する。資料本体は引き続き返さない。
create or replace function public.get_received_salon_interests()
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_salon_uid uuid := auth.uid(); v_result jsonb;
begin
  if v_salon_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.user_roles where user_id=v_salon_uid and role='salon') then raise exception 'caller is not a salon'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'stylist_user_id',i.stylist_user_id,'created_at',i.created_at,'public_name',sp.public_name,
    'prefecture',sp.prefecture,'desired_work_location',sp.desired_work_location,
    'experience_years',sp.experience_years,'current_position',sp.current_position,
    'specialties',sp.specialties,'job_change_intent',sp.job_change_intent,'bio',sp.bio,
    'match_profile',case when mp.stylist_user_id is null then null else jsonb_build_object(
      'primary_goal',mp.primary_goal,'secondary_goals',mp.secondary_goals,'career_stage',mp.career_stage,
      'wants_performance_offer',mp.wants_performance_offer,
      'evidence_period_months',mp.evidence_period_months,'avg_monthly_technical_sales',mp.avg_monthly_technical_sales,
      'avg_monthly_retail_sales',mp.avg_monthly_retail_sales,'avg_monthly_clients',mp.avg_monthly_clients,
      'avg_monthly_named_clients',mp.avg_monthly_named_clients,'average_ticket',mp.average_ticket,
      'repeat_rate',mp.repeat_rate,'monthly_working_days',mp.monthly_working_days,
      'average_daily_hours',mp.average_daily_hours,'self_acquired_clients',mp.self_acquired_clients,
      'expected_transfer_clients',mp.expected_transfer_clients,'assistant_usage',mp.assistant_usage,
      'verification_status',mp.verification_status,'consistency_issues',mp.consistency_issues,
      'evidence_document_count',(select count(*) from public.stylist_evidence_documents d where d.stylist_user_id=i.stylist_user_id)
    ) end
  ) order by i.created_at desc),'[]'::jsonb) into v_result
  from public.stylist_salon_interests i join public.stylist_profiles sp on sp.user_id=i.stylist_user_id
  left join public.stylist_match_profiles mp on mp.stylist_user_id=i.stylist_user_id
  where i.salon_user_id=v_salon_uid;
  return v_result;
end;
$$;
revoke all on function public.get_received_salon_interests() from public, anon;
grant execute on function public.get_received_salon_interests() to authenticated;
