#!/bin/bash
# 0072 レビュー用の一式。使い方: bash pack_0072_review.sh <出力ディレクトリ>
D=$(cd "$(dirname "$0")" && pwd); R=$(cd "$D/../.." && pwd); OUT=${1:?出力ディレクトリを指定してください}
mkdir -p "$OUT" && [ -z "$(ls -A "$OUT")" ] || { echo "ERROR: 出力先が空ではありません" >&2; exit 2; }
mkdir -p "$OUT"/{sql,verify,app,docs}
cp "$D"/0072_value_priorities_save.draft.sql "$D"/0072_preapply_check.sql "$D"/0072_postapply_check.sql "$D"/0072_rollback.draft.sql "$OUT/sql/"
cp "$D"/0072_verify.sh "$OUT/verify/"
cp "$R"/docs/verify-0070-0071/verify_common.sh "$R"/docs/verify-0070-0071/stub_supabase.sql "$R"/docs/stylist-profile-db/0070_stylist_profile_public.draft.sql "$R"/docs/stylist-profile-db/0070_fixture.sql "$OUT/verify/"
cp "$D"/0072_review_packet.md "$OUT/docs/"
( cd "$R" && git diff af936f6 HEAD -- app components lib tests > "$OUT/app/app_changes.patch"; git diff --stat af936f6 HEAD -- app components lib tests > "$OUT/app/CHANGES.txt" )
( cd "$OUT" && find . -type f ! -name MANIFEST.txt | sort | xargs sha256sum > MANIFEST.txt )
echo "一式を $OUT に集めました（$(find "$OUT" -type f | wc -l) ファイル）"
