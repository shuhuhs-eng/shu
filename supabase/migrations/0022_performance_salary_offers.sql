-- ============================================================================
-- Beauty Reach — 0022_performance_salary_offers
-- 希望者だけが利用する、確認済み実績に基づく給与オファー。
--
-- ★このファイルはSupabase本番へまだ一度も適用されていない前提で、
-- 設計レビューの結果を反映して直接書き換えている（0023は作成しない）。
-- 変更点の要約:
--   1. 既存results_stylistユーザーへの自動オプトイン一括UPDATEを削除
--      （本人が明示的に選択した場合のみwants_performance_offer=trueにする）。
--   2. 承認時点の主要申告値スナップショット
--      （stylist_match_verification_snapshots）を新設し、
--      承認後に美容師が数字を変更しても古い承認が新しい数字に
--      引き継がれないようにする。
--   3. verification_statusに reverification_needed を追加し、
--      「管理者が実際に差し戻した(rejected)」と
--      「承認後に数字が変わって再確認が必要になった」を区別する。
--   4. salary_offers に performance_condition（支給条件）を追加し、
--      実績加算 > 0円の場合は必須にする。
-- ============================================================================

alter table public.stylist_match_profiles
  add column wants_performance_offer boolean not null default false;

-- verification_statusの取りうる値に reverification_needed を追加する。
-- 0020で「add column ... check (...)」の形で作られた無名制約を想定し、
-- PostgreSQLの標準命名規則（{table}_{column}_check）に基づく名前を
-- 明示的にdrop（存在しない場合はis exists保護のみで何もしない）してから
-- 新しい許容値で作り直す。
-- ★Supabase適用前に、実際の制約名がこの想定と一致しているかの確認が必要
--   （詳細は実装後の報告内の「Supabase適用前の注意点」を参照）。
alter table public.stylist_match_profiles
  drop constraint if exists stylist_match_profiles_verification_status_check;
alter table public.stylist_match_profiles
  add constraint stylist_match_profiles_verification_status_check
  check (verification_status in (
    'self_reported','submitted','needs_review','verified','rejected','reverification_needed'
  ));

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

-- ★設計変更（重要）: 当初ここには「既にresults_stylistで売上入力済みの
-- 利用者は意図を維持する」として wants_performance_offer を一括で true に
-- 更新するUPDATE文があった。しかしこれは本人が「実績オファーを希望する」
-- を明示的に選択したかどうかとは無関係にオプトインさせてしまうため、
-- 「本人が明示的に選択した場合のみ利用する」という方針に反すると判断し、
-- このmigrationからは削除した。0022がまだ本番未適用のため、
-- 一度も実行されないまま削除でき、本番データへの影響はない。

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

