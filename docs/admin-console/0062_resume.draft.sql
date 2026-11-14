-- 0062 の【再開】（草案）。0062_suspend_keep_data で外した公開RPCの実行権限を、authenticated にだけ戻す。
begin;
grant execute on function public.admin_propose_quote(uuid, integer, text), public.admin_withdraw_quote(uuid), public.admin_create_invoice(uuid, uuid),
  public.admin_add_fee_line(uuid, text, uuid), public.admin_add_registration_line(uuid), public.admin_void_line(uuid), public.admin_advance_invoice(uuid, text),
  public.company_list_quotes(uuid), public.company_respond_quote(uuid, boolean), public.billing_list_invoices(uuid), public.billing_begin_checkout(uuid),
  public.admin_correct_hire_line(uuid, text), public.admin_recalculate_registration_line(uuid), public.admin_flag_billing_case(uuid, text, text)
  to authenticated;
commit;
