-- ============================================================================
-- Beauty Reach — 0041_admin_company_and_hiring_analytics
--
-- 読み取り専用の集計基盤（read-only migration）。次の3つの課題を解消する。
--   A. platform admin が全会社・全店舗を横断して見られない
--   B. 会社の採用分析が「現在のstatus」基準で、面談・内定まで進んだあとに辞退/
--      不採用になった候補者が通過実績から消える
--   C. 会社の採用分析が店舗ごとのRPC呼び出し（N+1）になっている
--
-- ★状態: 案（未適用・未commit）。Supabaseへは適用しない。
--
-- ★完全read-only:
--   ・INSERT / UPDATE / DELETE を一切行わない。RPCはすべてSTABLE。
--   ・テーブル・列・制約・RLS・既存関数は変更しない。0001〜0040は無変更。
--   ・追加するのは関数3つ（RPC 2つ＋段階を数値化する補助関数1つ）だけ。
--   ・新しいindexは追加しない（下の「パフォーマンス」参照）。
--   ・自動修復・billing変更・success fee変更・Stripe・契約プラン・金額ルール・
--     期間別分析・月別推移は含めない。
--
-- ★RPC:
--   1. get_admin_organization_overview()          … 運営者向けの全社サマリー
--   2. get_company_hiring_analytics(p_organization_id uuid default null)
--                                                 … 会社の履歴ベース採用分析
--   （補助）hiring_stage_rank(text)               … 段階の数値化（内部用）
--
-- ★履歴ベースの「到達ステージ」（ever reached）の定義:
--   段階の順位: contacting=1 / interview_scheduled=2 / interview_completed=3 /
--               selection=4 / offered=5 / hired=6。declined・rejected は段階ではない(0)。
--   1つの採用進捗(process)ごとに、
--     到達順位 = max( store_hiring_process_events の from_status / to_status の最大順位,
--                      現在のstatusの順位 )
--   を求める。履歴が主、現在のstatusは「履歴が欠けていても現在の状態より後退させない」
--   ための安全なfallback。1 process = 1 candidate（eventが複数あっても二重に数えない）。
--     候補者数      … store_hiring_processes の行数
--     面談化        … 到達順位 >= 2（面談予定以上に一度でも到達）
--     面談実施      … 到達順位 >= 3
--     選考          … 到達順位 >= 4
--     内定          … 到達順位 >= 5（offeredに一度でも到達。その後declinedでも含む）
--     採用          … 到達順位 >= 6（hiredは終端。現在status=hiredと履歴上のhiredは一致）
--     辞退数/不採用数 … 現在status = declined / rejected
--   例: 面談済み→不採用 の人は 面談化=YES・面談実施=YES・不採用=YES。
--   再開(reopened: declined/rejected→contacting)した人も、過去に到達した段階は維持される。
--   割合はcountを返し、UI側で計算する（候補者数0は画面で「—」）。
--
-- ★organization_idの扱い（混同しない）:
--   ・採用分析・全社サマリーの店舗/候補者数: salon_stores.organization_id（現在の所属会社）。
--   ・請求・成功報酬: hiring_success_fees.organization_id（0039で固定した採用成立時の証跡）。
--
-- ★権限:
--   ・get_admin_organization_overview: is_platform_admin() のみ。
--   ・get_company_hiring_analytics: salon role かつ
--       company_owner / company_admin / recruiting_admin → その会社の全店舗、
--       area_manager → store_members に割当のある店舗だけ。
--       store_manager / recruiter / viewer（店舗レベルの役割のみ）→ 拒否。
--     既存の /salon/company/hiring・analytics の権限（getCompanyHiringScope）と同じ規則。
--     p_organization_id を指定した場合は、その会社で上記の役割を持つ場合のみ。
--     社内メモ(internal_note)・理由(reason_*)・美容師のuser idは返さない。
--   ・どちらもSECURITY DEFINER / search_path固定。public・anonには実行権なし。
--
-- ★パフォーマンス:
--   ・会社分析は1回のRPCで全店舗を集計する（店舗ごとのRPCループ=N+1をやめる）。
--   ・履歴は store_hiring_process_events_process_idx (hiring_process_id, created_at)、
--     processは store_hiring_processes_store_idx系（store_id, status）で足りるため、
--     新しいindexは追加しない（想定: 60店舗・数百〜数千process規模）。
--   ・件数が大きく増えた場合の見直し対象は、要確認候補(attention)の返却件数。
--
-- ★要確認候補（attention）:
--   「面談予定日超過」「長期停滞」のしきい値（日数）はDBに固定しない。進行中の候補の
--   生データ（status / updated_at / interview_at / 店舗 / 美容師名）だけを返し、判定は
--   UI側の定数（現行方針どおり）で行う。
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 補助: 段階の数値化（declined / rejected / 不明は 0）
-- ----------------------------------------------------------------------------
create or replace function public.hiring_stage_rank(p_status text)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_status
    when 'contacting' then 1
    when 'interview_scheduled' then 2
    when 'interview_completed' then 3
    when 'selection' then 4
    when 'offered' then 5
    when 'hired' then 6
    else 0
  end;
