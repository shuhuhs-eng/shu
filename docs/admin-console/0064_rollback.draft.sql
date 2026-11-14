-- 0064 の巻き戻し（草案）。トリガーと新関数を外し、0040の元の定義を戻す。記録表（切替・案件判定）は【残す】（切替の事実を失わないため）。
-- ★巻き戻すと、新方式の会社では旧成功報酬の自動作成・確定・決済の抑止が外れ、二重請求を防げなくなる。
--   そのため【このSQL自身が確認し】、切替の記録・案件ごとの判定・有効な新採用料の行のどれかがあれば、何も変更せずに中止する。
--   運用開始後に止めたいときは、これではなく 0064_suspend_keep_guard.draft.sql（記録と二重請求防止を残したまま、切替の操作だけを止める）を使う。
begin;
do $$
declare n_regime int := 0; n_basis int := 0; n_lines int := 0;
begin
  if to_regclass('public.organization_billing_regime') is not null then execute 'select count(*) from public.organization_billing_regime' into n_regime; end if;
  if to_regclass('public.hiring_process_billing_basis') is not null then execute 'select count(*) from public.hiring_process_billing_basis' into n_basis; end if;
  if to_regclass('public.admin_invoice_lines') is not null then
    execute $q$select count(*) from public.admin_invoice_lines where fee_kind in ('hire_stylist','hire_assistant') and voided_at is null$q$ into n_lines;
  end if;
  if n_regime > 0 or n_basis > 0 or n_lines > 0 then
    raise exception '0064 の巻き戻しを中止しました（切替の記録 % 件・案件ごとの判定 % 件・有効な新採用料の行 % 件）。二重請求の防止が外れるため、何も変更していません。0064_suspend_keep_guard を使ってください', n_regime, n_basis, n_lines;
  end if;
end $$;
drop trigger if exists trg_admin_invoice_lines_regime_guard on public.admin_invoice_lines;
drop trigger if exists trg_stripe_checkout_basis on public.stripe_checkout_records;
drop trigger if exists trg_hiring_success_fees_basis_update on public.hiring_success_fees;
drop trigger if exists trg_hiring_success_fees_basis_insert on public.hiring_success_fees;
drop function if exists public._trg_hire_line_regime_guard();
drop function if exists public._trg_checkout_basis();
drop function if exists public._trg_fee_update_basis();
drop function if exists public._trg_fee_insert_basis();
drop function if exists public._hiring_has_active_hire_line(uuid);
drop function if exists public._hiring_process_basis(uuid);
drop function if exists public._billing_regime_active(uuid, timestamptz);
drop function if exists public._hiring_lock(uuid);
drop function if exists public.admin_set_billing_regime(uuid, timestamptz);
drop function if exists public.admin_set_process_billing_basis(uuid, text, text);
drop function if exists public.admin_billing_regime_status(uuid);
-- 0040 の元の定義
create or replace function public.get_admin_billing_integrity_issues()
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

  with issues as (
    -- 1. hiredなのに成功報酬が無い
    select 'missing_success_fee'::text as issue_type, 'critical'::text as severity,
           p.id as hiring_process_id, null::uuid as success_fee_id,
           s.organization_id, p.store_id, p.stylist_user_id,
           p.hired_at,
           '採用が成立していますが、成功報酬の記録がありません。'::text as message
    from public.store_hiring_processes p
    join public.salon_stores s on s.id = p.store_id
    where p.status = 'hired'
      and not exists (select 1 from public.hiring_success_fees f where f.hiring_process_id = p.id)

    union all
    -- 2. 成功報酬があるのに採用進捗がhiredではない
    select 'process_not_hired', 'critical',
           f.hiring_process_id, f.id, f.organization_id, f.store_id, f.stylist_user_id, f.hired_at,
           '成功報酬の記録がありますが、対応する採用進捗が「採用」になっていません。'
    from public.hiring_success_fees f
    join public.store_hiring_processes p on p.id = f.hiring_process_id
    where p.status <> 'hired'

    union all
    -- 3. store_idの不一致
    select 'store_mismatch', 'critical',
           f.hiring_process_id, f.id, f.organization_id, f.store_id, f.stylist_user_id, f.hired_at,
           '成功報酬の店舗が、採用進捗の店舗と一致しません。'
    from public.hiring_success_fees f
    join public.store_hiring_processes p on p.id = f.hiring_process_id
    where f.store_id <> p.store_id

    union all
    -- 4. stylist_user_idの不一致
    select 'stylist_mismatch', 'critical',
           f.hiring_process_id, f.id, f.organization_id, f.store_id, f.stylist_user_id, f.hired_at,
           '成功報酬の美容師が、採用進捗の美容師と一致しません。'
    from public.hiring_success_fees f
    join public.store_hiring_processes p on p.id = f.hiring_process_id
    where f.stylist_user_id <> p.stylist_user_id

    union all
    -- 6. hired_atの不一致（採用進捗のhired_atが空の場合も不一致として扱う）
    select 'hired_at_mismatch', 'critical',
           f.hiring_process_id, f.id, f.organization_id, f.store_id, f.stylist_user_id, f.hired_at,
           '成功報酬の採用成立日が、採用進捗の採用成立日と一致しません。'
    from public.hiring_success_fees f
    join public.store_hiring_processes p on p.id = f.hiring_process_id
    where f.hired_at is distinct from p.hired_at

    union all
    -- 履歴との不整合（成功報酬の状態と最新eventのto_statusが違う／履歴が無い）
    select 'event_status_mismatch', 'warning',
           f.hiring_process_id, f.id, f.organization_id, f.store_id, f.stylist_user_id, f.hired_at,
           case when le.to_status is null
                then '成功報酬の履歴が記録されていません。'
                else '成功報酬の状態が、履歴の最新の状態と一致しません。' end
    from public.hiring_success_fees f
    left join lateral (
      select e.to_status
      from public.hiring_success_fee_events e
      where e.success_fee_id = f.id
      order by e.created_at desc, e.id desc
      limit 1
    ) le on true
    where le.to_status is distinct from f.fee_status
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'issue_type', i.issue_type,
    'severity', i.severity,
    'hiring_process_id', i.hiring_process_id,
    'success_fee_id', i.success_fee_id,
    'organization_id', i.organization_id,
    'store_id', i.store_id,
    'store_name', st.store_name,
    'stylist_name', sp.public_name,
    'hired_at', i.hired_at,
    'message', i.message
  ) order by (i.severity = 'critical') desc, i.hired_at desc nulls last, i.issue_type), '[]'::jsonb)
  into v_result
  from issues i
  left join public.salon_stores st on st.id = i.store_id
  left join public.stylist_profiles sp on sp.user_id = i.stylist_user_id;

  return v_result;
end;
$$;
revoke all on function public.get_admin_billing_integrity_issues() from public, anon;
grant execute on function public.get_admin_billing_integrity_issues() to authenticated;

commit;
