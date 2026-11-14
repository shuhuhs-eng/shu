-- 0065 適用後の確認（何も変更しない。書き込み・請求・決済・メール送信は一切しない）。0065 の直後に実行する。
-- 一時テーブルは pg_temp 内だけ。出力は PASS / FAIL / INFO の【1つの表だけ】（最後の行が総合判定）。FAIL があれば 0065_rollback.draft.sql を検討。
drop table if exists pg_temp.post_log;
create temp table pg_temp.post_log (n serial, name text, result text, info text);
do $$
declare f text; c int; r text;
  fns text[] := array['admin_billing_summary','admin_list_quotes','admin_list_invoices','admin_get_invoice','admin_list_billable_cases','admin_list_unresolved_billing_cases','company_billing_overview','company_get_invoice'];
begin
  insert into pg_temp.post_log(name, result, info) select '1 0065の関数が8本そろっている', case when (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = any(fns)) = 8 then 'PASS' else 'FAIL' end,
    (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname = any(fns));
  foreach f in array fns loop
    insert into pg_temp.post_log(name, result, info) select '2 SECURITY DEFINER・STABLE・search_path固定: ' || f,
      case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f) and not exists (
        select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f
          and not (p.prosecdef and p.provolatile = 's' and exists (select 1 from unnest(p.proconfig) cf where cf = 'search_path=public, pg_temp'))) then 'PASS' else 'FAIL' end, '';
    insert into pg_temp.post_log(name, result, info) select '3 authenticated のみ実行可（PUBLIC・anon・service_role は不可）: ' || f,
      case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f) and not exists (
        select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f
          and (not has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('service_role', p.oid, 'EXECUTE')
               or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0))) then 'PASS' else 'FAIL' end, '';
  end loop;
  -- 想定した拒否（呼べるだけで、何も読み出さない）
  begin set local role anon; perform public.admin_billing_summary(gen_random_uuid()); reset role;
    insert into pg_temp.post_log(name, result, info) values ('4 anon は運営用の関数を実行できない', 'FAIL', '実行できてしまった');
  exception when others then reset role; insert into pg_temp.post_log(name, result, info) values ('4 anon は運営用の関数を実行できない', case when sqlstate = '42501' then 'PASS' else 'FAIL' end, sqlerrm); end;
  begin set local role anon; perform public.company_get_invoice(gen_random_uuid()); reset role;
    insert into pg_temp.post_log(name, result, info) values ('5 anon は会社用の関数を実行できない', 'FAIL', '実行できてしまった');
  exception when others then reset role; insert into pg_temp.post_log(name, result, info) values ('5 anon は会社用の関数を実行できない', case when sqlstate = '42501' then 'PASS' else 'FAIL' end, sqlerrm); end;
  begin set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid())::text, true); perform public.admin_list_invoices(gen_random_uuid()); reset role;
    insert into pg_temp.post_log(name, result, info) values ('6 運営者でないログイン済みユーザーは運営用の関数を実行できない', 'FAIL', '実行できてしまった');
  exception when others then reset role; insert into pg_temp.post_log(name, result, info) values ('6 運営者でないログイン済みユーザーは運営用の関数を実行できない', case when sqlerrm = 'admin access required' then 'PASS' else 'FAIL' end, sqlerrm); end;
  begin set local role authenticated; perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid())::text, true); perform public.company_billing_overview(gen_random_uuid()); reset role;
    insert into pg_temp.post_log(name, result, info) values ('7 所属していない会社の請求の状況は not found', 'FAIL', '実行できてしまった');
  exception when others then reset role; insert into pg_temp.post_log(name, result, info) values ('7 所属していない会社の請求の状況は not found', case when sqlerrm = 'not found' then 'PASS' else 'FAIL' end, sqlerrm); end;
  -- 既存データを変更していない（適用前の記録と一致を確認）
  insert into pg_temp.post_log(name, result, info) select '8 件数（適用前と一致すること）: ' || x.t, 'INFO', x.c::text
    from (select 'admin_quotes' t, (select count(*) from public.admin_quotes) c union all select 'admin_invoices', (select count(*) from public.admin_invoices)
          union all select 'admin_invoice_lines', (select count(*) from public.admin_invoice_lines) union all select 'admin_invoice_checkouts', (select count(*) from public.admin_invoice_checkouts)
          union all select 'admin_unresolved_billing_cases', (select count(*) from public.admin_unresolved_billing_cases) union all select 'admin_visit_cases', (select count(*) from public.admin_visit_cases)
          union all select 'hiring_success_fees', (select count(*) from public.hiring_success_fees) union all select 'organization_billing_regime', (select count(*) from public.organization_billing_regime)) x;
  insert into pg_temp.post_log(name, result, info) select '8 public の表の数（適用前と一致すること＝0065は表を作らない）', 'INFO', (select count(*)::text from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r','p'));
end $$;
-- 結果は【この1つの表だけ】。BEGIN/ROLLBACK を使わない（結果表を最後の1つにするため）。
select n, name, result, info from (
  select n, name, result, info from pg_temp.post_log
  union all
  select 9999, '【総合判定】' || (select count(*) from pg_temp.post_log where result = 'PASS') || ' PASS / ' || (select count(*) from pg_temp.post_log where result = 'FAIL') || ' FAIL / ' || (select count(*) from pg_temp.post_log where result = 'INFO') || ' INFO',
         case when exists (select 1 from pg_temp.post_log where result = 'FAIL') then 'FAIL' else 'PASS' end, 'FAIL が0件なら問題なし。FAILがあれば 0065_rollback.draft.sql（関数8本のdropのみ）を検討'
) r order by n;
