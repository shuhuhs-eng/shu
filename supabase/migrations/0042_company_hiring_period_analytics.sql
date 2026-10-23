-- ============================================================================
-- Beauty Reach — 0042_company_hiring_period_analytics
--
-- 期間別の採用分析（今月・先月・直近3ヶ月・年度など）と、運営者向けの会社の店舗一覧。
-- すべて読み取り専用。
--
-- ★状態: 案（未適用・未commit）。Supabaseへは適用しない。
--
-- ★完全read-only: 関数3つの追加のみ（すべてSTABLE）。INSERT/UPDATE/DELETEなし。
--   テーブル・列・制約・RLS・既存関数は変更しない（0001〜0041は無変更）。新規indexなし。
--   0041の補助関数 hiring_stage_rank(text) を使う。
--
-- ★RPC:
--   1. get_company_hiring_period_analytics(p_from, p_to, p_organization_id)
--        … A. 活動ベース分析（その期間に初めてその段階へ到達した人数）
--   2. get_company_hiring_cohort_analytics(p_from, p_to, p_organization_id)
--        … B. 候補者獲得コホート分析（期間内に候補追加された人の、現在までの到達結果＝通過率の母集団）
--   3. get_admin_organization_stores(p_organization_id)
--        … 運営者向け：会社の店舗一覧と採用の基本件数
--   ※ 保守性を優先し、活動とコホートは別RPCに分けた（母集団の定義が違うため、1つにまとめると
--     SQLが読みにくくなる）。
--
-- ★時刻の正（推測で補正しない）:
--   ・stage到達日 = store_hiring_process_events.created_at のうち、そのstage以上のstatusへ
--     入ったeventの最も早い時刻。現在行の updated_at や interview_at（面談を行う予定日時）は使わない。
--   ・候補者獲得日 = event_type='candidate_added' の最初の created_at。
--     candidate_added の履歴が無い古い採用進捗は、created_at 等で補完せず「日付不明」として別に数える。
--
-- ★A. 活動ベース（activity）:
--   期間 p_from <= created_at < p_to に、その採用進捗がそのstageへ「初めて到達」した件数。
--   1 process につき各stage 1回だけ（戻って再到達しても二重に数えない）。
--     added = candidate_added の初回が期間内 / interview_reached = 順位>=2 の初到達が期間内 /
--     interview_completed = >=3 / selection = >=4 / offered = >=5 / hired = >=6
--     declined / rejected = 期間内にそのeventがある採用進捗（1件1回）
--   「今月、採用活動がどれくらい動いたか」を見る数字であり、各行は同じ母集団ではないため、
--   行どうしの割合（通過率）にはしない。
--
-- ★B. 候補者獲得コホート（cohort）:
--   母集団 = candidate_added の初回が期間内の採用進捗。その人たちが「現在までに一度でも」
--   到達した段階を、履歴ベース（0041と同じ：履歴の最大順位と現在statusの順位の大きい方）で数える。
--   candidate_count / interview_reached / interview_completed / selection / offered / hired は
--   ever-reached、declined / rejected は現在のstatus。割合はUIで計算（候補者0は「—」）。
--   最近のコホートは選考途中の人を含むため採用率が低く見える（UIで注記する前提）。
--
-- ★日付不明（unknown）:
--   ・activity.unknown_dates … candidate_added が無い採用進捗の数（added として数えない）／
--     履歴が1件も無い採用進捗の数（どのstageにも日付を当てられない）。
--   ・cohort.unknown_dates … candidate_added が無く、コホートに入れられない採用進捗の数。
--
-- ★期間: p_from（含む）〜 p_to（含まない）のtimestamptz。p_from < p_to が必要。
--   「今月」「先月」「直近3ヶ月」「年度」の境界は呼び出し側で決める。DBには年度の開始月などの
--   業務ルールを持たせない（UI側の定数。会社ごとの年度設定は後続Phase）。
--
-- ★権限・範囲（1・2）: 0041 get_company_hiring_analytics と同じ。
--   salon role かつ company_owner / company_admin / recruiting_admin（自社全店舗）、
--   area_manager（store_members に割当のある店舗のみ）。店舗レベルの役割のみは拒否。
--   p_organization_id 指定時はその会社の役割が必要。採用分析なので現在の所属会社
--   （salon_stores.organization_id）基準。社内メモ・理由・美容師のuser idは返さない。
--
-- ★権限（3. get_admin_organization_stores）:
--   is_platform_admin() のみ。SECURITY DEFINER / search_path固定。public・anon不可、
--   authenticated にEXECUTEを与え、内部で必ず is_platform_admin() を確認。
--   返すのは店舗の基本情報（store_id / store_name / usage_status / created_at）と採用の件数
--   （candidate_count / active_candidate_count / hired_count / latest_activity_at）だけ。
--   internal_note・reason_note・candidate_message・証憑・個人情報の詳細・スタッフの内部情報・
--   給与オファーの詳細・スカウト本文は返さない（運営者だから何でも見せる設計にはしない）。
--
-- ★パフォーマンス: eventsは store_hiring_process_events_process_idx
--   (hiring_process_id, created_at) で採用進捗ごとに引ける。期間の絞り込みは採用進捗ごとの集計後に
--   行うため、新しいindexは追加しない。
-- ============================================================================

