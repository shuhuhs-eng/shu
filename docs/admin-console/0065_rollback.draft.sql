-- 0065 の取り消し（ローカル確認用の草案・未適用）。0065 は読み取り専用の関数8本だけを追加するため、関数を削除するだけで元に戻る。
-- 表・データ・0062〜0064 のオブジェクトには一切触れない。
begin;
drop function if exists public.admin_billing_summary(uuid);
drop function if exists public.admin_list_quotes(uuid, integer, integer);
drop function if exists public.admin_list_invoices(uuid, text, integer, integer);
drop function if exists public.admin_get_invoice(uuid);
drop function if exists public.admin_list_billable_cases(uuid, integer, integer);
drop function if exists public.admin_list_unresolved_billing_cases(uuid, boolean, integer, integer);
drop function if exists public.company_billing_overview(uuid);
drop function if exists public.company_get_invoice(uuid);
commit;
