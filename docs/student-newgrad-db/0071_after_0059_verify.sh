#!/bin/bash
# 0071 を、0059 と 0070 が適用済みのDBに重ねて確認する（使い捨てDBのみ・本番には接続しない）。
# 適用順は2通りを両方確認する: 「0058→0070→0059→0071」（実際の本番の順）と「0058→0059→0070→0071」。
# 使い方: su postgres -c "bash 0071_after_0059_verify.sh"
D=$(cd "$(dirname "$0")" && pwd)
. "$(for c in "$D" "$D/../verify-0070-0071"; do [ -f "$c/verify_common.sh" ] && echo "$c/verify_common.sh" && break; done)" 2>/dev/null || { echo "ERROR: verify_common.sh が見つかりません" >&2; exit 2; }
vfy_preflight 0058_diagnosis_change_limits.draft.sql 0059_close_direct_paths.draft.sql 0059_postapply_check.sql 0059_rollback_permissions.sql 0070_stylist_profile_public.draft.sql \
  0071_student_newgrad.draft.sql 0071_rollback.draft.sql 0071_verify.sql 0071_verify_publish.sql 0071_constraint_verify.sql 0071_preapply_check.sql 0071_postapply_check.sql stub_supabase.sql
vfy_ensure_template
P0=vfy_a59_$$_; trap 'for x in a b c d e f; do vdb_drop ${P0}$x; done' EXIT
verdict() { psql -X -Atq -F'|' -d "$1" -f "$2" 2>&1 | grep -E '^99\|' | cut -d'|' -f2; }
q() { psql -X -Atq -d "$1" -c "$2" 2>&1; }
F58=0058_diagnosis_change_limits.draft.sql; F59=0059_close_direct_paths.draft.sql; F70=0070_stylist_profile_public.draft.sql; F71=0071_student_newgrad.draft.sql
# build DB ファイル… : テンプレート → 指定の順に適用
build() { local db=$1; shift; vdb_create "$db" "$VFY_TPL"; for f in "$@"; do
  vpsql -d "$db" -f "$(ffind "$f")" >/dev/null 2>"$VFY_ERR" || { grep -v NOTICE "$VFY_ERR" | head -3 >&2; vfy_die "$db の構築に失敗（$f）"; }; done; }