begin;

create or replace function public.get_company_hiring_period_analytics(
  p_from timestamptz,
  p_to timestamptz,
  p_organization_id uuid default null
)
returns jsonb
language plpgsql
stable
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
  if p_from is null or p_to is null or p_from >= p_to then
    raise exception 'invalid period';
  end if;
  if not exists (
    select 1 from public.organization_members om
    where om.user_id = v_uid
      and om.role in ('company_owner', 'company_admin', 'recruiting_admin', 'area_manager')
      and (p_organization_id is null or om.organization_id = p_organization_id)
  ) then
    raise exception 'company analytics not accessible';
  end if;

  with scope as (
    select s.id as store_id, s.store_name, s.organization_id, o.name as organization_name
    from public.salon_stores s
    join public.salon_organizations o on o.id = s.organization_id
    where (p_organization_id is null or s.organization_id = p_organization_id)
      and (
        exists (
          select 1 from public.organization_members om
          where om.organization_id = s.organization_id and om.user_id = v_uid
            and om.role in ('company_owner', 'company_admin', 'recruiting_admin')
        )
        or (
          exists (
            select 1 from public.organization_members om
            where om.organization_id = s.organization_id and om.user_id = v_uid and om.role = 'area_manager'
          )
          and exists (select 1 from public.store_members sm where sm.store_id = s.id and sm.user_id = v_uid)
        )
      )
  ),
  base as (
    select p.id, p.store_id, p.source
    from public.store_hiring_processes p
    join scope on scope.store_id = p.store_id
  ),
  reach as (
    -- 採用進捗ごとの「初到達日」。履歴が無い採用進捗はここに現れない。
    select e.hiring_process_id,
           min(e.created_at) filter (where e.event_type = 'candidate_added') as added_at,
           min(e.created_at) filter (where public.hiring_stage_rank(e.to_status) >= 2) as interview_reached_at,
           min(e.created_at) filter (where public.hiring_stage_rank(e.to_status) >= 3) as interview_completed_at,
           min(e.created_at) filter (where public.hiring_stage_rank(e.to_status) >= 4) as selection_at,
           min(e.created_at) filter (where public.hiring_stage_rank(e.to_status) >= 5) as offered_at,
           min(e.created_at) filter (where public.hiring_stage_rank(e.to_status) >= 6) as hired_at,
           bool_or(e.event_type = 'declined' and e.created_at >= p_from and e.created_at < p_to) as declined_in_period,
           bool_or(e.event_type = 'rejected' and e.created_at >= p_from and e.created_at < p_to) as rejected_in_period
    from public.store_hiring_process_events e
    join base on base.id = e.hiring_process_id
    group by e.hiring_process_id
  ),
  flow as (
    select b.id, b.store_id, b.source,
           (r.hiring_process_id is null) as no_events,
           (r.added_at is null) as no_candidate_added,
           coalesce(r.added_at >= p_from and r.added_at < p_to, false) as f_added,
           coalesce(r.interview_reached_at >= p_from and r.interview_reached_at < p_to, false) as f_interview,
           coalesce(r.interview_completed_at >= p_from and r.interview_completed_at < p_to, false) as f_completed,
           coalesce(r.selection_at >= p_from and r.selection_at < p_to, false) as f_selection,
           coalesce(r.offered_at >= p_from and r.offered_at < p_to, false) as f_offered,
           coalesce(r.hired_at >= p_from and r.hired_at < p_to, false) as f_hired,
           coalesce(r.declined_in_period, false) as f_declined,
           coalesce(r.rejected_in_period, false) as f_rejected
    from base b
    left join reach r on r.hiring_process_id = b.id
  ),
  act as (
    select jsonb_build_object(
      'added_count', count(*) filter (where f_added),
      'interview_reached_count', count(*) filter (where f_interview),
      'interview_completed_count', count(*) filter (where f_completed),
      'selection_count', count(*) filter (where f_selection),
      'offered_count', count(*) filter (where f_offered),
      'hired_count', count(*) filter (where f_hired),
      'declined_count', count(*) filter (where f_declined),
      'rejected_count', count(*) filter (where f_rejected)
    ) as j,
    jsonb_build_object(
      'no_candidate_added_count', count(*) filter (where no_candidate_added),
      'no_events_count', count(*) filter (where no_events)
    ) as unk
    from flow
  ),
  src_agg as (
    select source,
           count(*) filter (where f_added) as added_count,
           count(*) filter (where f_interview) as interview_reached_count,
           count(*) filter (where f_completed) as interview_completed_count,
           count(*) filter (where f_offered) as offered_count,
           count(*) filter (where f_hired) as hired_count
    from flow
    group by source
  ),
  by_source as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'source', src.source,
      'added_count', coalesce(a.added_count, 0),
      'interview_reached_count', coalesce(a.interview_reached_count, 0),
      'interview_completed_count', coalesce(a.interview_completed_count, 0),
      'offered_count', coalesce(a.offered_count, 0),
      'hired_count', coalesce(a.hired_count, 0)
    ) order by src.ord), '[]'::jsonb) as j
    from (values ('interest', 1), ('scout', 2), ('salary_offer', 3)) as src(source, ord)
    left join src_agg a on a.source = src.source
  ),
  store_agg as (
    select store_id,
           count(*) filter (where f_added) as added_count,
           count(*) filter (where f_interview) as interview_reached_count,
           count(*) filter (where f_completed) as interview_completed_count,
           count(*) filter (where f_selection) as selection_count,
           count(*) filter (where f_offered) as offered_count,
           count(*) filter (where f_hired) as hired_count,
           count(*) filter (where f_declined) as declined_count,
           count(*) filter (where f_rejected) as rejected_count
    from flow
    group by store_id
  ),
  by_store as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'store_id', sc.store_id,
      'store_name', sc.store_name,
      'organization_id', sc.organization_id,
      'organization_name', sc.organization_name,
      'added_count', coalesce(a.added_count, 0),
      'interview_reached_count', coalesce(a.interview_reached_count, 0),
      'interview_completed_count', coalesce(a.interview_completed_count, 0),
      'selection_count', coalesce(a.selection_count, 0),
      'offered_count', coalesce(a.offered_count, 0),
      'hired_count', coalesce(a.hired_count, 0),
      'declined_count', coalesce(a.declined_count, 0),
      'rejected_count', coalesce(a.rejected_count, 0)
    ) order by sc.organization_name, sc.store_name, sc.store_id), '[]'::jsonb) as j
    from scope sc
    left join store_agg a on a.store_id = sc.store_id
  )
  select jsonb_build_object(
    'period_from', p_from,
    'period_to', p_to,
    'activity', act.j,
    'by_source', by_source.j,
    'by_store', by_store.j,
    'unknown_dates', act.unk
  )
  into v_result
  from act, by_source, by_store;

  return v_result;
