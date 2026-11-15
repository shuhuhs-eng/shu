#!/bin/bash
# 検証基盤の自己テスト: 失敗・エラー・前提不足のとき、実行全体が非ゼロで終了すること、使い捨てでないDBを消さないことを確認する。
D=$(cd "$(dirname "$0")" && pwd)
. "$D/verify_common.sh"
vfy_preflight stub_supabase.sql rollback_concurrency_verify.sh 0071_apply_race_verify.sh
vfy_ensure_template
export TEMPLATE_DB="$VFY_TPL"
T=vfy_self_$$; trap 'vdb_drop $T; psql -X -q -d postgres -c "drop database if exists vfy_unmarked_$$" >/dev/null 2>&1; rm -rf "$VFY_TMPD"' EXIT
vdb_create $T
mk() { printf '%s\n' "$2" > "$VFY_TMPD/$1.sql"; echo "$VFY_TMPD/$1.sql"; }
# 1) SQL側のFAIL行 → 失敗として検知
vfy_run_sql $T "注入: FAIL行" "$(mk f1 "select 1 as n, 'FAIL' as r, 'x' as name;")" >/dev/null; vfy_chk "SQLのFAIL行は失敗(1)として検知される" "$?" "1"
# 2) SQLエラー → 失敗
vfy_run_sql $T "注入: SQLエラー" "$(mk f2 "select * from no_such_table_xyz;")" >/dev/null; vfy_chk "SQLエラーは失敗(1)として検知される" "$?" "1"
# 3) 合格行が1件もない（検証が空振り） → 失敗
vfy_run_sql $T "注入: 空振り" "$(mk f3 "select 1;")" >/dev/null; vfy_chk "合格行ゼロは失敗(1)として検知される" "$?" "1"
# 4) 正常 → 合格
vfy_run_sql $T "注入: 正常" "$(mk f4 "select 1 as n, 'PASS' as r, 'x' as name;")" >/dev/null; vfy_chk "正常なSQLは合格(0)" "$?" "0"
# 5) バックグラウンド処理の失敗コードを取りこぼさない
vfy_bg bgx bash -c 'exit 3'; vfy_join bgx; vfy_chk "バックグラウンド処理の終了コード(3)を取得できる" "$(vfy_rc bgx)" "3"
# 6) 前提ファイル不足 → DBを触る前に終了コード2で止まる（DB数が変わらない）
n0=$(psql -X -Atq -d postgres -c "select count(*) from pg_database")
out=$(bash -c ". '$D/verify_common.sh'; vfy_preflight no_such_file_xyz.sql" 2>&1); rc=$?
n1=$(psql -X -Atq -d postgres -c "select count(*) from pg_database")
vfy_chk "必要なファイルが無いと終了コード2で止まる" "$rc" "2"; vfy_has "不足ファイルが明示される" "$out" "no_such_file_xyz.sql"; vfy_chk "止まる前にDBを作っていない" "$n1" "$n0"
# 7) 印のないDBは削除しない・vfy_以外の名前は拒否
psql -X -q -d postgres -c "create database vfy_unmarked_$$" >/dev/null
out=$(bash -c ". '$D/verify_common.sh'; vdb_drop vfy_unmarked_$$" 2>&1); rc=$?
vfy_chk "印のないDBは削除せず終了コード2で止まる" "$rc" "2"; vfy_chk "そのDBは残っている" "$(psql -X -Atq -d postgres -c "select count(*) from pg_database where datname='vfy_unmarked_$$'")" "1"
out=$(bash -c ". '$D/verify_common.sh'; vdb_drop postgres" 2>&1); rc=$?
vfy_chk "vfy_ で始まらないDB名（postgres）は拒否される" "$rc" "2"
# 8) vfy_exit は失敗があれば1
bash -c ". '$D/verify_common.sh'; VFY_FAIL=1; vfy_exit" >/dev/null 2>&1; vfy_chk "失敗が1件でもあれば vfy_exit は1" "$?" "1"
# 9) 意図的に壊した版（変異）で、同時実行の検証スクリプトが非ゼロで終了する
VFY_MUTATE=nolock bash "$(ffind 0071_apply_race_verify.sh)" >/dev/null 2>&1; vfy_chk "変異(適用時のロック除去): 0071_apply_race_verify.sh は非ゼロ" "$([ $? != 0 ] && echo nonzero || echo zero)" "nonzero"
VFY_MUTATE=nolock_rollback bash "$(ffind rollback_concurrency_verify.sh)" >/dev/null 2>&1; vfy_chk "変異(巻き戻しのロック除去): rollback_concurrency_verify.sh は非ゼロ" "$([ $? != 0 ] && echo nonzero || echo zero)" "nonzero"
vfy_exit
