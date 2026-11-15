#!/bin/bash
# 0071 適用の瞬間に診断保存が進行中でも、「現在の診断」の初期登録から漏れないことの検証（ローカル専用）。
# 0058→0070 を適用済みのDB(既定 s70)を複製して実行する。
BASE=${1:-s70}; DB=r71; P="su postgres -c"; D=$(cd "$(dirname "$0")" && pwd)
$P "psql -Atc 'drop database if exists $DB' -c 'create database $DB template $BASE'" >/dev/null
U=00000000-0000-0000-0000-0000000aa001
$P "psql -q -d $DB" <<S >/dev/null
insert into auth.users (id,email) values ('$U','race@t') on conflict do nothing;
insert into public.profiles (id,role) values ('$U','stylist') on conflict do nothing;
S
# A: 0058の（旧）関数で保存を開始し、確定を3秒遅らせる
$P "psql -q -d $DB" <<S >/tmp/race_a.out 2>&1 &
begin; set role service_role;
select public.commit_diagnosis_result('$U', gen_random_uuid(), true, '1.0.0', 'stylist', '[4,4]'::jsonb, 50::smallint,50::smallint,50::smallint,50::smallint,50::smallint,50::smallint,'T1','x',50::smallint,'300-350')->>'action';
reset role; select pg_sleep(3); commit;
S
sleep 1
# B: その最中に0071を適用（結果表のロック待ちになり、Aの確定後に進む）
$P "psql -q -v ON_ERROR_STOP=1 -d $DB -f $D/0071_student_newgrad.draft.sql" >/tmp/race_b.out 2>&1
wait
R=$($P "psql -Atq -d $DB -c \"select (select count(*) from public.diagnosis_results where user_id='$U'), (select seq from public.stylist_diagnosis_current where user_id='$U'), (select bank from public.stylist_diagnosis_current where user_id='$U')\"")
echo "適用中の保存あり: 結果1件・現在の診断=経験者(seq1) → 実際: $R"; [ "$R" = "1|1|experienced" ] && echo PASS || { echo FAIL; cat /tmp/race_b.out | grep -v NOTICE | head -5; }
# 適用後の保存は新しい関数・トリガーで処理（学生へ切替→変更1回）
$P "psql -Atq -d $DB -c \"set role service_role; select public.commit_student_diagnosis('$U', gen_random_uuid(), 'v', jsonb_build_object('q1','a','q2','a','q3','a','q4','a','q5','a','q6','a','q7','a','q9','a','q10','a','q11','a','q12','a','q13','a','q14','a'), '{}')->>'action'\"" | tail -1 | grep -qx change && echo "PASS 適用後: 学生への切替は変更1回" || echo "FAIL 適用後の切替"