end;
$$;
revoke all on function public.get_company_hiring_period_analytics(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.get_company_hiring_period_analytics(timestamptz, timestamptz, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. get_company_hiring_cohort_analytics(): 候補者獲得コホート（通過率の母集団）
-- ----------------------------------------------------------------------------
create or replace function public.get_company_hiring_cohort_analytics(
  p_from timestamptz,
  p_to timestamptz,
  p_organization_id uuid default null
)
returns jsonb
language plpgsql
stable
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
  if p_from is null or p_to is null or p_from >= p_to then
    raise exception 'invalid period';
  end if;
  if not exists (
    select 1 from public.organization_members om
    where om.user_id = v_uid
      and om.role in ('company_owner', 'company_admin', 'recruiting_admin', 'area_manager')
      and (p_organization_id is null or om.organization_id = p_organization_id)
  ) then
    raise exception 'company analytics not accessible';
  end if;

  with scope as (
    select s.id as store_id, s.store_name, s.organization_id, o.name as organization_name
    from public.salon_stores s
    join public.salon_organizations o on o.id = s.organization_id
    where (p_organization_id is null or s.organization_id = p_organization_id)
      and (
        exists (
          select 1 from public.organization_members om
          where om.organization_id = s.organization_id and om.user_id = v_uid
            and om.role in ('company_owner', 'company_admin', 'recruiting_admin')
        )
        or (
          exists (
            select 1 from public.organization_members om
            where om.organization_id = s.organization_id and om.user_id = v_uid and om.role = 'area_manager'
          )
          and exists (select 1 from public.store_members sm where sm.store_id = s.id and sm.user_id = v_uid)
        )
      )
  ),
  base as (
    select p.id, p.store_id, p.source, p.status
    from public.store_hiring_processes p
    join scope on scope.store_id = p.store_id
  ),
  ev as (
    select e.hiring_process_id,
           min(e.created_at) filter (where e.event_type = 'candidate_added') as added_at,
           max(greatest(public.hiring_stage_rank(e.to_status), public.hiring_stage_rank(e.from_status))) as mr
    from public.store_hiring_process_events e
    join base on base.id = e.hiring_process_id
    group by e.hiring_process_id
  ),
  proc as (
    select b.id, b.store_id, b.source, b.status, ev.added_at,
           greatest(public.hiring_stage_rank(b.status), coalesce(ev.mr, 0)) as rk
    from base b
    left join ev on ev.hiring_process_id = b.id
  ),
  cohort as (
    select * from proc where added_at >= p_from and added_at < p_to
  ),
  tot as (
    select jsonb_build_object(
      'candidate_count', count(*),
      'interview_reached_count', count(*) filter (where rk >= 2),
      'interview_completed_count', count(*) filter (where rk >= 3),
      'selection_count', count(*) filter (where rk >= 4),
      'offered_count', count(*) filter (where rk >= 5),
      'hired_count', count(*) filter (where rk >= 6),
      'declined_count', count(*) filter (where status = 'declined'),
      'rejected_count', count(*) filter (where status = 'rejected')
    ) as j
    from cohort
  ),
  unk as (
    select jsonb_build_object('cohort_date_unknown_count', count(*) filter (where added_at is null)) as j
    from proc
  ),
  src_agg as (
    select source,
           count(*) as candidate_count,
           count(*) filter (where rk >= 2) as interview_reached_count,
           count(*) filter (where rk >= 3) as interview_completed_count,
           count(*) filter (where rk >= 5) as offered_count,
           count(*) filter (where rk >= 6) as hired_count
    from cohort
    group by source
  ),
  by_source as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'source', src.source,
      'candidate_count', coalesce(a.candidate_count, 0),
      'interview_reached_count', coalesce(a.interview_reached_count, 0),
      'interview_completed_count', coalesce(a.interview_completed_count, 0),
      'offered_count', coalesce(a.offered_count, 0),
      'hired_count', coalesce(a.hired_count, 0)
    ) order by src.ord), '[]'::jsonb) as j
    from (values ('interest', 1), ('scout', 2), ('salary_offer', 3)) as src(source, ord)
    left join src_agg a on a.source = src.source
  ),
  store_agg as (
    select store_id,
           count(*) as candidate_count,
           count(*) filter (where rk >= 2) as interview_reached_count,
           count(*) filter (where rk >= 3) as interview_completed_count,
           count(*) filter (where rk >= 4) as selection_count,
           count(*) filter (where rk >= 5) as offered_count,
           count(*) filter (where rk >= 6) as hired_count,
           count(*) filter (where status = 'declined') as declined_count,
           count(*) filter (where status = 'rejected') as rejected_count
    from cohort
    group by store_id
  ),
  by_store as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'store_id', sc.store_id,
      'store_name', sc.store_name,
      'organization_id', sc.organization_id,
      'organization_name', sc.organization_name,
      'candidate_count', coalesce(a.candidate_count, 0),
      'interview_reached_count', coalesce(a.interview_reached_count, 0),
      'interview_completed_count', coalesce(a.interview_completed_count, 0),
      'selection_count', coalesce(a.selection_count, 0),
      'offered_count', coalesce(a.offered_count, 0),
      'hired_count', coalesce(a.hired_count, 0),
      'declined_count', coalesce(a.declined_count, 0),
      'rejected_count', coalesce(a.rejected_count, 0)
    ) order by sc.organization_name, sc.store_name, sc.store_id), '[]'::jsonb) as j
    from scope sc
    left join store_agg a on a.store_id = sc.store_id
  )
  select jsonb_build_object(
    'period_from', p_from,
    'period_to', p_to,
    'cohort', tot.j,
    'by_source', by_source.j,
    'by_store', by_store.j,
    'unknown_dates', unk.j
  )
  into v_result
  from tot, by_source, by_store, unk;

  return v_result;