$$;
revoke all on function public.hiring_stage_rank(text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 1. get_admin_organization_overview(): 運営者向け全社サマリー
-- ----------------------------------------------------------------------------
create or replace function public.get_admin_organization_overview()
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

  with proc as (
    -- 採用進捗（現在の所属会社で集計）と、履歴ベースの到達順位。
    select s.organization_id, p.id, p.status, p.hired_at, p.updated_at,
           greatest(public.hiring_stage_rank(p.status), coalesce(ev.mr, 0)) as rk
    from public.store_hiring_processes p
    join public.salon_stores s on s.id = p.store_id
    left join (
      select e.hiring_process_id,
             max(greatest(public.hiring_stage_rank(e.to_status), public.hiring_stage_rank(e.from_status))) as mr
      from public.store_hiring_process_events e
      group by e.hiring_process_id
    ) ev on ev.hiring_process_id = p.id
  ),
  proc_agg as (
    select organization_id,
           count(*) as candidate_count,
           count(*) filter (where rk >= 2) as interview_count,
           count(*) filter (where rk >= 5) as offered_count,
           count(*) filter (where rk >= 6) as hired_count,
           max(hired_at) filter (where status = 'hired') as latest_hired_at,
           max(updated_at) as latest_activity_at
    from proc
    group by organization_id
  ),
  store_agg as (
    select organization_id,
           count(*) as store_count,
           count(*) filter (where usage_status = 'active') as active_store_count
    from public.salon_stores
    group by organization_id
  ),
  fee_agg as (
    -- 請求は成功報酬に固定した organization_id（採用成立時の証跡）で集計する。
    select organization_id,
           count(*) as success_fee_count,
           count(*) filter (where fee_status = 'pending_confirmation') as pending_confirmation_count,
           count(*) filter (where fee_status = 'confirmed') as confirmed_count,
           count(*) filter (where fee_status = 'invoiced') as invoiced_count,
           count(*) filter (where fee_status = 'paid') as paid_count,
           count(*) filter (where fee_status = 'waived') as waived_count,
           count(*) filter (where fee_status = 'cancelled') as cancelled_count,
           coalesce(sum(total_amount) filter (where fee_status in ('confirmed', 'invoiced', 'paid')), 0) as confirmed_total_amount,
           coalesce(sum(total_amount) filter (where fee_status in ('invoiced', 'paid')), 0) as invoiced_total_amount,
           coalesce(sum(total_amount) filter (where fee_status = 'paid'), 0) as paid_total_amount
    from public.hiring_success_fees
    group by organization_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'organization_id', o.id,
    'organization_name', o.name,
    'store_count', coalesce(sa.store_count, 0),
    'active_store_count', coalesce(sa.active_store_count, 0),
    'candidate_count', coalesce(pa.candidate_count, 0),
    'interview_count', coalesce(pa.interview_count, 0),
    'offered_count', coalesce(pa.offered_count, 0),
    'hired_count', coalesce(pa.hired_count, 0),
    'latest_hired_at', pa.latest_hired_at,
    'latest_activity_at', pa.latest_activity_at,
    'success_fee_count', coalesce(fa.success_fee_count, 0),
    'pending_confirmation_count', coalesce(fa.pending_confirmation_count, 0),
    'confirmed_count', coalesce(fa.confirmed_count, 0),
    'invoiced_count', coalesce(fa.invoiced_count, 0),
    'paid_count', coalesce(fa.paid_count, 0),
    'waived_count', coalesce(fa.waived_count, 0),
    'cancelled_count', coalesce(fa.cancelled_count, 0),
    'confirmed_total_amount', coalesce(fa.confirmed_total_amount, 0),
    'invoiced_total_amount', coalesce(fa.invoiced_total_amount, 0),
    'paid_total_amount', coalesce(fa.paid_total_amount, 0)
  ) order by o.name, o.id), '[]'::jsonb)
  into v_result
  from public.salon_organizations o
  left join store_agg sa on sa.organization_id = o.id
  left join proc_agg pa on pa.organization_id = o.id
  left join fee_agg fa on fa.organization_id = o.id;

  return v_result;
