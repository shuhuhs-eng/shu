#!/bin/bash
# 0071 レビュー用の一式を1つのディレクトリ（と zip）に集める。使い方: bash pack_0071_review.sh <出力ディレクトリ>
# 構成: sql/（本体・適用前後チェック・巻き戻し）／verify/（検証一式。そのまま su postgres -c "bash run_all_0070_0071.sh" 等で実行可能）／app/（今回のアプリ変更・テスト）／docs/（レビュー資料・調査）
D=$(cd "$(dirname "$0")" && pwd); R=$(cd "$D/../.." && pwd); OUT=${1:?出力ディレクトリを指定してください}
mkdir -p "$OUT" && [ -z "$(ls -A "$OUT")" ] || { echo "ERROR: 出力先が空ではありません" >&2; exit 2; }
mkdir -p "$OUT"/{sql,verify,app,docs}
cp "$D"/0071_student_newgrad.draft.sql "$D"/0071_preapply_check.sql "$D"/0071_postapply_check.sql "$D"/0071_rollback.draft.sql "$OUT/sql/"
bash "$R/docs/verify-0070-0071/pack_0070_0071.sh" "$OUT/verify" >/dev/null || exit 2
cp "$D"/0071_current_view_*.sh "$D"/0071_current_view_check.ts "$OUT/verify/"
cp "$D"/0071_review_packet.md "$D"/experience_years_investigation.md "$D"/experience_years_readonly.sql "$OUT/docs/"
cp "$R"/docs/review-diagnosis-limit/0059_close_direct_paths.draft.sql "$R"/docs/review-diagnosis-limit/0059_postapply_check.sql "$R"/docs/review-diagnosis-limit/0059_rollback_permissions.sql "$OUT/verify/" || exit 2
cp "$R/docs/verify-0070-0071/experience_years_verify.sh" "$R/docs/verify-0070-0071/value_priorities_apply_verify.sh" "$R/docs/verify-0070-0071/value_priorities_params.ts" "$OUT/verify/"
# アプリ変更（125ef50 以降: 学生診断の画面・保存処理・経験年数の変更・テスト）
( cd "$R" && git diff --stat 125ef50 HEAD -- app components lib tests types > "$OUT/app/CHANGES.txt"; git diff 125ef50 HEAD -- app components lib tests types > "$OUT/app/app_changes.patch"
  for f in $(git diff --name-only --diff-filter=AM 125ef50 HEAD -- app components lib tests types); do mkdir -p "$OUT/app/files/$(dirname "$f")"; cp "$f" "$OUT/app/files/$f"; done )
( cd "$OUT" && find . -type f ! -name MANIFEST.txt | sort | xargs sha256sum > MANIFEST.txt )
echo "一式を $OUT に集めました（$(find "$OUT" -type f | wc -l) ファイル）"
