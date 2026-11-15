#!/bin/bash
# 0070・0071 の検証を一式実行する（ローカル専用・使い捨てDBのみ）。1つでも失敗・SQLエラー・準備失敗があれば非ゼロで終了する。
# 実行例: su postgres -c "bash run_all_0070_0071.sh"        （自己テストも行う場合: ... run_all_0070_0071.sh --with-selftest）
# 前提・環境変数は verify_common.sh の冒頭、README_VERIFY.md を参照。
D=$(cd "$(dirname "$0")" && pwd)
. "$D/verify_common.sh"
vfy_preflight 0058_diagnosis_change_limits.draft.sql 0070_stylist_profile_public.draft.sql 0071_student_newgrad.draft.sql stub_supabase.sql \
  0070_verify.sh 0070_lifecycle_check.sh 0071_verify.sh 0071_concurrency_verify.sh 0071_apply_race_verify.sh rollback_concurrency_verify.sh age_concurrency_verify.sh age_save_verify.sh mutation_check_save.sh mutation_check_age.sh 0070_verify_age.sql
vfy_ensure_template     # 先にテンプレートを用意（以降のスクリプトは同じテンプレートを使う）
export TEMPLATE_DB="$VFY_TPL"
fails=0; summary=""
run() { local name=$1; echo; echo "################ $name"; bash "$(ffind "$name")"; local rc=$?; summary="$summary\n  $name: 終了コード $rc"; [ $rc -eq 0 ] || fails=$((fails+1)); }
run 0070_verify.sh
run 0071_verify.sh
run 0071_concurrency_verify.sh
run 0071_apply_race_verify.sh
run rollback_concurrency_verify.sh
run age_concurrency_verify.sh
run age_save_verify.sh
run mutation_check_save.sh
run mutation_check_age.sh
if [ "${1:-}" = "--with-selftest" ]; then need_files selftest_failure.sh; run selftest_failure.sh; fi
echo; echo "================ 総合"; printf "$summary\n"
if [ $fails -eq 0 ]; then echo "全スクリプト合格 (終了コード 0)"; exit 0; else echo "失敗したスクリプト: $fails 件 (終了コード 1)"; exit 1; fi