end;
$$;
revoke all on function public.get_company_hiring_cohort_analytics(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.get_company_hiring_cohort_analytics(timestamptz, timestamptz, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. get_admin_organization_stores(): 運営者向け 会社の店舗一覧（基本情報と採用件数のみ）
-- ----------------------------------------------------------------------------
create or replace function public.get_admin_organization_stores(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if p_organization_id is null
     or not exists (select 1 from public.salon_organizations where id = p_organization_id) then
    raise exception 'organization not found';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'store_id', s.id,
    'store_name', s.store_name,
    'usage_status', s.usage_status,
    'created_at', s.created_at,
    'candidate_count', coalesce(a.candidate_count, 0),
    'active_candidate_count', coalesce(a.active_candidate_count, 0),
    'hired_count', coalesce(a.hired_count, 0),
    'latest_activity_at', a.latest_activity_at
  ) order by s.store_name, s.id), '[]'::jsonb)
  into v_result
  from public.salon_stores s
  left join (
    select p.store_id,
           count(*) as candidate_count,
           count(*) filter (where p.status in ('contacting', 'interview_scheduled', 'interview_completed', 'selection', 'offered')) as active_candidate_count,
           count(*) filter (where p.status = 'hired') as hired_count,
           max(p.updated_at) as latest_activity_at
    from public.store_hiring_processes p
    group by p.store_id
  ) a on a.store_id = s.id
  where s.organization_id = p_organization_id;

  return v_result;
end;
$$;
revoke all on function public.get_admin_organization_stores(uuid) from public, anon;
grant execute on function public.get_admin_organization_stores(uuid) to authenticated;

commit;
