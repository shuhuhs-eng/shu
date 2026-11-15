#!/bin/bash
# 0071 ローカル検証一式（使い捨てDBのみ。本番には接続しない）。適用順 0058→0070→0071。1件でも失敗・SQLエラーがあれば非ゼロで終了する。
# 同時実行系（0071_concurrency_verify.sh / 0071_apply_race_verify.sh / rollback_concurrency_verify.sh）は run_all_0070_0071.sh から実行する。
D=$(cd "$(dirname "$0")" && pwd)
. "$(for c in "$D" "$D/../verify-0070-0071"; do [ -f "$c/verify_common.sh" ] && echo "$c/verify_common.sh" && break; done)" 2>/dev/null || { echo "ERROR: verify_common.sh が見つかりません（同じディレクトリに置いてください）" >&2; exit 2; }
vfy_preflight 0058_diagnosis_change_limits.draft.sql 0070_stylist_profile_public.draft.sql 0071_student_newgrad.draft.sql 0071_rollback.draft.sql \
  0071_verify.sql 0071_verify_publish.sql 0071_constraint_verify.sql 0071_preapply_check.sql 0071_postapply_check.sql stub_supabase.sql
vfy_ensure_template
P=vfy_v71_$$_; trap 'for x in pre main nodep rb; do vdb_drop ${P}$x; done' EXIT

echo "== 0070 未適用では 0071 を適用できない（明確なエラーで中止し、何も作らない）"
vdb_create ${P}nodep "$VFY_TPL"; vpsql -d ${P}nodep -f "$(ffind 0058_diagnosis_change_limits.draft.sql)" >/dev/null 2>&1 || vfy_die "0058 適用失敗"
out=$(psql -X -q -v ON_ERROR_STOP=1 -d ${P}nodep -f "$(ffind 0071_student_newgrad.draft.sql)" 2>&1); rc=$?
vfy_chk "0070なしの0071は拒否される（非ゼロ）" "$([ $rc != 0 ] && echo yes || echo no)" "yes"
vfy_has "拒否の理由が表示される" "$out" "0071 requires 0070"
vfy_chk "何も作られていない" "$(psql -X -Atq -d ${P}nodep -c "select coalesce(to_regclass('public.stylist_diagnosis_current')::text,'-')")" "-"

echo "== 適用前チェック（0058→0070 適用済み・0071 未適用の状態）"
vfy_build_chain ${P}pre 0070
out=$(psql -X -Atq -v ON_ERROR_STOP=1 -d ${P}pre -f "$(ffind 0071_preapply_check.sql)" 2>&1); rc=$?
vfy_chk "適用前チェックが実行でき、総合判定が PASS" "$rc|$(echo "$out" | grep '^99|' | cut -d'|' -f2)" "0|PASS"

echo "== 0071 適用後"
vfy_build_chain ${P}main 0071
vfy_run_sql ${P}main "0071_verify.sql（区分・診断・回数制限・現在の診断・再送）" "$(ffind 0071_verify.sql)"; vfy_record $?
vfy_run_sql ${P}main "0071_verify_publish.sql（公開保留）" "$(ffind 0071_verify_publish.sql)"; vfy_record $?
vfy_run_sql ${P}main "0071_constraint_verify.sql（整合制約・旧定義との比較）" "$(ffind 0071_constraint_verify.sql)"; vfy_record $?
out=$(psql -X -Atq -v ON_ERROR_STOP=1 -d ${P}main -f "$(ffind 0071_postapply_check.sql)" 2>&1); rc=$?
vfy_chk "適用後チェックが実行でき、総合判定が PASS" "$rc|$(echo "$out" | grep '^99|' | cut -d'|' -f2)" "0|PASS"
echo "== 適用前チェックが、0071 適用後のDBでは FAIL を出す（常にPASSになっていない）"
out=$(psql -X -Atq -d ${P}main -f "$(ffind 0071_preapply_check.sql)" 2>&1)
vfy_chk "適用済みDBでの適用前チェックは FAIL" "$(echo "$out" | grep '^99|' | cut -d'|' -f2)" "FAIL"
echo "== 巻き戻し→再適用（データなし）"
vfy_build_chain ${P}rb 0071
out=$(psql -X -q -v ON_ERROR_STOP=1 -d ${P}rb -f "$(ffind 0071_rollback.draft.sql)" 2>&1); rc=$?
vfy_chk "0071 の巻き戻しが成功" "$rc" "0"
vfy_chk "0058 の関数が元の定義へ戻る" "$(psql -X -Atq -d ${P}rb -c "select md5(prosrc) from pg_proc where proname='commit_diagnosis_result'")|$(psql -X -Atq -d ${P}rb -c "select md5(prosrc) from pg_proc where proname='_trg_diagnosis_results_limit'")" "04fe4af9ea696398239f95f6f984b6f6|15df323841beef4372b72dc2e2d488e4"
vfy_chk "公開判定は 0070 の定義へ戻る（区分の参照なし）" "$(psql -X -Atq -d ${P}rb -c "select (position('career_phase' in prosrc)=0)::text from pg_proc where proname='stylist_salon_publishable'")" "true"
out=$(psql -X -q -v ON_ERROR_STOP=1 -d ${P}rb -f "$(ffind 0071_student_newgrad.draft.sql)" 2>&1); rc=$?
vfy_chk "巻き戻し後に 0071 を再適用できる" "$rc" "0"
vfy_exit
