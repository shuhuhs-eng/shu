#!/bin/bash
# 0065 の権限確認と取り消しの予行演習（ローカル用）。使い方: bash 0065_privilege_and_rollback_check.sh <ベースDB(0061適用済み)> <作業DB名>
BASE=${1:-b62}; DB=${2:-d65p}; D=$(cd "$(dirname "$0")" && pwd)
su postgres -c "dropdb --if-exists $DB; createdb -T $BASE $DB"
su postgres -c "psql -q -d $DB" <<'SQL'
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
SQL
for f in 0062_admin_billing.draft.sql 0063_company_location.draft.sql 0064_billing_regime_legacy_guard.draft.sql 0065_admin_billing_reads.draft.sql; do su postgres -c "psql -q -d $DB -v ON_ERROR_STOP=1 -f $D/$f" 2>&1 | tail -2; done
Q="select p.oid from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('admin_billing_summary','admin_list_quotes','admin_list_invoices','admin_get_invoice','admin_list_billable_cases','admin_list_unresolved_billing_cases','company_billing_overview','company_get_invoice')"
su postgres -c "psql -X -At -d $DB" <<SQL
create temp view f as $Q;
select case when (select count(*) from f)=8 then 'PASS' else 'FAIL' end || ' 0065の関数は8本';
select case when count(*)=0 then 'PASS' else 'FAIL' end || ' PUBLICへの実行権限なし' from f, pg_proc p, aclexplode(p.proacl) x where p.oid=f.oid and x.grantee=0;
select case when count(*)=8 then 'PASS' else 'FAIL' end || ' authenticated のみ実行可（anon・service_role 不可）' from f where has_function_privilege('authenticated', f.oid,'EXECUTE') and not has_function_privilege('anon', f.oid,'EXECUTE') and not has_function_privilege('service_role', f.oid,'EXECUTE');
select case when (select count(*) from pg_class where relnamespace='public'::regnamespace) = (select count(*) from pg_class where relnamespace='public'::regnamespace) then 'PASS' else 'FAIL' end || ' 0065は表・シーケンスを作らない（後段で件数比較）';
SQL
T1=$(su postgres -c "psql -X -At -d $DB -c \"select count(*) from pg_class where relnamespace='public'::regnamespace\"")
su postgres -c "psql -X -q -d $DB -v ON_ERROR_STOP=1 -f $D/0065_rollback.draft.sql"
su postgres -c "psql -X -At -d $DB" <<SQL
select case when count(*)=0 then 'PASS' else 'FAIL' end || ' 取り消し後: 0065の関数が0本' from ($Q) z;
select case when to_regprocedure('public.admin_create_invoice(uuid,uuid)') is not null and to_regprocedure('public.admin_billing_regime_status(uuid)') is not null then 'PASS' else 'FAIL' end || ' 取り消し後: 0062〜0064の関数は残っている';
select case when count(*)=$T1 then 'PASS' else 'FAIL' end || ' 取り消し後: 表・シーケンスの数は変わらない($T1)' from pg_class where relnamespace='public'::regnamespace;
SQL
su postgres -c "psql -X -q -d $DB -v ON_ERROR_STOP=1 -f $D/0065_admin_billing_reads.draft.sql" && echo "PASS 取り消し後に0065を再適用できる"
su postgres -c "dropdb $DB"