end;
$$;
revoke all on function public.get_admin_organization_overview() from public, anon;
grant execute on function public.get_admin_organization_overview() to authenticated;

-- ----------------------------------------------------------------------------
-- 2. get_company_hiring_analytics(): 会社の履歴ベース採用分析（1回で全店舗）
--    返却: { total, by_source, by_store, attention }
-- ----------------------------------------------------------------------------
create or replace function public.get_company_hiring_analytics(p_organization_id uuid default null)
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

  -- 会社分析に入れる役割（company_owner / company_admin / recruiting_admin / area_manager）。
  -- store_manager / recruiter / viewer（店舗レベルの役割のみ）は拒否。
  if not exists (
    select 1 from public.organization_members om
    where om.user_id = v_uid
      and om.role in ('company_owner', 'company_admin', 'recruiting_admin', 'area_manager')
      and (p_organization_id is null or om.organization_id = p_organization_id)
  ) then
    raise exception 'company analytics not accessible';
  end if;

  -- 読み取り専用（STABLE）のため、一時テーブルは使わず1つのクエリ（CTE）で集計する。
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
          and exists (
            select 1 from public.store_members sm where sm.store_id = s.id and sm.user_id = v_uid
          )
        )
      )
  ),
  base as (
    select p.id, p.store_id, p.stylist_user_id, p.source, p.status, p.updated_at, p.interview_at
    from public.store_hiring_processes p
    join scope on scope.store_id = p.store_id
  ),
  ev as (
    select e.hiring_process_id,
           max(greatest(public.hiring_stage_rank(e.to_status), public.hiring_stage_rank(e.from_status))) as mr
    from public.store_hiring_process_events e
    join base on base.id = e.hiring_process_id
    group by e.hiring_process_id
  ),
  proc as (
    -- 1 process = 1 candidate。到達順位 = max(履歴の最大順位, 現在statusの順位)。
    select b.id as process_id, b.store_id, b.stylist_user_id, b.source, b.status,
           b.updated_at, b.interview_at,
           greatest(public.hiring_stage_rank(b.status), coalesce(ev.mr, 0)) as rk
    from base b
    left join ev on ev.hiring_process_id = b.id
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
    from proc
  ),
  src_agg as (
    select source,
           count(*) as candidate_count,
           count(*) filter (where rk >= 2) as interview_reached_count,
           count(*) filter (where rk >= 3) as interview_completed_count,
           count(*) filter (where rk >= 5) as offered_count,
           count(*) filter (where rk >= 6) as hired_count
    from proc
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
    from proc
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
  ),
  att as (
    -- 要確認候補の生データ（進行中のみ）。しきい値の判定はUI側（DBに固定しない）。
    select coalesce(jsonb_agg(jsonb_build_object(
      'process_id', pr.process_id,
      'store_id', pr.store_id,
      'store_name', sc.store_name,
      'stylist_name', sp.public_name,
      'status', pr.status,
      'updated_at', pr.updated_at,
      'interview_at', pr.interview_at
    ) order by pr.updated_at, pr.process_id), '[]'::jsonb) as j
    from proc pr
    join scope sc on sc.store_id = pr.store_id
    left join public.stylist_profiles sp on sp.user_id = pr.stylist_user_id
    where pr.status in ('contacting', 'interview_scheduled', 'interview_completed', 'selection', 'offered')
  )
  select jsonb_build_object(
    'total', tot.j,
    'by_source', by_source.j,
    'by_store', by_store.j,
    'attention', att.j
  )
  into v_result
  from tot, by_source, by_store, att;

  return v_result;
end;
$$;
revoke all on function public.get_company_hiring_analytics(uuid) from public, anon;
grant execute on function public.get_company_hiring_analytics(uuid) to authenticated;

commit;
