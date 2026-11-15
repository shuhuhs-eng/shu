#!/bin/bash
# 配布用の一式を、1つのディレクトリへ平らに集める（ファイル名とスクリプト内の参照名は同じ）。
# 使い方: bash pack_0070_0071.sh <出力ディレクトリ>
# 含めるもの: SQL・fixture・検証スクリプト・補助SQL（スタブ）・0058本体・migration 0001〜0061（テンプレートDB作成用）・MANIFEST
D=$(cd "$(dirname "$0")" && pwd); OUT=${1:?出力ディレクトリを指定してください}
R=$(cd "$D/../.." && pwd)
[ -f "$R/supabase/migrations/0001_init.sql" ] || { echo "ERROR: リポジトリの supabase/migrations が見つかりません: $R" >&2; exit 2; }
mkdir -p "$OUT/migrations" || exit 2
[ -z "$(ls -A "$OUT" | grep -v '^migrations$')" ] || { echo "ERROR: 出力先が空ではありません: $OUT" >&2; exit 2; }
cp "$D"/verify_common.sh "$D"/stub_supabase.sql "$D"/run_all_0070_0071.sh "$D"/rollback_concurrency_verify.sh "$D"/age_concurrency_verify.sh "$D"/age_save_verify.sh "$D"/mutation_check_save.sh "$D"/mutation_check_age.sh "$D"/selftest_failure.sh "$D"/README_VERIFY.md "$OUT" || exit 2
cp "$D/../review-diagnosis-limit/0058_diagnosis_change_limits.draft.sql" "$OUT" || exit 2
cp "$D"/../stylist-profile-db/0070_* "$OUT" || exit 2
cp "$D"/../student-newgrad-db/0071_* "$OUT" || exit 2
for f in "$R"/supabase/migrations/*.sql; do n=$(basename "$f" | cut -c1-4); [ "$n" -le 0061 ] && cp "$f" "$OUT/migrations/"; done
( cd "$OUT" && find . -type f ! -name MANIFEST.txt | sort | xargs sha256sum > MANIFEST.txt )
echo "一式を $OUT に集めました（$(find "$OUT" -type f | wc -l) ファイル）"
