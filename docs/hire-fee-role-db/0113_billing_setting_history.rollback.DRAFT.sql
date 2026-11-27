-- 0113 の巻き戻し草案（未実行）。★変更履歴（billing_setting_changes の行）は削除しない。billing_settings の値も変えない。
-- 外すもの: 履歴を記録するトリガーと関数、履歴の一覧関数、採用料の登録区分ルールの決定関数。
-- 残すもの: 履歴の表（行ごと）と、その追記専用トリガー・関数（巻き戻し後も更新・削除できない）。
-- 注意: 巻き戻し中は新しい変更が履歴に記録されない。再適用すると、残った表をそのまま使って記録が続く（0113の再適用に対応）。
begin;
set local lock_timeout = '5s';
do $chk$
begin
  if to_regclass('public.billing_setting_changes') is null then raise exception '履歴の表がありません（0113が適用されていない可能性）。中止します'; end if;
end $chk$;
create temp table _hist_before on commit drop as select count(*) as n, coalesce(max(id), 0) as max_id from public.billing_setting_changes;
drop trigger if exists trg_billing_settings_log_change on public.billing_settings;
drop function if exists public.admin_billing_hire_role_rule_decide();
drop function if exists public.admin_billing_setting_changes_list(integer);
drop function if exists public._billing_setting_log_change();
do $post$
declare b record;
begin
  select * into b from _hist_before;
  if (select count(*) from public.billing_setting_changes) <> b.n then raise exception '履歴の件数が変わっています。全体を戻します'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_billing_setting_changes_immutable' and not tgisinternal) then raise exception '追記専用トリガーがありません。全体を戻します'; end if;
end $post$;
select 'OK: 0113 rolled back; history rows kept = ' || (select n from _hist_before) as result;
commit;