run_order() {  # run_order ラベル 識別子 順序のファイル…（0058は先頭に固定）
  local label=$1 id=$2; shift 2
  local pre=${P0}${id}1 a=${P0}${id}2 b=${P0}${id}3 U=00000000-0000-0000-0000-0000000a59$( [ "$id" = c ] && echo 01 || echo 02 )
  echo; echo "######## 適用順: $label"
  build $pre "$F58" "$@"
  vfy_chk "[$label] 0071の適用前チェックが総合 PASS（0071適用前）" "$(verdict $pre "$(ffind 0071_preapply_check.sql)")" "PASS"
  vfy_chk "[$label] 適用前の0059適用後チェックも総合 PASS" "$(verdict $pre "$(ffind 0059_postapply_check.sql)")" "PASS"
  build $a "$F58" "$@" "$F71"
  vfy_chk "[$label] 0059の適用後チェックが、0071の適用後も総合 PASS" "$(verdict $a "$(ffind 0059_postapply_check.sql)")" "PASS"
  vfy_chk "[$label] 0071の適用後チェックが総合 PASS" "$(verdict $a "$(ffind 0071_postapply_check.sql)")" "PASS"
  vfy_run_sql $a "[$label] 0071_verify.sql" "$(ffind 0071_verify.sql)"; vfy_record $?
  vfy_run_sql $a "[$label] 0071_verify_publish.sql" "$(ffind 0071_verify_publish.sql)"; vfy_record $?
  vfy_run_sql $a "[$label] 0071_constraint_verify.sql" "$(ffind 0071_constraint_verify.sql)"; vfy_record $?
  # アプリと同じ権限での動作（service_role: 学生診断の確定／authenticated: 区分の設定。直接書き込みは拒否）
  q $a "insert into auth.users (id,email) values ('$U','a59@t'); insert into public.profiles (id,role) values ('$U','stylist') on conflict do nothing; insert into public.user_roles (user_id,role) values ('$U','stylist') on conflict do nothing; insert into public.stylist_private (user_id,birth_date,age_display_mode) values ('$U',(current_date - interval '20 years')::date,'exact'); insert into public.stylist_profiles (user_id) values ('$U');" >/dev/null
  local ANS='{"q1":["a"],"q2":["a"],"q3":["a"],"q4":["a"],"q5":["a"],"q6":["a"],"q7":["a"],"q9":["a"],"q10":["a"],"q11":["a"],"q12":["a"],"q13":["a"],"q14":["a"]}'
  local FULL='{"q1":["a"],"q2":["a"],"q3":["a"],"q4":["a"],"q5":["a"],"q6":["a"],"q7":["a","b"],"q8":["a"],"q9":["work_life_balance","skill_growth"],"q10":["a"],"q11":["a"],"q12":["a"],"q13":["a"],"q14":["a"],"q15":["a"]}'
  local REQ=$(q $a "select gen_random_uuid()" | tail -1) REQ2=$(q $a "select gen_random_uuid()" | tail -1)
  vfy_chk "[$label] service_role: 学生診断の確定保存が動く（初回）" "$(q $a "set role service_role; select (public.commit_student_diagnosis('$U'::uuid,'$REQ'::uuid,'student_newgrad_v1','$ANS'::jsonb,'{\"x\":1}'::jsonb))->>'action'" | tail -1)" "initial"
  vfy_chk "[$label] 同じ送信IDの再送は前回の結果（replay）" "$(q $a "set role service_role; select (public.commit_student_diagnosis('$U'::uuid,'$REQ'::uuid,'student_newgrad_v1','$ANS'::jsonb,'{\"x\":1}'::jsonb))->>'replay'" | tail -1)" "true"
  vfy_chk "[$label] service_role: 結果表への直接INSERTは権限で拒否" "$(q $a "set role service_role; insert into public.student_diagnosis_results (user_id,version,answers,result) values ('$U','v','$ANS','{}')" | grep -c 'permission denied')" "1"
  vfy_chk "[$label] authenticated: 結果表への直接INSERTは権限で拒否" "$(q $a "set role authenticated; insert into public.student_diagnosis_results (user_id,version,answers,result) values ('$U','v','$ANS','{}')" | grep -c 'permission denied')" "1"
  vfy_chk "[$label] authenticated: 区分を設定できる" "$(q $a "set role authenticated; select set_config('request.jwt.claims','{\"sub\":\"$U\"}',false); select public.set_stylist_career_phase('experienced')" | grep -c ERROR)" "0"
  vfy_chk "[$label] 本人のJWTで自分の学生診断の結果を読める（RLS）" "$(q $a "set role authenticated; select set_config('request.jwt.claims','{\"sub\":\"$U\"}',false); select count(*) from public.student_diagnosis_results" | tail -1)" "1"
  vfy_chk "[$label] アプリが送る形（Q8・Q15・順位つきQ9を含む）の回答は別の回答として保存でき『変更』になる" "$(q $a "set role service_role; select (public.commit_student_diagnosis('$U'::uuid,'$REQ2'::uuid,'student_newgrad_v1','$FULL'::jsonb,'{\"x\":1}'::jsonb))->>'action'" | tail -1)" "change"
  vfy_chk "[$label] 他人のJWTでは読めない（RLS）" "$(q $a "set role authenticated; select set_config('request.jwt.claims','{\"sub\":\"00000000-0000-0000-0000-0000000a59ff\"}',false); select count(*) from public.student_diagnosis_results" | tail -1)" "0"
  vfy_chk "[$label] 0059で閉じた旧経路は0071のあとも閉じたまま（診断結果への直接INSERT）" "$(q $a "set role service_role; insert into public.diagnosis_results (user_id,diagnosis_version,mode,answers,craft_score,sense_score,hospitality_score,brand_score,drive_score,mentor_score,type_id,type_name,market_value_score,salary_band) values ('$U','v','stylist','{}',1,1,1,1,1,1,'t','n',50,'a')" | grep -c 'permission denied')" "1"
  vfy_chk "[$label] 0059で閉じた旧サロン保存関数は閉じたまま" "$(q $a "select (not has_function_privilege('authenticated','public.save_salon_culture_analysis_answers(text,jsonb,jsonb)','execute'))::text")" "true"
  # 0071だけの巻き戻し
  build $b "$F58" "$@" "$F71"
  out=$(psql -X -q -v ON_ERROR_STOP=1 -d $b -f "$(ffind 0071_rollback.draft.sql)" 2>&1); local rc=$?
  vfy_chk "[$label] 0071の巻き戻しが成功" "$rc" "0"
  vfy_chk "[$label] 0058の2関数が元の定義へ戻る" "$(q $b "select md5(prosrc) from pg_proc where proname='commit_diagnosis_result'")|$(q $b "select md5(prosrc) from pg_proc where proname='_trg_diagnosis_results_limit'")" "04fe4af9ea696398239f95f6f984b6f6|15df323841beef4372b72dc2e2d488e4"
  vfy_chk "[$label] 巻き戻し後も0059の適用後チェックは総合 PASS" "$(verdict $b "$(ffind 0059_postapply_check.sql)")" "PASS"
  vfy_chk "[$label] 巻き戻し後に0071を再適用できる" "$(psql -X -q -v ON_ERROR_STOP=1 -d $b -f "$(ffind $F71)" >/dev/null 2>&1; echo $?)" "0"
}
run_order "0058 → 0070 → 0059 → 0071（実際の本番の順）" c "$F70" "$F59"
run_order "0058 → 0059 → 0070 → 0071" d "$F59" "$F70"
vfy_exit
