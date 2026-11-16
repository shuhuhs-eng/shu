#!/bin/bash
# レビュー用に 0076/0077 のDB資料とアプリの差分・変更ファイルを1つのzipにまとめる。リポジトリ内で実行。
# 使い方: bash pack_0076_0077_review.sh [出力先.zip]   （差分の基準は環境変数 BASE、既定は 968ea86）
D=$(cd "$(dirname "$0")" && pwd); R=$(cd "$D/../.." && pwd); BASE=${BASE:-968ea86}
OUT=${1:-$D/0076_0077_review.zip}; case "$OUT" in /*) ;; *) OUT="$PWD/$OUT";; esac
T=$(mktemp -d); mkdir -p "$T/db" "$T/app_changes"
cp "$D"/0076_*.sql "$D"/0077_*.sql "$D"/0076_0077_verify.sh "$D"/0076_0077_review_packet.md "$T/db/"; cp -r "$R/docs/career-phase-required-db/ui_check" "$T/db/"
cd "$R" && APP=$(git diff --name-only --diff-filter=AM "$BASE" HEAD -- app components lib tests types)
git diff "$BASE" HEAD -- app components lib tests types docs/career-phase-required-db/ui_check > "$T/app_changes.patch"
for f in $APP; do mkdir -p "$T/app_changes/$(dirname "$f")"; cp "$f" "$T/app_changes/$f"; done
git diff --name-status "$BASE" HEAD -- app components lib tests types docs/career-phase-required-db/ui_check > "$T/app_changed_files.txt"
(cd "$T" && rm -f "$OUT" && zip -qr "$OUT" .) && rm -rf "$T" && echo "$OUT"
