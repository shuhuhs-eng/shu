-- 0112 の巻き戻し草案（未実行）。履歴の表ごと消える（履歴は失われる）。billing_settings の値は変えない。
begin;
drop trigger if exists trg_billing_settings_log_change on public.billing_settings;
drop function if exists public.admin_billing_hire_role_rule_decide();
drop function if exists public.admin_billing_setting_changes_list(integer);
drop function if exists public._billing_setting_log_change();
drop table if exists public.billing_setting_changes;
drop function if exists public._billing_setting_changes_immutable();
commit;
