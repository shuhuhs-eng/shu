#!/bin/bash
# 0071 同時送信の検証（ローカル専用）。0058適用済み＋0071適用済みのDB（既定 s71）で、使い捨てユーザーを作って実行する。
DB=${1:-s71}; N=${2:-20}; P="su postgres -c"
$P "psql -q -d $DB" <<'S' >/dev/null
insert into auth.users (id,email) select ('00000000-0000-0000-0000-'||lpad(to_hex(0xd000+g),12,'0'))::uuid, 'cc'||g||'@t' from generate_series(1,80) g on conflict do nothing;
insert into public.profiles (id,role) select ('00000000-0000-0000-0000-'||lpad(to_hex(0xd000+g),12,'0'))::uuid,'stylist' from generate_series(1,80) g on conflict do nothing;
delete from public.diagnosis_change_limits where user_id::text like '00000000-0000-0000-0000-0000000d%';
delete from public.diagnosis_results where user_id::text like '00000000-0000-0000-0000-0000000d%';
delete from public.student_diagnosis_results where user_id::text like '00000000-0000-0000-0000-0000000d%';
delete from public.stylist_diagnosis_current where user_id::text like '00000000-0000-0000-0000-0000000d%';
S
uid() { printf '00000000-0000-0000-0000-%012x' $((0xd000 + $1)); }
S_SQL() { echo "set role service_role; select public.commit_student_diagnosis('$1', gen_random_uuid(), 'v', jsonb_build_object('q1','$2','q2','$2','q3','$2','q4','$2','q5','$2','q6','$2','q7','$2','q9','$2','q10','$2','q11','$2','q12','$2','q13','$2','q14','$2'), '{}'::jsonb)->>'action';"; }
E_SQL() { echo "set role service_role; select public.commit_diagnosis_result('$1', gen_random_uuid(), true, '1.0.0', 'stylist', '$2'::jsonb, 50::smallint,50::smallint,50::smallint,50::smallint,50::smallint,50::smallint,'T1','x',50::smallint,'300-350')->>'action';"; }
FAIL=0
# 1) 同じ学生回答・別送信IDの同時保存 → 初回1件+変更なし（変更回数0）
for i in $(seq 1 $N); do u=$(uid $i)
  ( $P "psql -Atq -d $DB -c \"$(S_SQL $u a)\"" > /tmp/o1.$i 2>&1 & $P "psql -Atq -d $DB -c \"$(S_SQL $u a)\"" > /tmp/o2.$i 2>&1 & wait )
  r=$($P "psql -Atq -d $DB -c \"select (select count(*) from public.student_diagnosis_results where user_id='$u'), coalesce((select change_count from public.diagnosis_change_limits where user_id='$u' and kind='stylist'),-1), (select seq from public.stylist_diagnosis_current where user_id='$u')\"")
  [ "$r" = "1|0|1" ] || { FAIL=$((FAIL+1)); echo "NG1 $i: $r $(cat /tmp/o1.$i /tmp/o2.$i | tr '\n' ' ')"; }
done
# 2) 経験者A と 学生B を同時に初回保存 → 片方が初回、もう片方が変更1回（どちらも保存・連番1,2・ロックあり）
for i in $(seq 21 $((20+N))); do u=$(uid $i)
  ( $P "psql -Atq -d $DB -c \"$(S_SQL $u b)\"" > /tmp/o1.$i 2>&1 & $P "psql -Atq -d $DB -c \"$(E_SQL $u '[1,2]')\"" > /tmp/o2.$i 2>&1 & wait )
  r=$($P "psql -Atq -d $DB -c \"select (select count(*) from public.student_diagnosis_results where user_id='$u')+(select count(*) from public.diagnosis_results where user_id='$u'), (select change_count from public.diagnosis_change_limits where user_id='$u' and kind='stylist'), (select seq from public.stylist_diagnosis_current where user_id='$u'), (select (locked_until>now()) from public.diagnosis_change_limits where user_id='$u' and kind='stylist')\"")
  [ "$r" = "2|1|2|t" ] || { FAIL=$((FAIL+1)); echo "NG2 $i: $r"; }
done
# 3) 別の学生回答2つを同時に保存（初回済みの人・ロックなし）→ 片方だけ変更、もう片方は拒否（変更1回で止まる）
for i in $(seq 41 $((40+N))); do u=$(uid $i)
  $P "psql -Atq -d $DB -c \"$(S_SQL $u a)\"" >/dev/null 2>&1
  ( $P "psql -Atq -d $DB -c \"$(S_SQL $u b)\"" > /tmp/o1.$i 2>&1 & $P "psql -Atq -d $DB -c \"$(S_SQL $u c)\"" > /tmp/o2.$i 2>&1 & wait )
  r=$($P "psql -Atq -d $DB -c \"select (select count(*) from public.student_diagnosis_results where user_id='$u'), (select change_count from public.diagnosis_change_limits where user_id='$u' and kind='stylist')\"")
  [ "$r" = "2|1" ] || { FAIL=$((FAIL+1)); echo "NG3 $i: $r"; }
done
echo "同時送信の検証: 3種 x $N 回, 失敗 $FAIL"
