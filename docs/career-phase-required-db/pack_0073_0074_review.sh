#!/bin/bash
# レビュー用に 0073/0074 のDB資料とアプリの差分・変更ファイルを1つのzipにまとめる。リポジトリ内で実行。
# 使い方: bash pack_0073_0074_review.sh [出力先.zip]   （差分の基準は環境変数 BASE、既定は 0072 のコミット c65a6bd）
D=$(cd "$(dirname "$0")" && pwd); R=$(cd "$D/../.." && pwd); BASE=${BASE:-c65a6bd}
OUT=${1:-$D/0073_0074_review.zip}; case "$OUT" in /*) ;; *) OUT="$PWD/$OUT";; esac
T=$(mktemp -d); mkdir -p "$T/db" "$T/app_changes"
cp "$D"/0073_*.sql "$D"/0074_*.sql "$D"/0073_0074_verify.sh "$D"/0073_0074_review_packet.md "$T/db/"; cp -r "$D/ui_check" "$T/db/"
cd "$R" && APP=$(git diff --name-only --diff-filter=AM "$BASE" HEAD -- app components lib tests)
git diff "$BASE" HEAD -- app components lib tests > "$T/app_changes.patch"
for f in $APP; do mkdir -p "$T/app_changes/$(dirname "$f")"; cp "$f" "$T/app_changes/$f"; done
git diff --name-status "$BASE" HEAD -- app components lib tests > "$T/app_changed_files.txt"
(cd "$T" && rm -f "$OUT" && zip -qr "$OUT" .) && rm -rf "$T" && echo "$OUT"
