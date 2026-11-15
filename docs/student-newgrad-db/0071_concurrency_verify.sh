#!/bin/bash
# 0071 同時送信の検証（ローカル専用・使い捨てDBのみ）。固定のsleepに頼らず、片方の保存を開いたまま保持し、
# もう片方が実際にロック待ちになったこと（pg_stat_activity）を確認してから、結果を検証する。失敗・SQLエラーは非ゼロで終了。
D=$(cd "$(dirname "$0")" && pwd)
. "$(for c in "$D" "$D/../verify-0070-0071"; do [ -f "$c/verify_common.sh" ] && echo "$c/verify_common.sh" && break; done)" 2>/dev/null || { echo "ERROR: verify_common.sh が見つかりません（同じディレクトリに置いてください）" >&2; exit 2; }
vfy_preflight 0058_diagnosis_change_limits.draft.sql 0070_stylist_profile_public.draft.sql 0071_student_newgrad.draft.sql stub_supabase.sql
vfy_ensure_template
DB=vfy_cc_$$; trap 'vdb_drop $DB; rm -rf "$VFY_TMPD"' EXIT
vfy_build_chain $DB 0071
ans() { echo "jsonb_build_object('q1','$1','q2','$1','q3','$1','q4','$1','q5','$1','q6','$1','q7','$1','q9','$1','q10','$1','q11','$1','q12','$1','q13','$1','q14','$1')"; }
S_CALL() { echo "select public.commit_student_diagnosis('$1', gen_random_uuid(), 'v', $(ans $2), '{}'::jsonb)->>'action'"; }
E_CALL() { echo "select public.commit_diagnosis_result('$1', gen_random_uuid(), true, '1.0.0', 'stylist', '$2'::jsonb, 50::smallint,50::smallint,50::smallint,50::smallint,50::smallint,50::smallint,'T1','x',50::smallint,'300-350')->>'action'"; }
uid() { printf '00000000-0000-0000-0000-%012x' $((0xd000 + $1)); }
newuser() { psql -X -q -v ON_ERROR_STOP=1 -d $DB -c "insert into auth.users(id,email) values ('$1','c@t') on conflict do nothing; insert into public.profiles(id,role) values ('$1','stylist') on conflict do nothing;" >/dev/null || vfy_die "利用者の準備に失敗"; }
qn() { psql -X -Atq -d $DB -c "$1" 2>&1; }
# 保持側（SQL本文）を開いたまま3秒保持 → 待ち側を開始 → ロック待ちを確認 → 両方の完了を待つ
# 引数: 利用者 ラベル 保持側のSQL 待ち側のSQL 待ち側を特定する断片
two() {
  local u=$1 label=$2 hold=$3 wait=$4 frag=$5
  vfy_bg hold psql -X -q -v ON_ERROR_STOP=1 -d $DB -c "begin; set local role service_role; $hold; reset role; select pg_sleep(3); commit;"
  vfy_expect_held $DB "pg_sleep(3)" "$label 保持側"
  vfy_bg wait psql -X -q -v ON_ERROR_STOP=1 -d $DB -c "set role service_role; $wait"
  vfy_expect_blocked $DB "$frag" "$label 待ち側が保持側のロックを待つ"
  vfy_join hold wait
}
RUNS=${RUNS:-3}
for i in $(seq 1 $RUNS); do
  # 1) 同じ学生回答・別の送信ID: 保持側=初回、待ち側=変更なし（変更回数0・結果1件）
  u=$(uid $i); newuser $u
  two $u "[$i] 同じ回答・別送信ID" "$(S_CALL $u a)" "$(S_CALL $u a)" "commit_student_diagnosis"
  vfy_chk "[$i] 同じ回答・別送信ID: 両方成功" "$(vfy_rc hold)$(vfy_rc wait)" "00"
  vfy_has "[$i] 同じ回答・別送信ID: 待ち側は変更なし" "$(vfy_out wait)" "unchanged"
  vfy_chk "[$i] 同じ回答・別送信ID: 結果1件・変更回数0・連番1" "$(qn "select (select count(*) from public.student_diagnosis_results where user_id='$u')||'|'||(select change_count from public.diagnosis_change_limits where user_id='$u' and kind='stylist')||'|'||(select seq from public.stylist_diagnosis_current where user_id='$u')")" "1|0|1"
  # 2) 経験者A(保持側・初回) と 学生B(待ち側): 学生Bは「変更1回」として保存・ロック
  u=$(uid $((20+i))); newuser $u
  two $u "[$i] 経験者A×学生B" "$(E_CALL $u '[1,2]')" "$(S_CALL $u b)" "commit_student_diagnosis"
  vfy_chk "[$i] 経験者A×学生B: 両方成功" "$(vfy_rc hold)$(vfy_rc wait)" "00"
  vfy_chk "[$i] 経験者A×学生B: 結果計2件・変更回数1・連番2・ロック中・現在=学生" "$(qn "select (select count(*) from public.student_diagnosis_results where user_id='$u')+(select count(*) from public.diagnosis_results where user_id='$u')||'|'||(select change_count from public.diagnosis_change_limits where user_id='$u' and kind='stylist')||'|'||(select seq from public.stylist_diagnosis_current where user_id='$u')||'|'||(select (locked_until>now())::int from public.diagnosis_change_limits where user_id='$u' and kind='stylist')||'|'||(select bank from public.stylist_diagnosis_current where user_id='$u')")" "2|1|2|1|student"
  # 3) 別の学生回答2つ（初回済み）: 保持側=変更b、待ち側=別の回答c → 待ち側は変更回数の上限で拒否される
  u=$(uid $((40+i))); newuser $u
  psql -X -q -v ON_ERROR_STOP=1 -d $DB -c "set role service_role; $(S_CALL $u a)" >/dev/null || vfy_die "初回保存に失敗"
  two $u "[$i] 別回答の同時保存" "$(S_CALL $u b)" "$(S_CALL $u c)" "commit_student_diagnosis"
  vfy_chk "[$i] 別回答の同時保存: 保持側は成功" "$(vfy_rc hold)" "0"
  vfy_chk "[$i] 別回答の同時保存: 待ち側はロック中として拒否（非ゼロ）" "$([ "$(vfy_rc wait)" != 0 ] && echo yes || echo no)" "yes"
  vfy_has "[$i] 別回答の同時保存: 拒否の理由" "$(vfy_out wait)" "diagnosis_change_locked"
  vfy_chk "[$i] 別回答の同時保存: 結果2件・変更回数1" "$(qn "select (select count(*) from public.student_diagnosis_results where user_id='$u')||'|'||(select change_count from public.diagnosis_change_limits where user_id='$u' and kind='stylist')")" "2|1"
done
vfy_exit
