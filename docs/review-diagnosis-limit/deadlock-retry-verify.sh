#!/bin/sh
# ローカル専用（本番では実行しない）。実際にデッドロックを起こし、失敗した側が「何も残さず」、
# 同じ送信ID・同じ内容で再試行でき、結果と回数が二重にならないことを確認する。
# 使い方: su postgres -c "sh deadlock-retry-verify.sh [コピー元DB名]"
set -e
SRC="${1:-hd57}"; DB=hd58d; DIR="$(cd "$(dirname "$0")" && pwd)"
dropdb --if-exists "$DB"; createdb -T "$SRC" "$DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$DIR/0058_diagnosis_change_limits.draft.sql"
FAILS=0
chk() { if [ "$2" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1 (期待 [$3] / 実際 [$2])"; FAILS=$((FAILS+1)); fi; }
q() { psql -Atq -d "$DB" "$@" 2>&1; }
RPCSQL() { echo "select public.commit_diagnosis_result('$1','$2',true,'1.0.0','stylist','$3'::jsonb,1::smallint,1::smallint,1::smallint,1::smallint,1::smallint,1::smallint,'T','T',1::smallint,'x')->>'action'"; }
INSSQL() { echo "insert into diagnosis_results (user_id, diagnosis_version, mode, answers, craft_score, sense_score, hospitality_score, brand_score, drive_score, mentor_score, type_id, type_name, market_value_score, salary_band) values ('$1','1.0.0','stylist','$2',1,1,1,1,1,1,'T','T',1,'x')"; }
cnt() { q -c "select count(*) from diagnosis_results where user_id='$1'"; }
chg() { q -c "select change_count from diagnosis_change_limits where user_id='$1' and kind='stylist'"; }
nreq() { q -c "select count(*) from diagnosis_save_requests where request_id='$1'"; }
Y='[2,2]'

# 引数: シナリオ名 ユーザー RPCが所有者ロックから行ロック待ちに入るまでの秒 直接INSERTが所有者ロック待ちに入るまでの秒 RPC側を後から待たせる=...
scenario() {
  NAME=$1; U=$2; TA=$3; TB=$4; REQ=$(cat /proc/sys/kernel/random/uuid)
  q -c "insert into auth.users (id,email) values ('$U','$U@t'); update public.profiles set role='stylist' where id='$U';" >/dev/null
  q -c "set role service_role; $(RPCSQL $U $(cat /proc/sys/kernel/random/uuid) '[1,1]')" >/dev/null   # 初回
  # A: 所有者ロックを先に握り、TA秒後に正規RPC（行ロック待ちに入る）
  psql -Atq -d "$DB" > /var/tmp/dlA.out 2>&1 <<SQL &
begin;
select public._diag_owner_lock('stylist','$U'::uuid,null);
select pg_sleep($TA);
set local role service_role;
$(RPCSQL $U $REQ "$Y");
commit;
SQL
  PA=$!
  # B: 状態の行ロックを先に握り、TB秒後に直接INSERT（所有者ロック待ちに入る）
  psql -Atq -d "$DB" > /var/tmp/dlB.out 2>&1 <<SQL &
begin;
select 1 from diagnosis_change_limits where user_id='$U' and kind='stylist' for update;
select pg_sleep($TB);
set local role service_role;
$(INSSQL $U "$Y");
commit;
SQL
  PB=$!
  wait $PA || true; wait $PB || true
  DA=$(grep -c "deadlock detected" /var/tmp/dlA.out || true); DBc=$(grep -c "deadlock detected" /var/tmp/dlB.out || true)
  chk "$NAME: デッドロックがちょうど1件発生（A=正規RPC:$DA / B=直接INSERT:$DBc）" "$((DA+DBc))" 1
  # 失敗した側は、何も残していない（生き残った側の保存だけが反映）
  chk "$NAME: 失敗直後の結果は、生き残った側の1件だけが追加（合計2件）" "$(cnt $U)" 2
  chk "$NAME: 失敗直後の変更回数は1（失敗した側は消費していない）" "$(chg $U)" 1
  if [ "$DA" = 1 ]; then
    chk "$NAME: 失敗したRPCの送信IDは記録されていない（0件）" "$(nreq $REQ)" 0
    R=$(q -c "set role service_role; $(RPCSQL $U $REQ "$Y")" | tail -1)
    chk "$NAME: 同じ送信ID・同じ内容の再試行が成功する（結果: $R）" "$R" unchanged
    chk "$NAME: 再試行後、その送信IDの記録がちょうど1件" "$(nreq $REQ)" 1
    R=$(q -c "set role service_role; $(RPCSQL $U $REQ "$Y")" | tail -1)
    chk "$NAME: もう一度同じ送信IDで再送しても、再送扱いで増えない（記録1件のまま）" "$(nreq $REQ)" 1
  else
    R=$(q -c "set role service_role; $(INSSQL $U "$Y")")
    chk "$NAME: 失敗した直接INSERTを同じ内容で再試行しても、エラーにならず追加もされない" "$R" ""
  fi
  chk "$NAME: 再試行後も結果は2件のまま" "$(cnt $U)" 2
  chk "$NAME: 再試行後も変更回数は1のまま" "$(chg $U)" 1
}
# 1) 直接INSERTが先に所有者ロック待ち、後からRPCが行ロック待ち → 後から待った側（RPC）がデッドロックで中断される
scenario "RPC中断" 00000000-0000-0000-0000-0000000f0001 2.0 0.3
# 2) RPCが先に行ロック待ち、後から直接INSERTが所有者ロック待ち → 後から待った側（直接INSERT）が中断される
scenario "INSERT中断" 00000000-0000-0000-0000-0000000f0002 0.3 2.0
echo "--- FAIL件数: $FAILS"
dropdb "$DB"
[ "$FAILS" = 0 ]
