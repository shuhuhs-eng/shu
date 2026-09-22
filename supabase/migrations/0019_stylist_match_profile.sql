-- ============================================================================
-- Beauty Reach — 0019_stylist_match_profile
-- 転職目的・優先順位・スタイリスト実績を構造化して保存する。
-- ============================================================================

create table public.stylist_match_profiles (
  stylist_user_id uuid primary key references auth.users(id) on delete cascade,
  primary_goal text not null,
  secondary_goals text[] not null default '{}',
  career_stage text not null check (career_stage in ('results_stylist','growing_stylist','assistant_newcomer')),
  evidence_period_months integer check (evidence_period_months in (3,6,12)),
  avg_monthly_technical_sales integer check (avg_monthly_technical_sales between 0 and 10000000),
  avg_monthly_retail_sales integer check (avg_monthly_retail_sales between 0 and 5000000),
  avg_monthly_clients integer check (avg_monthly_clients between 0 and 1000),
  avg_monthly_named_clients integer check (avg_monthly_named_clients between 0 and 1000),
  average_ticket integer check (average_ticket between 0 and 1000000),
  repeat_rate integer check (repeat_rate between 0 and 100),
  monthly_working_days integer check (monthly_working_days between 1 and 31),
  average_daily_hours numeric(4,1) check (average_daily_hours between 1 and 24),
  self_acquired_clients integer check (self_acquired_clients between 0 and 1000),
  expected_transfer_clients integer check (expected_transfer_clients between 0 and 1000),
  assistant_usage text check (assistant_usage in ('none','shared','dedicated')),
  status text not null default 'completed' check (status = 'completed'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stylist_match_profile_secondary_count check (cardinality(secondary_goals) <= 2),
  constraint stylist_match_profile_primary_not_secondary check (not (primary_goal = any(secondary_goals))),
  constraint stylist_match_profile_named_within_total check (
    avg_monthly_named_clients is null or avg_monthly_clients is null
    or avg_monthly_named_clients <= avg_monthly_clients
  ),
  constraint stylist_match_profile_results_core_required check (
    career_stage <> 'results_stylist'
    or (evidence_period_months is not null and avg_monthly_technical_sales is not null
        and avg_monthly_clients is not null and monthly_working_days is not null)
  )
);

alter table public.stylist_match_profiles enable row level security;
create policy stylist_match_profiles_select_own on public.stylist_match_profiles
  for select using (stylist_user_id = auth.uid());
grant select on public.stylist_match_profiles to authenticated;

create trigger trg_stylist_match_profiles_updated
  before update on public.stylist_match_profiles
  for each row execute function public.set_updated_at();

create or replace function public.save_stylist_match_profile(
  p_primary_goal text,
  p_secondary_goals text[],
  p_career_stage text,
  p_evidence_period_months integer,
  p_avg_monthly_technical_sales integer,
  p_avg_monthly_retail_sales integer,
  p_avg_monthly_clients integer,
  p_avg_monthly_named_clients integer,
  p_average_ticket integer,
  p_repeat_rate integer,
  p_monthly_working_days integer,
  p_average_daily_hours numeric,
  p_self_acquired_clients integer,
  p_expected_transfer_clients integer,
  p_assistant_usage text
) returns public.stylist_match_profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
$$;

revoke all on function public.save_stylist_match_profile(text,text[],text,integer,integer,integer,integer,integer,integer,integer,integer,numeric,integer,integer,text) from public;
revoke all on function public.save_stylist_match_profile(text,text[],text,integer,integer,integer,integer,integer,integer,integer,integer,numeric,integer,integer,text) from anon;
grant execute on function public.save_stylist_match_profile(text,text[],text,integer,integer,integer,integer,integer,integer,integer,integer,numeric,integer,integer,text) to authenticated;

-- 0018の受信一覧へ、明示的に意思表示した美容師のマッチプロフィールを追加する。
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
      'career_stage', mp.career_stage,
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
      'assistant_usage', mp.assistant_usage
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

revoke all on function public.get_received_salon_interests() from public;
revoke all on function public.get_received_salon_interests() from anon;
grant execute on function public.get_received_salon_interests() to authenticated;
