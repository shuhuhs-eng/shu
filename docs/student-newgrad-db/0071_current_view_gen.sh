#!/bin/bash
# 「現在の診断」の遷移シナリオをローカルDBで実行し、各ステップ後の状態をJSONで書き出す（使い捨てDBのみ・本番には接続しない）。
# 使い方: su postgres -c "bash 0071_current_view_gen.sh <出力JSONのパス>"
# 判定（DBが指す現在の結果と画面表示の一致）は 0071_current_view_check.ts が行う（0071_current_view_verify.sh が両方を実行する）。
D=$(cd "$(dirname "$0")" && pwd); OUTJ=${1:?出力JSONのパスを指定してください}
. "$(for c in "$D" "$D/../verify-0070-0071"; do [ -f "$c/verify_common.sh" ] && echo "$c/verify_common.sh" && break; done)" 2>/dev/null || { echo "ERROR: verify_common.sh が見つかりません" >&2; exit 2; }
vfy_preflight 0058_diagnosis_change_limits.draft.sql 0059_close_direct_paths.draft.sql 0070_stylist_profile_public.draft.sql 0071_student_newgrad.draft.sql stub_supabase.sql
vfy_ensure_template
DB=vfy_cv_$$; trap 'vdb_drop $DB' EXIT
vdb_create $DB "$VFY_TPL"
for f in 0058_diagnosis_change_limits.draft.sql 0070_stylist_profile_public.draft.sql 0059_close_direct_paths.draft.sql 0071_student_newgrad.draft.sql; do   # 実際の本番の順
  vpsql -d $DB -f "$(ffind $f)" >/dev/null 2>"$VFY_ERR" || { grep -v NOTICE "$VFY_ERR" | head -3 >&2; vfy_die "適用失敗: $f"; }; done
U=00000000-0000-0000-0000-0000000c0a01
q() { psql -X -Atq -d $DB -c "$1" 2>&1; }
q "insert into auth.users (id,email) values ('$U','cv@t'); insert into public.profiles (id,role) values ('$U','stylist') on conflict do nothing; insert into public.user_roles (user_id,role) values ('$U','stylist') on conflict do nothing; insert into public.stylist_private (user_id,birth_date,age_display_mode) values ('$U',(current_date - interval '20 years')::date,'exact'); insert into public.stylist_profiles (user_id) values ('$U');" >/dev/null
rid() { q "select gen_random_uuid()" | tail -1; }
exp() { q "set role service_role; select (public.commit_diagnosis_result('$U'::uuid,'$1'::uuid,true,'1.0.0','stylist'::public.diagnosis_mode,'{\"v\":$2}'::jsonb,50::smallint,50::smallint,50::smallint,50::smallint,50::smallint,50::smallint,'T1','タイプ',50::smallint,'300-350'))->>'action'" 2>&1; }
stu() { q "set role service_role; select (public.commit_student_diagnosis('$U'::uuid,'$1'::uuid,'student_newgrad_v1','{\"q1\":[\"$2\"],\"q2\":[\"a\"],\"q3\":[\"a\"],\"q4\":[\"a\"],\"q5\":[\"a\"],\"q6\":[\"a\"],\"q7\":[\"a\"],\"q9\":[\"a\"],\"q10\":[\"a\"],\"q11\":[\"a\"],\"q12\":[\"a\"],\"q13\":[\"a\"],\"q14\":[\"a\"]}'::jsonb,'{\"x\":1}'::jsonb))->>'action'" 2>&1 | tail -1; }
unlock() { q "update public.diagnosis_change_limits set locked_until = now() - interval '1 day' where kind='stylist' and user_id='$U'" >/dev/null; }   # 3か月の経過を模す（ローカルのみ）
snap() { q "select json_build_object('current', (select json_build_object('bank',bank,'result_id',result_id,'seq',seq) from public.stylist_diagnosis_current where user_id='$U'),
  'latest_experienced_id', (select id from public.diagnosis_results where user_id='$U' and mode='stylist' order by created_at desc, id desc limit 1),
  'latest_student_id', (select id from public.student_diagnosis_results where user_id='$U' order by created_at desc, id desc limit 1),
  'experienced_rows', (select coalesce(json_agg(json_build_object('id',id,'user_id',user_id,'mode','stylist','created_at',created_at) order by created_at, id),'[]'::json) from public.diagnosis_results where user_id='$U' and mode='stylist'),
  'student_rows', (select coalesce(json_agg(json_build_object('id',id,'user_id',user_id,'answers','{}'::json,'version','v','created_at',created_at) order by created_at, id),'[]'::json) from public.student_diagnosis_results where user_id='$U'),
  'experienced_count', (select count(*) from public.diagnosis_results where user_id='$U' and mode='stylist'),
  'student_count', (select count(*) from public.student_diagnosis_results where user_id='$U'),
  'change_count', (select change_count from public.diagnosis_change_limits where kind='stylist' and user_id='$U'))"; }
STEPS=""; add() { STEPS="$STEPS${STEPS:+,}$(echo "{\"step\":\"$1\",\"outcome\":\"$2\",\"state\":$(snap)}")"; }

R1=$(rid); o=$(exp $R1 1 | tail -1);                  add "1.経験者の初回保存" "$o"
R2=$(rid); o=$(stu $R2 a);                  add "2.経験者→学生（変更・ロック開始）" "$o"
R3=$(rid); o=$(exp $R3 2);                  add "3.学生→経験者（ロック中・変更拒否）" "$(echo "$o" | grep -o 'diagnosis_change_locked' | head -1)"
o=$(stu $R2 a);                             add "4.学生の同じ送信IDの再送" "$o"
R5=$(rid); o=$(stu $R5 a);                  add "5.学生の同じ回答・別の送信ID（変更なし）" "$o"
unlock;      R6=$(rid); o=$(exp $R6 2 | tail -1);     add "6.ロック解除後: 学生→経験者" "$o"
o=$(exp $R6 2 | tail -1);                 add "7.経験者の同じ送信IDの再送" "$o"
unlock;      R8=$(rid); o=$(stu $R8 b);     add "8.ロック解除後: 経験者→学生（別の学生回答）" "$o"
R9=$(rid); o=$(stu $R9 b);                  add "9.学生の同じ回答・別の送信ID（変更なし）" "$o"
echo "[$STEPS]" > "$OUTJ" || vfy_die "JSONを書き出せません: $OUTJ"; echo "シナリオの状態を $OUTJ に書き出しました（9ステップ）"
