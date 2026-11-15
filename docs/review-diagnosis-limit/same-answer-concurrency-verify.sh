#!/bin/sh
# ローカル専用。「同じ回答・異なる送信ID」の同時保存で、回数を余計に消費しないことを検証する。
# 使い方: su postgres -c "sh same-answer-concurrency-verify.sh [コピー元DB名] [0058のSQLパス]"
set -e
SRC="${1:-hd57}"; DB=hd58s; DIR="$(cd "$(dirname "$0")" && pwd)"; SQLF="${2:-$DIR/0058_diagnosis_change_limits.draft.sql}"
dropdb --if-exists "$DB"; createdb -T "$SRC" "$DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$SQLF"
FAILS=0
chk() { if [ "$2" = "$3" ]; then echo "PASS  $1 (=$3)"; else echo "FAIL  $1 (期待 $3 / 実際 $2)"; FAILS=$((FAILS+1)); fi; }
mkuser() { psql -q -d "$DB" -c "insert into auth.users (id,email) values ('$1','$1@t'); update public.profiles set role='stylist' where id='$1';"; }
rpc() { # $1=user $2=answers $3=allow_change
  psql -Atq -d "$DB" -c "set role service_role; select pg_sleep(0.3); select public.commit_diagnosis_result('$1', gen_random_uuid(), $3,'1.0.0','stylist','$2'::jsonb,1::smallint,1::smallint,1::smallint,1::smallint,1::smallint,1::smallint,'T','T',1::smallint,'x')->>'action'" 2>&1 | grep -E 'ERROR|^[a-z_]+$' | head -1; }
ins() { # $1=user $2=answers
  psql -Atq -d "$DB" -c "set role service_role; select pg_sleep(0.3); insert into diagnosis_results (user_id, diagnosis_version, mode, answers, craft_score, sense_score, hospitality_score, brand_score, drive_score, mentor_score, type_id, type_name, market_value_score, salary_band) values ('$1','1.0.0','stylist','$2',1,1,1,1,1,1,'T','T',1,'x')" 2>&1 | grep -E 'ERROR' | head -1; }
cnt()  { psql -Atq -d "$DB" -c "select count(*) from diagnosis_results where user_id='$1'"; }
chg()  { psql -Atq -d "$DB" -c "select coalesce((select change_count::text from diagnosis_change_limits where user_id='$1' and kind='stylist'),'none')"; }
lck()  { psql -Atq -d "$DB" -c "select coalesce((select (locked_until is not null)::text from diagnosis_change_limits where user_id='$1' and kind='stylist'),'none')"; }
X='[1,2,3]'; Y='[3,2,1]'

for R in 10 11 12 13 14 15 16 17; do  # 競合は一瞬の隙間で起きるため、繰り返して確認する
# 1. 初回保存: 同じ回答・異なる送信ID（正規RPC）6件同時 → 結果1件・変更回数0・ロックなし
U=00000000-0000-0000-0000-0000000d01$R; mkuser $U
for i in 1 2 3 4 5 6; do rpc $U "$X" true >/dev/null & done; wait
chk "[$R回目] 1 初回・同一回答・別ID・RPC×6: 結果の件数" "$(cnt $U)" 1
chk "[$R回目] 1 同: 変更回数（初回で変更を消費しない）" "$(chg $U)" 0
chk "[$R回目] 1 同: ロックされない" "$(lck $U)" false

# 2. 初回保存: 直接INSERT 6件同時
U=00000000-0000-0000-0000-0000000d02$R; mkuser $U
for i in 1 2 3 4 5 6; do ins $U "$X" >/dev/null & done; wait
chk "[$R回目] 2 初回・同一回答・直接INSERT×6: 結果の件数" "$(cnt $U)" 1
chk "[$R回目] 2 同: 変更回数" "$(chg $U)" 0
chk "[$R回目] 2 同: ロックされない" "$(lck $U)" false

# 3. 初回保存: 正規RPC3件と直接INSERT3件の混在
U=00000000-0000-0000-0000-0000000d03$R; mkuser $U
for i in 1 2 3; do rpc $U "$X" true >/dev/null & ins $U "$X" >/dev/null & done; wait
chk "[$R回目] 3 初回・同一回答・RPCと直接INSERTの混在: 結果の件数" "$(cnt $U)" 1
chk "[$R回目] 3 同: 変更回数" "$(chg $U)" 0

done

# 4. 変更済みの同一回答を、異なる送信IDで再送（順次→同時）→ 余計に消費しない
U=00000000-0000-0000-0000-0000000d0004; mkuser $U
rpc $U "$X" true >/dev/null; rpc $U "$Y" true >/dev/null
chk "4 初回X→変更Y: 結果の件数" "$(cnt $U)" 2
chk "4 同: 変更回数" "$(chg $U)" 1
chk "4 同: ロック中" "$(lck $U)" true
rpc $U "$Y" true >/dev/null
chk "4 変更済みYを別IDで再送（順次）: 結果の件数" "$(cnt $U)" 2
for i in 1 2 3 4 5 6; do rpc $U "$Y" true >/dev/null & ins $U "$Y" >/dev/null & done; wait
chk "4 変更済みYを別IDで再送（RPC/直接INSERT混在×12 同時）: 結果の件数" "$(cnt $U)" 2
chk "4 同: 変更回数（余計に消費しない）" "$(chg $U)" 1

# 5. 異なる回答の同時保存は引き続き制限される（初回済みの状態から別々の回答を同時に）
U=00000000-0000-0000-0000-0000000d0005; mkuser $U
rpc $U "$X" true >/dev/null
for i in 1 2 3 4 5 6; do rpc $U "[7,$i]" true >/dev/null & done; wait
chk "5 異なる回答×6同時: 結果の件数（初回＋変更1回）" "$(cnt $U)" 2
chk "5 同: 変更回数" "$(chg $U)" 1
# 6. 初回直後に、別々の回答を同時に（初回と変更が競合）→ 初回1＋変更1まで
U=00000000-0000-0000-0000-0000000d0006; mkuser $U
for i in 1 2 3 4 5 6; do rpc $U "[8,$i]" true >/dev/null & ins $U "[6,$i]" >/dev/null & done; wait
chk "6 未保存から異なる回答×12同時: 結果の件数（初回＋変更1回まで）" "$(cnt $U)" 2
chk "6 同: 変更回数" "$(chg $U)" 1

echo "--- FAIL件数: $FAILS"
dropdb "$DB"
[ "$FAILS" = 0 ]
