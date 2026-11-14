-- 0064_suspend_keep_guard の復旧（草案）: 切替の操作の実行権限を authenticated に戻す（関数内で運営者権限を再確認する）。
begin;
grant execute on function public.admin_set_billing_regime(uuid, timestamptz), public.admin_set_process_billing_basis(uuid, text, text) to authenticated;
commit;
