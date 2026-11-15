#!/bin/bash
# 0070 ローカル検証一式（使い捨てDBのみ。本番には接続しない）。1件でも失敗・SQLエラーがあれば非ゼロで終了する。
# 実行例: su postgres -c "bash 0070_verify.sh"   （前提は verify_common.sh の冒頭を参照）
D=$(cd "$(dirname "$0")" && pwd)
. "$(for c in "$D" "$D/../verify-0070-0071"; do [ -f "$c/verify_common.sh" ] && echo "$c/verify_common.sh" && break; done)" 2>/dev/null || { echo "ERROR: verify_common.sh が見つかりません（同じディレクトリに置いてください）" >&2; exit 2; }
vfy_preflight 0070_fixture.sql 0070_preapply_check.sql 0070_stylist_profile_public.draft.sql 0070_verify.sql 0070_verify_age.sql 0070_postapply_check.sql \
  0070_rollback.draft.sql 0070_suspend_keep_data.sql 0070_public_extended_resume.sql 0070_salary_offer_pause.sql 0070_salary_offer_resume.sql 0070_lifecycle_check.sh stub_supabase.sql
vfy_ensure_template
DB=vfy_v70_$$; trap 'vdb_drop $DB' EXIT
vdb_create $DB "$VFY_TPL"
vpsql -d $DB -f "$(ffind 0070_fixture.sql)" >/dev/null || vfy_die "fixture の投入に失敗"
echo "== 適用前チェック"
out=$(psql -X -q -v ON_ERROR_STOP=1 -d $DB -f "$(ffind 0070_preapply_check.sql)" 2>&1); rc=$?; echo "$out" | head -20
[ $rc -eq 0 ] && vfy_record 0 || { echo "FAIL  適用前チェックがSQLエラー"; vfy_record 1; }
MD5=$(psql -X -Atq -d $DB -c "select md5(string_agg(pg_get_functiondef(p.oid), '' order by p.oid)) from pg_proc p where p.proname='save_stylist_profile' and p.pronamespace='public'::regnamespace")
echo "== 本体適用"
vpsql -d $DB -f "$(ffind 0070_stylist_profile_public.draft.sql)" >/dev/null 2>"${TMPDIR:-/tmp}/v70_apply.$$" || { echo "FAIL  0070本体の適用に失敗"; grep -v NOTICE "${TMPDIR:-/tmp}/v70_apply.$$" | head -3; vfy_record 1; }
echo "== 検証"
vfy_run_sql $DB "0070_verify.sql" "$(ffind 0070_verify.sql)" -v pre_md5=$MD5; vfy_record $?
echo "$VFY_OUT" | grep -cE '\| *PASS *\|' | sed 's/^/   合格行: /'
echo "== 年齢仕様の検証（必須登録・表示方法・開示依頼）"
vfy_run_sql $DB "0070_verify_age.sql" "$(ffind 0070_verify_age.sql)"; vfy_record $?
echo "== 適用後チェック"
vfy_run_sql $DB "0070_postapply_check.sql" "$(ffind 0070_postapply_check.sql)"; vfy_record $?
echo "== 巻き戻し・停止・再開の手順確認"
bash "$(ffind 0070_lifecycle_check.sh)"; vfy_record $?
vfy_exit
