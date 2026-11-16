#!/bin/bash
# 0078 の検証を最初から最後まで実行する（ローカル専用・使い捨てDBのみ。本番には接続しない）。
# 使い方: bash docs/core-type-tiebreak-db/run_0078_verify.sh
# 1) 合成ケース: 生成(TS)→DB検証(旧→適用→新→巻き戻し→再適用)→アプリ(TS)との突き合わせ
# 2) 経験者の実際の質問から作った回答: 同じ手順→変更前後の影響の資料(impact_experienced.md)→自動テスト用の固定データ(tests/fixtures)
set -u
D=$(cd "$(dirname "$0")" && pwd); R=$(cd "$D/../.." && pwd)
W1=$(mktemp -d /tmp/tb78a.XXXXXX); W2=$(mktemp -d /tmp/tb78b.XXXXXX); chmod 777 "$W1" "$W2"
cd "$R" || exit 2
pg_ctlcluster 16 main start 2>/dev/null; sleep 2
npx tsx "$D/gen_cases.mts" "$W1" || exit 2; chmod a+r "$W1/cases.csv"
su postgres -c "bash $D/0078_verify.sh $W1"; rc1=$?
echo "== アプリ(TS)と保存結果の突き合わせ（合成ケース）"
npx tsx "$D/compare.mts" "$W1" old; npx tsx "$D/compare.mts" "$W1" new; rc2=$?
echo "== 経験者の実際の質問からの回答（影響調査）"
npx tsx "$D/impact_gen.mts" "$W2" 300000 || exit 2; chmod -R a+rX "$W2"
su postgres -c "bash $D/0078_verify.sh $W2"; rc3=$?
npx tsx "$D/impact_report.mts" "$W2" "$D/impact_experienced.md" | sed -n 1,2p
npx tsx "$D/compare.mts" "$W2" new; rc4=$?
npx tsx "$D/export_fixture.mts" "$R/tests/fixtures/core-type-db-parity.csv" "$W1" "$W2"
echo "== rc: DB合成=$rc1 突き合わせ合成(新)=$rc2 DB実回答=$rc3 突き合わせ実回答(新)=$rc4"
rm -rf "$W1" "$W2"; [ $rc1 -eq 0 ] && [ $rc2 -eq 0 ] && [ $rc3 -eq 0 ] && [ $rc4 -eq 0 ]