-- ============================================================================
-- 承認済み実績スナップショット（新設・設計レビュー反映）
--
-- 目的：「管理者が資料確認した時点の主要申告値を記録し、その後美容師が
-- 主要申告値を書き換えた場合に、以前の確認状態を現在値へ引き継がない」
-- ための変更検知専用の記録。
--
-- ★意味の限定（重要）: このスナップショットが存在する＝
-- 「4項目すべてを資料が証明した」という意味ではない。あくまで
-- 「管理者が資料を確認した時点で、これらの主要申告値がいくつだったか」
-- を記録し、事後の書き換えを検知するためのものである。
-- 「原本の真正性・発行元まで確認した」という意味も持たせない
-- （0021以来の管理画面の注記「原本の真正性を保証する判定ではありません」
-- という考え方をそのまま維持する）。
--
-- 対象は、既存の管理画面（EvidenceReviewCard）が実際に比較表示している
-- 4項目に限定する。それ以外の項目（店販売上・再来率・勤務日数等）は
-- 資料によって確認された実態がそもそもないため、対象に含めない。
--
-- 過去のスナップショットは一切UPDATE/DELETEしない（削除しない）。
-- ============================================================================
create table public.stylist_match_verification_snapshots (
  id uuid primary key default gen_random_uuid(),
  stylist_user_id uuid not null references auth.users(id) on delete cascade,
  evidence_document_id uuid references public.stylist_evidence_documents(id) on delete set null,
  avg_monthly_technical_sales integer,
  avg_monthly_clients integer,
  avg_monthly_named_clients integer,
  average_ticket integer,
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.stylist_match_verification_snapshots enable row level security;
create policy stylist_match_verification_snapshots_select_own on public.stylist_match_verification_snapshots
  for select using (stylist_user_id = auth.uid());
create policy stylist_match_verification_snapshots_select_admin on public.stylist_match_verification_snapshots
  for select using (public.is_platform_admin());
grant select on public.stylist_match_verification_snapshots to authenticated;
-- INSERT/UPDATE/DELETE権限はクライアントへ一切付与しない。
-- 書き込みは review_stylist_evidence_document()（SECURITY DEFINER）経由のみ。

-- 0020/0021の資料追加・削除・審査後の状態計算を、
-- 「承認時点の主要4項目スナップショットと現在値が一致するか」で
-- 判定するように更新する。
--
-- ★rejectedの意味を限定: 「管理者が実際に資料を差し戻した」場合のみを
-- rejectedとする。過去にverified資料が存在するが現在値が
-- スナップショットと一致しない場合は、新設の reverification_needed に
-- 分類し、rejectedとは区別する。
create or replace function public.refresh_stylist_match_verification()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_document_count integer;
  v_submitted_count integer;
  v_verified_count integer;
  v_has_matching_snapshot boolean;
begin
  new.consistency_issues := public.calculate_stylist_match_consistency(
    new.avg_monthly_technical_sales,new.avg_monthly_clients,new.average_ticket,new.self_acquired_clients
  );

  select count(*),count(*) filter(where review_status='submitted'),count(*) filter(where review_status='verified')
  into v_document_count,v_submitted_count,v_verified_count
  from public.stylist_evidence_documents where stylist_user_id=new.stylist_user_id;

  select exists (
    select 1 from public.stylist_match_verification_snapshots s
    where s.stylist_user_id = new.stylist_user_id
      and s.avg_monthly_technical_sales is not distinct from new.avg_monthly_technical_sales
      and s.avg_monthly_clients is not distinct from new.avg_monthly_clients
      and s.avg_monthly_named_clients is not distinct from new.avg_monthly_named_clients
      and s.average_ticket is not distinct from new.average_ticket
  ) into v_has_matching_snapshot;

  new.verification_status := case
    when not new.wants_performance_offer then 'self_reported'
    when v_document_count=0 then 'self_reported'
    when cardinality(new.consistency_issues)>0 then 'needs_review'
    when v_has_matching_snapshot then 'verified'
    when v_verified_count>0 then 'reverification_needed'
    when v_submitted_count=0 then 'rejected'
    else 'submitted' end;
  return new;
end;
$$;

create table public.salary_offers (
  id uuid primary key default gen_random_uuid(),
  salon_user_id uuid not null references auth.users(id) on delete cascade,
  stylist_user_id uuid not null references auth.users(id) on delete cascade,
  monthly_guarantee integer not null check (monthly_guarantee between 100000 and 2000000),
  performance_addition integer not null default 0 check (performance_addition between 0 and 1000000),
  -- 実績加算の支給条件。「◯万円」という数字だけで承諾できてしまわないよう、
  -- 実績加算 > 0 円の場合は必須にする（下のCHECK制約で強制）。
  performance_condition text check (
    performance_condition is null or char_length(trim(performance_condition)) between 1 and 500
  ),
  guarantee_months integer not null check (guarantee_months in (1,3,6,12)),
  salon_message text check (salon_message is null or char_length(salon_message) <= 500),
  status text not null default 'pending' check (status in ('pending','accepted','revision_requested','declined','withdrawn')),
  response_reason text check (response_reason is null or response_reason in ('workdays','guarantee_period','role','performance_basis','other')),
  response_note text check (response_note is null or char_length(response_note) <= 500),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint salary_offers_condition_required_if_addition check (
    performance_addition = 0
    or (performance_condition is not null and char_length(trim(performance_condition)) > 0)
  )
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
  p_guarantee_months integer, p_performance_condition text, p_salon_message text
) returns public.salary_offers
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.salary_offers;
  v_condition text := nullif(trim(coalesce(p_performance_condition, '')), '');
begin
  if not exists (select 1 from public.user_roles where user_id=v_uid and role='salon') then raise exception 'caller is not a salon'; end if;
  if not exists (select 1 from public.stylist_salon_interests where salon_user_id=v_uid and stylist_user_id=p_stylist_user_id) then raise exception 'interest required'; end if;
  if not exists (select 1 from public.stylist_match_profiles where stylist_user_id=p_stylist_user_id and wants_performance_offer and verification_status='verified') then raise exception 'verified opt-in profile required'; end if;
  if coalesce(p_performance_addition, 0) > 0 and v_condition is null then
    raise exception 'performance condition required when performance addition is greater than zero';
  end if;
  insert into public.salary_offers(salon_user_id,stylist_user_id,monthly_guarantee,performance_addition,performance_condition,guarantee_months,salon_message)
  values(v_uid,p_stylist_user_id,p_monthly_guarantee,coalesce(p_performance_addition,0),v_condition,p_guarantee_months,nullif(trim(coalesce(p_salon_message,'')),''))
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
revoke all on function public.create_salary_offer(uuid,integer,integer,integer,text,text) from public, anon;
grant execute on function public.create_salary_offer(uuid,integer,integer,integer,text,text) to authenticated;
revoke all on function public.respond_salary_offer(uuid,text,text,text) from public, anon;
grant execute on function public.respond_salary_offer(uuid,text,text,text) to authenticated;

-- 0021のreview_stylist_evidence_documentを上書きし、
-- decision='verified'の場合のみスナップショットを作成する処理を追加する。
--
-- ★new27の差し戻しフローへの影響なし: decision='rejected'の分岐は
-- 0021から一切変更していない（資料のreview_status更新のみ）。
-- 末尾のverification_status再計算も、以前のように専用のcase文を
-- ここに複製するのではなく、stylist_match_profilesへの実質no-opな
-- 自列UPDATEでトリガー（trg_stylist_match_verification）を再発火させ、
-- refresh_stylist_match_verification()に判定ロジックを一本化する
-- （register_stylist_evidence_document/delete_stylist_evidence_documentで
-- 既に使われているのと同じ手法）。
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
declare
  v_stylist_uid uuid;
  v_snapshot record;
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

  if p_decision = 'verified' then
    select avg_monthly_technical_sales, avg_monthly_clients, avg_monthly_named_clients, average_ticket
    into v_snapshot
    from public.stylist_match_profiles
    where stylist_user_id = v_stylist_uid;

    insert into public.stylist_match_verification_snapshots (
      stylist_user_id, evidence_document_id,
      avg_monthly_technical_sales, avg_monthly_clients, avg_monthly_named_clients, average_ticket,
      verified_by, verified_at
    ) values (
      v_stylist_uid, p_document_id,
      v_snapshot.avg_monthly_technical_sales, v_snapshot.avg_monthly_clients,
      v_snapshot.avg_monthly_named_clients, v_snapshot.average_ticket,
      auth.uid(), now()
    );
  end if;

  update public.stylist_match_profiles
  set average_ticket = average_ticket
  where stylist_user_id = v_stylist_uid;

  return true;
end;
$$;
-- 引数の型シグネチャ（uuid,text,text,text）は0021から変更していないため、
-- 0021で付与済みのrevoke/grantがそのまま引き継がれる（再付与は不要）。

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
