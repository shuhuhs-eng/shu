#!/bin/bash
# 0071 を「0058→0059→0070」が適用済みのDB（本番と同じ状態）に重ねて確認する（使い捨てDBのみ・本番には接続しない）。
# 使い方: su postgres -c "bash 0071_after_0059_verify.sh"
D=$(cd "$(dirname "$0")" && pwd)
. "$(for c in "$D" "$D/../verify-0070-0071"; do [ -f "$c/verify_common.sh" ] && echo "$c/verify_common.sh" && break; done)" 2>/dev/null || { echo "ERROR: verify_common.sh が見つかりません" >&2; exit 2; }
vfy_preflight 0058_diagnosis_change_limits.draft.sql 0059_close_direct_paths.draft.sql 0059_postapply_check.sql 0059_rollback_permissions.sql 0070_stylist_profile_public.draft.sql \
  0071_student_newgrad.draft.sql 0071_rollback.draft.sql 0071_verify.sql 0071_verify_publish.sql 0071_constraint_verify.sql 0071_postapply_check.sql stub_supabase.sql
vfy_ensure_template
P=vfy_a59_$$_; trap 'for x in a b; do vdb_drop ${P}$x; done' EXIT
verdict() { psql -X -Atq -F'|' -d "$1" -f "$2" 2>&1 | grep -E '^99\|' | cut -d'|' -f2; }
U=00000000-0000-0000-0000-0000000a5901

echo "== 本番と同じ順序: 0058 → 0059 → 0070 → 0071"
build() { vdb_create "$1" "$VFY_TPL"; for f in 0058_diagnosis_change_limits.draft.sql 0059_close_direct_paths.draft.sql 0070_stylist_profile_public.draft.sql "${@:2}"; do
  vpsql -d "$1" -f "$(ffind "$f")" >/dev/null 2>"$VFY_ERR" || { grep -v NOTICE "$VFY_ERR" | head -3 >&2; vfy_die "$1 の構築に失敗（$f）"; }; done; }
build ${P}a 0071_student_newgrad.draft.sql
vfy_chk "0059の適用後チェックが 0071 適用後も総合 PASS" "$(verdict ${P}a "$(ffind 0059_postapply_check.sql)")" "PASS"
vfy_chk "0071の適用後チェックが総合 PASS（0059適用済みの状態）" "$(verdict ${P}a "$(ffind 0071_postapply_check.sql)")" "PASS"
vfy_run_sql ${P}a "0071_verify.sql（0059適用済み）" "$(ffind 0071_verify.sql)"; vfy_record $?
vfy_run_sql ${P}a "0071_verify_publish.sql（0059適用済み）" "$(ffind 0071_verify_publish.sql)"; vfy_record $?
vfy_run_sql ${P}a "0071_constraint_verify.sql（0059適用済み）" "$(ffind 0071_constraint_verify.sql)"; vfy_record $?

