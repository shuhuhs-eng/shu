-- ============================================================================
-- Beauty Reach — 0040_admin_billing_integrity_checks
--
-- Phase 15。採用成立(store_hiring_processes)と成功報酬(hiring_success_fees)の
-- 不整合を運営者(platform admin)が発見するための「読み取り専用」診断RPC。
--
-- ★状態: 案（未適用・未commit）。Supabaseへは適用しない。
--
-- ★完全read-only:
--   ・INSERT / UPDATE / DELETE を一切行わない（STABLE関数）。自動修復・
--     成功報酬の再生成・請求状況/金額の変更・Stripe・請求書発行は行わない。
--   ・既存テーブル・既存関数・RLS・0001〜0039は変更しない。新規は関数1つだけ。
--
-- ★権限:
--   ・SECURITY DEFINER / search_path 固定。public・anon には実行権を与えない。
--     authenticated には実行権を与えるが、関数内部で必ず is_platform_admin() を
--     確認する（運営者以外は拒否）。
--
-- ★検知するissue（issue_type / severity）:
--   missing_success_fee   critical  hiredなのに成功報酬レコードが無い
--   process_not_hired     critical  成功報酬があるのに採用進捗がhiredではない
--   store_mismatch        critical  成功報酬のstore_idが採用進捗のstore_idと違う
--   stylist_mismatch      critical  成功報酬のstylist_user_idが採用進捗と違う
--   hired_at_mismatch     critical  成功報酬のhired_atが採用進捗のhired_atと違う
--                                   （hired_atは請求の根拠となる採用成立日の証跡）
--   event_status_mismatch warning   成功報酬の状態と、履歴(events)の最新状態が一致しない
--                                   （履歴が1件も無い場合を含む）
--
-- ★検知しないもの（意図的）:
--   ・organization_id の不一致:
--     0039は organization_id を「採用成立時点の請求先」の証跡として固定している。
--     店舗の所属会社が将来変わっても過去の請求先は変わらないのが正しい挙動なので、
--     「現在の salon_stores.organization_id と違う」だけでは異常にしない。
--     成立時点の所属会社を後から再現できる履歴は無く、明らかな不整合を機械的に
--     判定する根拠が無いため、organization_id の検査は行わない
--     （存在しない会社を指す値はFK制約で既に防がれている）。
--   ・同一hiring_process_idに複数の成功報酬: unique制約で起こり得ない。
--   ・fee_statusと金額・日時の不整合: 0039のCHECK制約・guard triggerで防がれている。
--
-- ★返却: jsonb配列。severity（critical→warning）、採用成立日の新しい順。
--   各issueは issue_type / severity / hiring_process_id / success_fee_id /
--   organization_id / store_id / store_name / stylist_name / hired_at / message。
--   organization_id は成功報酬がある場合はその値（請求先の証跡）、無い場合は
--   店舗の現在の所属会社。UUIDは画面の内部キー用で、画面に出す必要は無い。
-- ============================================================================

begin;

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
