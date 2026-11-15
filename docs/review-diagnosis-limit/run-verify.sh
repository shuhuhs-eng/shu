#!/bin/sh
# ローカル専用。本番には接続しない。使い捨てDB(hd58v)を、適用済みスキーマのコピー元(既定 hd57)から作って検証する。
# 使い方: su postgres -c "sh run-verify.sh [コピー元DB名]"
set -e
SRC="${1:-hd57}"; DB=hd58v; DIR="$(cd "$(dirname "$0")" && pwd)"
dropdb --if-exists "$DB"; createdb -T "$SRC" "$DB"
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$DIR/0058_diagnosis_change_limits.draft.sql"
sed '/^begin;$/d;/^commit;$/d' "$DIR/0059_close_direct_paths.draft.sql" > /tmp/0059.nocommit.sql
psql -q -d "$DB" -v f0059=/tmp/0059.nocommit.sql -f "$DIR/0058_verify.sql" | grep -E "FAIL|^ +[0-9]+ \| +[0-9]+$|pass|^ *[0-9]+ \|" | grep -v "PASS" || true
echo "--- サロン側アプリ経路の結合検証"
psql -q -d "$DB" -f "$DIR/0058_verify_salon_app.sql" | grep -E "FAIL|^ *[0-9]+ \|" | grep -v "PASS" || true
dropdb "$DB"
