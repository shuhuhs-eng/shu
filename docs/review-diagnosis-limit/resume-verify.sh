#!/bin/sh
# ローカル専用（本番では実行しない）。「0058適用 → 変更してロック → 巻き戻し → 巻き戻し中の保存 → 再開」の順で、
# 状態・変更回数・ロック日時・下書き・送信IDが失われないことを検証する。
# 使い方: su postgres -c "sh resume-verify.sh [コピー元DB名]"
set -e
SRC="${1:-hd57}"; DB=hd58u; DB2=hd58u2; DIR="$(cd "$(dirname "$0")" && pwd)"
dropdb --if-exists "$DB"; dropdb --if-exists "$DB2"; createdb -T "$SRC" "$DB"
FAILS=0
chk() { if [ "$2" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1 (期待 [$3] / 実際 [$2])"; FAILS=$((FAILS+1)); fi; }
chkne() { if [ "$2" != "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1 ($2)"; FAILS=$((FAILS+1)); fi; }
q() { psql -Atq -d "${DBX:-$DB}" "$@" 2>&1; }
E=00000000-0000-0000-0000-0000000e0001; N=00000000-0000-0000-0000-0000000e0002; W=00000000-0000-0000-0000-0000000e0003; S=00000000-0000-0000-0000-0000000e0004
mk() { q -c "insert into auth.users (id,email) values ('$1','$1@t'); update public.profiles set role='stylist' where id='$1';" >/dev/null; }
rpc() { # user answers allow req
  q -c "set role service_role; select public.commit_diagnosis_result('$1', '${4:-$(cat /proc/sys/kernel/random/uuid)}', ${3:-true},'1.0.0','stylist','$2'::jsonb,1::smallint,1::smallint,1::smallint,1::smallint,1::smallint,1::smallint,'T','T',1::smallint,'x')" | grep -E "ERROR|\"action\"" | head -1; }
ins() { q -c "set role service_role; insert into diagnosis_results (user_id, diagnosis_version, mode, answers, craft_score, sense_score, hospitality_score, brand_score, drive_score, mentor_score, type_id, type_name, market_value_score, salary_band) values ('$1','1.0.0','stylist','$2',1,1,1,1,1,1,'T','T',1,'x')" | grep -E "ERROR|INSERT" | head -1; }
act() { echo "$1" | sed -E 's/.*"action": "([a-z_]+)".*/\1/; s/^ERROR:  //'; }
state() { q -c "select kind||'|'||coalesce(user_id::text,store_id::text)||'|'||initial_saved_at||'|'||coalesce(last_change_at::text,'-')||'|'||change_count||'|'||coalesce(locked_until::text,'-') from diagnosis_change_limits $1 order by 1"; }
cntr() { q -c "select count(*) from diagnosis_results where user_id='$1'"; }
chg() { q -c "select change_count from diagnosis_change_limits where user_id='$1' and kind='stylist'"; }
lckd() { q -c "select locked_until from diagnosis_change_limits where user_id='$1' and kind='stylist'"; }

# --- 0. 導入前: 既存会員 E（結果1件）
mk $E; ins $E '[1]' >/dev/null
# --- 1. 0058 適用 → 変更してロック
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$DIR/0058_diagnosis_change_limits.draft.sql"
chk "1 既存会員Eは導入時に『初回保存済み・ロックなし・変更0』" "$(state "where user_id='$E'")" "stylist|$E|$(q -c "select initial_saved_at from diagnosis_change_limits where user_id='$E' and kind='stylist'")|-|0|-"
mk $N; rpc $N '[2]' true >/dev/null; REQ_N=$(cat /proc/sys/kernel/random/uuid); rpc $N '[3]' true "$REQ_N" >/dev/null
rpc $E '[9]' true >/dev/null
chk "1 N: 初回→変更でロック（変更回数1）" "$(chg $N)" 1
chk "1 E: 変更でロック（変更回数1）" "$(chg $E)" 1
# サロンの下書き
q -c "insert into auth.users (id,email) values ('$S','s@t'); update public.profiles set role='salon' where id='$S'; insert into public.user_roles (user_id, role) values ('$S','salon') on conflict do nothing;" >/dev/null
B12='{"q1_education_support":3,"q2_challenge_openness":3,"q3_personal_brand_support":3,"q4_team_collaboration":3,"q5_individual_autonomy":3,"q6_work_flexibility":3,"q7_technical_specialization":3,"q8_premium_value":3,"q9_trend_orientation":3,"q10_creative_output":3,"q11_relationship_distance":3,"q12_hierarchy_flatness":3}'
q -c "set role authenticated; select set_config('request.jwt.claims','{\"sub\":\"$S\"}',false); select public.save_salon_culture_draft(null, '{\"respondent_role\":\"owner_representative\",\"current_step\":5,\"answers\":$B12,\"value_priorities\":[\"skill_growth\",\"teamwork\",\"independence\"],\"comment\":\"下書き\"}'::jsonb)" >/dev/null
chk "1 下書きが1件ある" "$(q -c "select count(*) from salon_culture_drafts")" 1
SNAP_STATE="$(state)"; SNAP_DRAFT="$(q -c "select md5(string_agg(t::text,'|' order by id)) from salon_culture_drafts t")"; SNAP_REQ="$(q -c "select md5(string_agg(t::text,'|' order by request_id)) from diagnosis_save_requests t")"
LOCK_E="$(lckd $E)"; LOCK_N="$(lckd $N)"
# --- 2. 巻き戻し
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$DIR/0058_rollback.draft.sql"
chk "2 巻き戻し後: 状態表の全行が不変（変更回数・ロック日時とも）" "$(state)" "$SNAP_STATE"
chk "2 巻き戻し後: 下書きが不変" "$(q -c "select md5(string_agg(t::text,'|' order by id)) from salon_culture_drafts t")" "$SNAP_DRAFT"
chk "2 巻き戻し後: 送信IDの記録が不変" "$(q -c "select md5(string_agg(t::text,'|' order by request_id)) from diagnosis_save_requests t")" "$SNAP_REQ"
chk "2 巻き戻し後: 0058本体の再実行では復旧できない（表が既にあるためエラー）" "$(psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$DIR/0058_diagnosis_change_limits.draft.sql" 2>&1 | grep -c 'already exists')" 1
# --- 3. 巻き戻し中の保存（制限なし）
ins $E '[11]' >/dev/null; ins $N '[12]' >/dev/null; mk $W; ins $W '[20]' >/dev/null
chk "3 巻き戻し中: E・N・Wの保存が通る（制限なし）" "$(cntr $E)-$(cntr $N)-$(cntr $W)" "3-3-1"
echo "--- 再開前チェック（INFO）"; psql -q -d "$DB" -f "$DIR/0058_resume_precheck.sql" | sed 's/^/    /' | head -14
chk "3 再開前チェック: 巻き戻し中に保存された結果（記録のある所有者E・N）=2、うちロック中=2" "$(q -f "$DIR/0058_resume_precheck.sql" | grep -E '^(6|7)\|' | cut -d'|' -f4 | tr '\n' ',')" "2,2,"
chk "3 再開前チェック: 状態表に記録の無い所有者=1（W）" "$(q -f "$DIR/0058_resume_precheck.sql" | grep -E '^4\|' | cut -d'|' -f4)" 1
# --- 4. 再開
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$DIR/0058_resume.draft.sql"
chk "4 再開後: E・Nの状態行（変更回数・ロック日時）が巻き戻し前のまま" "$(state "where user_id in ('$E','$N')")" "$(echo "$SNAP_STATE" | grep -E "$E|$N")"
chk "4 再開後: 巻き戻し中の保存は消えていない（E=3, N=3, W=1）" "$(cntr $E)-$(cntr $N)-$(cntr $W)" "3-3-1"
chk "4 再開後: Wに『初回保存済み・ロックなし・変更0』が作られた" "$(q -c "select change_count||'|'||coalesce(locked_until::text,'-') from diagnosis_change_limits where user_id='$W' and kind='stylist'")" "0|-"
chk "4 再開後: 下書きが不変" "$(q -c "select md5(string_agg(t::text,'|' order by id)) from salon_culture_drafts t")" "$SNAP_DRAFT"
chk "4 再開後: 送信IDの記録が不変" "$(q -c "select md5(string_agg(t::text,'|' order by request_id)) from diagnosis_save_requests t")" "$SNAP_REQ"
chk "4 再開後: 状態表のコメントが元に戻る（巻き戻し時刻の記録が残らない）" "$(q -c "select (obj_description('public.diagnosis_change_limits'::regclass,'pg_class') like 'rolled_back_at=%')::text")" false
chk "4 再開後: 制限のトリガー4つ" "$(q -c "select count(*) from pg_trigger where tgname in ('trg_diagnosis_results_limit','trg_salon_culture_profiles_limit','trg_salon_store_culture_profiles_limit','trg_salon_culture_analysis_limit') and not tgisinternal")" 4
chk "4 再開後: 適用後チェックが総合PASS" "$(q -f "$DIR/0058_postapply_check.sql" | grep -E '^99\|' | cut -d'|' -f2)" PASS
# --- 5. 再開後の挙動
R=$(rpc $E '[77]' true); chk "5 E(ロック中): 回答を変える保存は拒否される" "$(act "$R")" "diagnosis_change_locked"
chk "5 E: ロック日時が巻き戻し前のまま" "$(lckd $E)" "$LOCK_E"
chk "5 E: 巻き戻し中の最新回答[11]と同じ保存は『変更なし』で数えない" "$(act "$(rpc $E '[11]' true)")" "unchanged"
chk "5 E: 変更回数は1のまま" "$(chg $E)" 1
chk "5 N: 巻き戻し前の送信IDを同じ内容で再送→再送扱い（二重に数えない）" "$(rpc $N '[3]' true "$REQ_N" | grep -o '"replay": true' | head -1)" '"replay": true'
chk "5 N: ロック日時が巻き戻し前のまま" "$(lckd $N)" "$LOCK_N"
R=$(ins $E '[78]'); chk "5 E: 直接INSERT（旧経路）の変更もロック中は拒否" "$(echo "$R" | sed 's/^ERROR:  //')" "diagnosis_change_locked"
chk "5 W: 再開後に1回変更でき（ロックされる）" "$(act "$(rpc $W '[21]' true)")" "change"
R=$(rpc $W '[22]' true); chk "5 W: 続けての変更は拒否" "$(act "$R")" "diagnosis_change_locked"
# --- 6. 再開の再実行（何度実行しても同じ）
BEFORE="$(state)"; psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$DIR/0058_resume.draft.sql"
chk "6 再開SQLを再実行しても、状態が変わらない" "$(state)" "$BEFORE"
# --- 7. 関数定義が、0058を新規適用した場合と同一
createdb -T "$SRC" "$DB2"; psql -q -v ON_ERROR_STOP=1 -d "$DB2" -f "$DIR/0058_diagnosis_change_limits.draft.sql"
FD="select md5(string_agg(pg_get_functiondef(p.oid), '|' order by p.proname, p.oid::regprocedure::text)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like '\\_diag%' or p.proname in ('commit_diagnosis_result','get_diagnosis_change_status','save_salon_culture_draft','discard_salon_culture_draft','confirm_salon_culture_diagnosis') or p.proname like '\\_trg\\_%limit%')"
chk "7 再開後の関数定義が、新規適用と完全に同じ" "$(q -c "$FD")" "$(DBX=$DB2 q -c "$FD")"
PRV="select md5(string_agg(p.oid::regprocedure::text||(select string_agg(a::text, ',' order by a::text) from unnest(coalesce(p.proacl, acldefault('f',p.proowner))) a), '|' order by p.oid::regprocedure::text)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like '\\_diag%' or p.proname in ('commit_diagnosis_result','get_diagnosis_change_status','save_salon_culture_draft','discard_salon_culture_draft','confirm_salon_culture_diagnosis') or p.proname like '\\_trg\\_%limit%')"
chk "7 再開後の関数の権限が、新規適用と完全に同じ" "$(q -c "$PRV")" "$(DBX=$DB2 q -c "$PRV")"
dropdb "$DB2"
# --- 8. 0058未適用のDBでは再開を拒否
createdb -T "$SRC" "$DB2"
chk "8 0058未適用のDBでは、再開SQLが拒否される" "$(psql -q -v ON_ERROR_STOP=1 -d "$DB2" -f "$DIR/0058_resume.draft.sql" 2>&1 | grep -c 'resume refused')" 1
dropdb "$DB2"
# --- 9. 本体と再開SQLの定義がずれていない
python3 "$DIR/make-resume.py" /var/tmp/resume.regen.sql >/dev/null
chk "9 再開SQLが、0058本体から機械的に作ったものと一致（ずれなし）" "$(cmp -s /var/tmp/resume.regen.sql "$DIR/0058_resume.draft.sql" && echo same || echo differ)" same
chk "9 再開SQLにpsql専用コマンド(\\から始まる行)が無い（SQLエディタ用）" "$(grep -c '^\\\\' "$DIR/0058_resume.draft.sql" || true)" 0
echo "--- FAIL件数: $FAILS"
dropdb "$DB"
[ "$FAILS" = 0 ]
