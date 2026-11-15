#!/bin/bash
# DBが指す現在の診断と画面表示の一致を、ローカルDBのシナリオで確認する。リポジトリの直下（node_modules のある場所）から実行する。
# 使い方: bash docs/student-newgrad-db/0071_current_view_verify.sh
D=$(cd "$(dirname "$0")" && pwd); J=$(mktemp /tmp/cv.XXXXXX.json); chmod 666 "$J"
su postgres -c "bash $D/0071_current_view_gen.sh $J" || { echo "シナリオの生成に失敗"; exit 1; }
npx tsx "$D/0071_current_view_check.ts" "$J"; rc=$?; rm -f "$J"; exit $rc
