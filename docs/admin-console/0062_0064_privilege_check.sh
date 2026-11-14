#!/bin/bash
# 0062・0063・0064 で【新しく作られた】全ての表・関数・シーケンスについて、実効権限を確認する（ローカル用）。
# 使い方: bash 0062_0064_privilege_check.sh <ベースDB(0061適用済み)> <作業DB名>
# 方式: 作業DBに「Supabaseの既定権限を模した設定（ALTER DEFAULT PRIVILEGES … TO anon, authenticated, service_role）」を先に入れてから 0062→0063→0064 を適用し、
#       ベースDBとの差分＝新設オブジェクトを自動で列挙して、PUBLIC/anon/authenticated/service_role それぞれの実効権限を数える。
BASE=${1:-b62}; DB=${2:-d64}; D=$(cd "$(dirname "$0")" && pwd)
su postgres -c "dropdb --if-exists $DB; createdb -T $BASE $DB"
su postgres -c "psql -q -d $DB" <<'SQL'
-- Supabase の既定: postgres が作る public のオブジェクトに、anon/authenticated/service_role へ全権限が自動付与される
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
SQL
for f in 0062_admin_billing.draft.sql 0063_company_location.draft.sql 0064_billing_regime_legacy_guard.draft.sql; do su postgres -c "psql -q -d $DB -v ON_ERROR_STOP=1 -f $D/$f" 2>&1 | tail -2; done
LIST="select 'T', c.relname from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p','v','m','S') union all select 'F', p.oid::regprocedure::text from pg_proc p where p.pronamespace='public'::regnamespace"
su postgres -c "psql -At -d $BASE -c \"$LIST\"" | sort > /tmp/priv_base.txt
su postgres -c "psql -At -d $DB   -c \"$LIST\"" | sort > /tmp/priv_new.txt
comm -13 /tmp/priv_base.txt /tmp/priv_new.txt > /tmp/priv_added.txt
echo "新設オブジェクト: 表 $(grep -c '^T' /tmp/priv_added.txt) / 関数 $(grep -c '^F' /tmp/priv_added.txt)"
su postgres -c "psql -q -d $DB" <<'SQL'
create temp table added(kind text, name text);
SQL
{ echo "create table if not exists public._priv_added(kind text, name text);"; awk -F'|' '{gsub("\x27","\x27\x27",$2); printf "insert into public._priv_added values (\x27%s\x27,\x27%s\x27);\n",$1,$2}' /tmp/priv_added.txt; } | su postgres -c "psql -q -d $DB"
su postgres -c "psql -X -At -d $DB" <<'SQL'
-- 表: PUBLIC/anon/authenticated/service_role の、どの権限も無いこと（所有者以外のACLが空）
select case when count(*) = 0 then 'PASS' else 'FAIL' end || ' 新設の表(' || (select count(*) from public._priv_added where kind='T') || '件): 所有者以外にACLが一つも付いていない（PUBLIC/anon/authenticated/service_role を含む）' || coalesce(' :: ' || string_agg(name, ','), '')
  from (select distinct a.name from public._priv_added a join pg_class c on c.oid = ('public.' || quote_ident(a.name))::regclass, aclexplode(c.relacl) x where a.kind='T' and x.grantee <> c.relowner) z;
select case when count(*) = 0 then 'PASS' else 'FAIL' end || ' 新設の表: has_table_privilege が anon/authenticated/service_role すべて全権限で false' || coalesce(' :: ' || string_agg(name || ':' || ro, ','), '')
  from (select distinct a.name, ro from public._priv_added a cross join unnest(array['anon','authenticated','service_role']) ro, unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) pv
         where a.kind='T' and has_table_privilege(ro, ('public.' || quote_ident(a.name))::regclass, pv)) z;
-- 関数: 公開RPC=authenticatedだけ。内部=誰にも無い。PUBLIC(grantee 0) は常に無い
create or replace temp view f as select a.name, p.oid, p.proname, p.proowner, p.proacl from public._priv_added a join pg_proc p on p.oid = a.name::regprocedure where a.kind='F';
create or replace temp view pub as (select oid, proname from f where proname in ('admin_propose_quote','admin_withdraw_quote','admin_create_invoice','admin_add_fee_line','admin_add_registration_line','admin_void_line','admin_advance_invoice','company_list_quotes','company_respond_quote','billing_list_invoices','billing_begin_checkout','admin_correct_hire_line','admin_recalculate_registration_line','admin_flag_billing_case','admin_set_billing_regime','admin_set_process_billing_basis','admin_billing_regime_status','admin_get_organization_location','admin_set_organization_location','is_known_prefecture'));
select case when (select count(*) from pub) = (select count(*) from pub where has_function_privilege('authenticated', oid, 'EXECUTE') and not has_function_privilege('anon', oid, 'EXECUTE') and not has_function_privilege('service_role', oid, 'EXECUTE')) then 'PASS' else 'FAIL' end
  || ' 新設の公開RPC(' || (select count(*) from pub) || '本): authenticated のみ実行可（anon・service_role は不可）';
select case when count(*) = 0 then 'PASS' else 'FAIL' end || ' 新設の関数(' || (select count(*) from f) || '本)すべて: PUBLICへの実行権限が無い' || coalesce(' :: ' || string_agg(name, ','), '')
  from (select f.name from f, aclexplode(f.proacl) x where x.grantee = 0) z;
select case when count(*) = 0 then 'PASS' else 'FAIL' end || ' 新設の内部関数(公開RPC以外)は、anon/authenticated/service_role のどれにも実行権限が無い' || coalesce(' :: ' || string_agg(name, ','), '')
  from (select f.name from f where f.oid not in (select oid from pub) and (has_function_privilege('anon', f.oid, 'EXECUTE') or has_function_privilege('authenticated', f.oid, 'EXECUTE') or has_function_privilege('service_role', f.oid, 'EXECUTE'))) z;
select case when count(*) = 0 then 'PASS' else 'FAIL' end || ' 新設のシーケンスは無い（あれば権限の確認が別途必要）' from public._priv_added where kind='T' and name in (select relname from pg_class where relkind='S');
-- 参考: 既存の関数 get_admin_billing_integrity_issues（0040の再定義）の権限は、従来どおり authenticated のみ
select case when has_function_privilege('authenticated','public.get_admin_billing_integrity_issues()','EXECUTE') and not has_function_privilege('anon','public.get_admin_billing_integrity_issues()','EXECUTE') then 'PASS' else 'FAIL' end || ' 再定義した get_admin_billing_integrity_issues: authenticated のみ（anon不可）';
SQL
echo "--- 新設オブジェクトの一覧 ---"; cat /tmp/priv_added.txt | sed 's/^/  /' | cut -c1-110