echo "== アプリと同じ権限で動く（service_role: 学生診断の確定／authenticated: 区分の設定。直接書き込みは拒否）"
q() { psql -X -Atq -d "$1" -c "$2" 2>&1; }
q ${P}a "insert into auth.users (id,email) values ('$U','a59@t'); insert into public.profiles (id,role) values ('$U','stylist') on conflict do nothing; insert into public.user_roles (user_id,role) values ('$U','stylist') on conflict do nothing; insert into public.stylist_private (user_id,birth_date,age_display_mode) values ('$U',(current_date - interval '20 years')::date,'exact'); insert into public.stylist_profiles (user_id) values ('$U');" >/dev/null
ANS='{"q1":["a"],"q2":["a"],"q3":["a"],"q4":["a"],"q5":["a"],"q6":["a"],"q7":["a"],"q9":["a"],"q10":["a"],"q11":["a"],"q12":["a"],"q13":["a"],"q14":["a"]}'
REQ=$(q ${P}a "select gen_random_uuid()" | tail -1)
vfy_chk "service_role: 学生診断の確定保存が動く（初回）" "$(q ${P}a "set role service_role; select (public.commit_student_diagnosis('$U'::uuid,'$REQ'::uuid,'student_newgrad_v1','$ANS'::jsonb,'{\"x\":1}'::jsonb))->>'action'" | tail -1)" "initial"
vfy_chk "同じ送信IDの再送は前回の結果（replay）" "$(q ${P}a "set role service_role; select (public.commit_student_diagnosis('$U'::uuid,'$REQ'::uuid,'student_newgrad_v1','$ANS'::jsonb,'{\"x\":1}'::jsonb))->>'replay'" | tail -1)" "true"
vfy_chk "service_role: 結果表への直接INSERTは権限で拒否" "$(q ${P}a "set role service_role; insert into public.student_diagnosis_results (user_id,version,answers,result) values ('$U','v','$ANS','{}')" | grep -c 'permission denied')" "1"
vfy_chk "authenticated: 結果表への直接INSERTは権限で拒否" "$(q ${P}a "set role authenticated; insert into public.student_diagnosis_results (user_id,version,answers,result) values ('$U','v','$ANS','{}')" | grep -c 'permission denied')" "1"
vfy_chk "authenticated: 区分を設定できる" "$(q ${P}a "set role authenticated; select set_config('request.jwt.claims','{\"sub\":\"$U\"}',false); select public.set_stylist_career_phase('experienced')" | grep -c ERROR)" "0"
vfy_chk "本人のJWTで、自分の学生診断の結果を読める（RLS）" "$(q ${P}a "set role authenticated; select set_config('request.jwt.claims','{\"sub\":\"$U\"}',false); select count(*) from public.student_diagnosis_results" | tail -1)" "1"
REQ2=$(q ${P}a "select gen_random_uuid()" | tail -1)
FULL='{"q1":["a"],"q2":["a"],"q3":["a"],"q4":["a"],"q5":["a"],"q6":["a"],"q7":["a","b"],"q8":["a"],"q9":["work_life_balance","skill_growth"],"q10":["a"],"q11":["a"],"q12":["a"],"q13":["a"],"q14":["a"],"q15":["a"]}'
vfy_chk "アプリが送る形（Q8・Q15・順位つきQ9を含む）の回答も、別の回答として保存でき『変更』になる" "$(q ${P}a "set role service_role; select (public.commit_student_diagnosis('$U'::uuid,'$REQ2'::uuid,'student_newgrad_v1','$FULL'::jsonb,'{\"x\":1}'::jsonb))->>'action'" | tail -1)" "change"
vfy_chk "他人のJWTでは読めない（RLS）" "$(q ${P}a "set role authenticated; select set_config('request.jwt.claims','{\"sub\":\"00000000-0000-0000-0000-0000000a59ff\"}',false); select count(*) from public.student_diagnosis_results" | tail -1)" "0"
vfy_chk "0059で閉じた旧経路は 0071 のあとも閉じたまま（診断結果への直接INSERT）" "$(q ${P}a "set role service_role; insert into public.diagnosis_results (user_id,diagnosis_version,mode,answers,craft_score,sense_score,hospitality_score,brand_score,drive_score,mentor_score,type_id,type_name,market_value_score,salary_band) values ('$U','v','stylist','{}',1,1,1,1,1,1,'t','n',50,'a')" | grep -c 'permission denied')" "1"

echo "== 0071 だけを巻き戻せる（0059はそのまま）"
build ${P}b 0071_student_newgrad.draft.sql
out=$(psql -X -q -v ON_ERROR_STOP=1 -d ${P}b -f "$(ffind 0071_rollback.draft.sql)" 2>&1); rc=$?
vfy_chk "0071の巻き戻しが成功" "$rc" "0"
vfy_chk "0058の2関数が元の定義へ戻る" "$(psql -X -Atq -d ${P}b -c "select md5(prosrc) from pg_proc where proname='commit_diagnosis_result'")|$(psql -X -Atq -d ${P}b -c "select md5(prosrc) from pg_proc where proname='_trg_diagnosis_results_limit'")" "04fe4af9ea696398239f95f6f984b6f6|15df323841beef4372b72dc2e2d488e4"
vfy_chk "巻き戻し後も 0059 の適用後チェックは総合 PASS" "$(verdict ${P}b "$(ffind 0059_postapply_check.sql)")" "PASS"
vfy_exit
