#!/bin/bash
# 0064 の巻き戻し・停止・再開の予行（ローカル用）。ベースDB(0061適用済み)から作り直して実行する。
BASE=${1:-b62}; D=$(cd "$(dirname "$0")" && pwd); P="su postgres -c"; pass=0; fail=0
ok(){ if [ "$2" = "1" ]; then echo "PASS $1"; pass=$((pass+1)); else echo "FAIL $1 :: $3"; fail=$((fail+1)); fi; }
mk(){ $P "dropdb --if-exists $1; createdb -T $BASE $1"; for f in 0062_admin_billing.draft.sql 0063_company_location.draft.sql 0064_billing_regime_legacy_guard.draft.sql; do $P "psql -q -d $1 -v ON_ERROR_STOP=1 -f $D/$f" >/dev/null 2>&1; done; }
q(){ $P "psql -X -At -d $1 -c \"$2\"" 2>/dev/null; }
trg(){ q $1 "select count(*) from pg_trigger where tgname in ('trg_admin_invoice_lines_regime_guard','trg_stripe_checkout_basis','trg_hiring_success_fees_basis_update','trg_hiring_success_fees_basis_insert')"; }
rb(){ $P "psql -q -d $1 -v ON_ERROR_STOP=1 -f $D/0064_rollback.draft.sql" 2>&1 | grep -m1 "ERROR" ; }
# 1) 切替の記録が1件でもあれば中止（何も変更しない）
mk rh1; $P "psql -q -d rh1 -c \"insert into auth.users(id,email) values ('00000000-0000-0000-0000-00000000dd01','d@t'); insert into public.salon_organizations(id,name) values ('00000000-0000-0000-0000-0000000dd001','D'); insert into public.organization_billing_regime(organization_id,effective_from,decided_by) values ('00000000-0000-0000-0000-0000000dd001', now()+interval '30 days','00000000-0000-0000-0000-00000000dd01')\""
E=$(rb rh1); ok "RB1 切替の記録がある（効力が未来日でも）と、巻き戻しは中止。トリガー4本・関数・記録はそのまま" "$([ -n "$E" ] && [ "$(trg rh1)" = 4 ] && [ "$(q rh1 "select count(*) from pg_proc where proname in ('_hiring_lock','_billing_regime_active','admin_set_billing_regime')")" = 3 ] && [ "$(q rh1 "select count(*) from public.organization_billing_regime")" = 1 ] && echo 1)" "$E"
# 2) 案件ごとの判定の記録だけでも中止
mk rh2; $P "psql -q -d rh2 -c \"alter table public.hiring_process_billing_basis disable trigger trg_basis_append_only; insert into auth.users(id,email) values ('00000000-0000-0000-0000-00000000dd01','d@t'); insert into public.salon_organizations(id,name) values ('00000000-0000-0000-0000-0000000dd001','D'); insert into public.salon_stores(id,organization_id,store_name) values ('00000000-0000-0000-0000-0000000dd011','00000000-0000-0000-0000-0000000dd001','D1'); insert into public.store_hiring_processes(id,store_id,stylist_user_id,status,source) values ('00000000-0000-0000-0000-0000000dd021','00000000-0000-0000-0000-0000000dd011','00000000-0000-0000-0000-00000000dd01','contacting','interest'); insert into public.hiring_process_billing_basis(hiring_process_id,basis,reason,decided_by) values ('00000000-0000-0000-0000-0000000dd021','legacy','x','00000000-0000-0000-0000-00000000dd01')\""
E=$(rb rh2); ok "RB2 案件ごとの判定の記録だけがある場合も中止" "$([ -n "$E" ] && [ "$(trg rh2)" = 4 ] && echo 1)" "$E"
# 3) 切替後に有効な新採用料の行がある（効力が生じた会社）: 0064_effective_from.sh の後の状態で中止
$P "dropdb --if-exists rh3; createdb -T $BASE rh3"; for f in 0062_admin_billing.draft.sql 0063_company_location.draft.sql 0064_billing_regime_legacy_guard.draft.sql; do $P "psql -q -d rh3 -v ON_ERROR_STOP=1 -f $D/$f" >/dev/null 2>&1; done
$P "bash $D/0064_effective_from.sh rh3" 2>&1 | grep "===" | sed 's/^/   [準備] effective_from: /'
E=$(rb rh3); ok "RB3 切替後（記録あり・有効な新採用料の行あり）の巻き戻しは中止。二重請求防止のトリガーは残る" "$([ -n "$E" ] && [ "$(trg rh3)" = 4 ] && [ "$(q rh3 "select count(*) from public.admin_invoice_lines where fee_kind like 'hire%' and voided_at is null")" -ge 1 ] && echo 1)" "$E"
# 4) 切替後でも、停止（記録と二重請求防止を残す）は実行できる／再開できる
$P "psql -q -d rh3 -v ON_ERROR_STOP=1 -f $D/0064_suspend_keep_guard.draft.sql" >/dev/null 2>&1
ok "SU1 停止後: 切替の操作は誰も実行できない。トリガー・記録・状況確認は残る" "$([ "$(q rh3 "select count(*) from pg_proc p where proname in ('admin_set_billing_regime','admin_set_process_billing_basis') and (has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute') or has_function_privilege('anon',p.oid,'execute'))")" = 0 ] && [ "$(trg rh3)" = 4 ] && [ "$(q rh3 "select count(*) from public.organization_billing_regime")" = 1 ] && [ "$(q rh3 "select has_function_privilege('authenticated','public.admin_billing_regime_status(uuid)','execute')")" = t ] && echo 1)"
$P "psql -q -d rh3 -v ON_ERROR_STOP=1 -f $D/0064_resume.draft.sql" >/dev/null 2>&1
ok "SU2 再開後: 切替の操作の実行権限が authenticated に戻る（anon/service_roleには戻らない）" "$([ "$(q rh3 "select count(*) from pg_proc p where proname in ('admin_set_billing_regime','admin_set_process_billing_basis') and has_function_privilege('authenticated',p.oid,'execute') and not has_function_privilege('service_role',p.oid,'execute') and not has_function_privilege('anon',p.oid,'execute')")" = 2 ] && echo 1)"
# 5) 何も使っていない（記録も新採用料も無い）場合は、巻き戻せる。再実行しても失敗しない
mk rh5; E=$(rb rh5); E2=$(rb rh5)
ok "RB4 記録も新採用料も無ければ巻き戻せる（トリガー0本・関数なし）。再実行も失敗しない" "$([ -z "$E" ] && [ -z "$E2" ] && [ "$(trg rh5)" = 0 ] && [ "$(q rh5 "select count(*) from pg_proc where proname in ('_hiring_lock','_billing_regime_active','admin_set_billing_regime','_trg_hire_line_regime_guard')")" = 0 ] && echo 1)" "$E $E2"
echo "=== $pass PASS / $fail FAIL"
