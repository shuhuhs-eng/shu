-- 0062 の【停止（データを残す）】（草案）。運用開始後に問題が出たときの第一手段。
-- 表・データ・トリガー・内部関数は一切変えない（料金の規則・二重請求防止・ロックはそのまま働く）。
-- アプリから呼べる公開RPCの実行権限だけを外す（請求の作成・見積・決済の開始・会社側の請求一覧が止まる）。
-- 復旧は 0062_resume.draft.sql。完全削除は、データを書き出して保管した後に、人が判断して別途行う。
begin;
revoke execute on function public.admin_propose_quote(uuid, integer, text), public.admin_withdraw_quote(uuid), public.admin_create_invoice(uuid, uuid),
  public.admin_add_fee_line(uuid, text, uuid), public.admin_add_registration_line(uuid), public.admin_void_line(uuid), public.admin_advance_invoice(uuid, text),
  public.company_list_quotes(uuid), public.company_respond_quote(uuid, boolean), public.billing_list_invoices(uuid), public.billing_begin_checkout(uuid),
  public.admin_correct_hire_line(uuid, text), public.admin_recalculate_registration_line(uuid), public.admin_flag_billing_case(uuid, text, text)
  from authenticated;
commit;
