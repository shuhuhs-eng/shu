#!/bin/sh
# ローカル専用。同時要求で「既存結果なしの確認→初回結果保存」が競合しても、初回結果が複数保存されないことをDB側で検証する。
# 使い方: su postgres -c "sh concurrency-verify.sh [コピー元DB名]"
set -e
SRC="${1:-hd57}"; DB=hd58c; DIR="$(cd "$(dirname "$0")" && pwd)"
dropdb --if-exists "$DB"; createdb -T "$SRC" "$DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$DIR/0058_diagnosis_change_limits.draft.sql"
U=00000000-0000-0000-0000-00000000c001
psql -q -d "$DB" <<SQL
insert into auth.users (id,email) values ('$U','c@t');
update public.profiles set role='stylist' where id='$U';
insert into pending_diagnoses (id, mode, answers, diagnosis_version) select ('00000000-0000-0000-0000-0000000000a' || g)::uuid, 'stylist', '[0]'::jsonb, '1.0.0' from generate_series(1,6) g;
SQL
# 6件のセッションが同時に、別々のゲスト診断(別pending)を「引き継ぎ(p_allow_change=false)」で保存しようとする
run() { psql -Atq -d "$DB" -c "set role service_role; select pg_sleep(0.3); select coalesce((select public.commit_diagnosis_result('$U', gen_random_uuid(), false,'1.0.0','stylist','[$1]'::jsonb,1::smallint,1::smallint,1::smallint,1::smallint,1::smallint,1::smallint,'T','T',1::smallint,'x','00000000-0000-0000-0000-0000000000a$1')->>'action'),'')" 2>&1 | grep -E 'ERROR|^[a-z_]+$' | head -1; }
rm -f /var/tmp/hc?.out
for i in 1 2 3 4 5 6; do run $i > /var/tmp/hc$i.out & done; wait
echo "--- 同時引き継ぎ6件の結果（期待: 1件 保存、5件 拒否）"
cat /var/tmp/hc?.out | sed 's/^ERROR:  //' | sort | uniq -c
echo "--- 保存された結果の件数（期待: 1）"
psql -Atq -d "$DB" -c "select count(*) from diagnosis_results where user_id='$U'"
# サービスロールによる直接INSERT（0059適用前の経路）も、トリガーが同じゲートで数える。
# （回答が同じなら「同一内容の再保存」として追加も消費もしない。ここでは回答を変えて試す）
# 初回の次に許される変更は1回だけなので、同時4件のうち1件だけが通り、残りは拒否される（合計は初回＋1回の2件まで）。
echo "--- 直接INSERT4件を同時に（期待: 1件通過=空行、3件 拒否。合計2件）"
runi() { A="[9$1]"; psql -Atq -d "$DB" -c "set role service_role; select pg_sleep(0.3); insert into diagnosis_results (user_id, diagnosis_version, mode, answers, craft_score, sense_score, hospitality_score, brand_score, drive_score, mentor_score, type_id, type_name, market_value_score, salary_band) values ('$U','1.0.0','stylist','$A',1,1,1,1,1,1,'T','T',1,'x')" 2>&1 | grep -E 'ERROR|^[a-z_]+$' | head -1; }
for i in 1 2 3 4; do runi $i > /var/tmp/hi$i.out & done; wait
cat /var/tmp/hi?.out | sed 's/^ERROR:  //' | sort | uniq -c
psql -Atq -d "$DB" -c "select 'change_count=' || change_count from diagnosis_change_limits where user_id='$U'"
psql -Atq -d "$DB" -c "select count(*) from diagnosis_results where user_id='$U'"

# ---- サロン側: 確定（12問）の同時送信 ----
B12='{"q1_education_support":P,"q2_challenge_openness":P,"q3_personal_brand_support":P,"q4_team_collaboration":P,"q5_individual_autonomy":P,"q6_work_flexibility":P,"q7_technical_specialization":P,"q8_premium_value":P,"q9_trend_orientation":P,"q10_creative_output":P,"q11_relationship_distance":P,"q12_hierarchy_flatness":P}'
pl() { echo "{\"respondent_role\":\"owner_representative\",\"current_step\":13,\"answers\":$(echo "$B12" | sed "s/P/$1/g"),\"value_priorities\":[\"skill_growth\",\"teamwork\",\"independence\"],\"comment\":null}"; }
S1=00000000-0000-0000-0000-00000000c0a1; S2=00000000-0000-0000-0000-00000000c0a2
psql -q -d "$DB" <<SQL
insert into auth.users (id,email) values ('$S1','s1@t'),('$S2','s2@t');
update public.profiles set role='salon' where id in ('$S1','$S2');
insert into public.user_roles (user_id, role) values ('$S1','salon'),('$S2','salon') on conflict do nothing;
SQL
sal() { psql -Atq -d "$DB" -c "set role authenticated; select set_config('request.jwt.claims','{\"sub\":\"$1\"}',false); $2" 2>&1 | grep -E 'ERROR|^\{|^[a-z_]+$' | tail -1; }
for U2 in $S1 $S2; do   # 初回を確定しておく（以後は「導入後の変更1回」が残る状態）
  sal $U2 "select public.save_salon_culture_draft(null, '$(pl 3)'::jsonb); select public.confirm_salon_culture_diagnosis(null, gen_random_uuid(), 1)" >/dev/null
done
# (a) 同じrequest_id・同じ下書きを、2つのセッションが同時に確定 → 1回だけ反映、もう片方は再送扱い
echo "--- (a) 同一request_idの同時確定2件（期待: change/replay が1件ずつ、変更回数1）"
sal $S1 "select public.save_salon_culture_draft(null, '$(pl 1)'::jsonb, (select rev from salon_culture_drafts where salon_user_id='$S1'))" >/dev/null
REQ=$(psql -Atq -d "$DB" -c "select gen_random_uuid()")
for i in 1 2; do sal $S1 "select pg_sleep(0.3); select public.confirm_salon_culture_diagnosis(null, '$REQ', (select coalesce((select rev from salon_culture_drafts where salon_user_id='$S1'),2)))" | sed -E 's/.*"replay": (true|false).*/replay=\1/' > /var/tmp/hs$i.out & done; wait
cat /var/tmp/hs?.out | sed 's/^ERROR:  //' | sort | uniq -c
psql -Atq -d "$DB" -c "select 'change_count=' || change_count from diagnosis_change_limits where user_id='$S1' and kind='salon_culture_user'"
# (b) 別々のrequest_idで同じ下書きを4件同時に確定 → 1件だけ反映、残りは拒否。変更回数は1
echo "--- (b) 別request_idの同時確定4件（期待: 1件反映、3件拒否。変更回数1）"
sal $S2 "select public.save_salon_culture_draft(null, '$(pl 1)'::jsonb, (select rev from salon_culture_drafts where salon_user_id='$S2'))" >/dev/null
for i in 1 2 3 4; do sal $S2 "select pg_sleep(0.3); select public.confirm_salon_culture_diagnosis(null, gen_random_uuid(), (select coalesce((select rev from salon_culture_drafts where salon_user_id='$S2'),2)))" | sed -E 's/.*"action": "([a-z]+)".*/applied=\1/' > /var/tmp/hb$i.out & done; wait
cat /var/tmp/hb?.out | sed 's/^ERROR:  //' | sort | uniq -c
psql -Atq -d "$DB" -c "select 'change_count=' || change_count from diagnosis_change_limits where user_id='$S2' and kind='salon_culture_user'"
psql -Atq -d "$DB" -c "select 'published_q1=' || (answers->>'q1_education_support') from salon_culture_profiles where salon_user_id='$S2'"
dropdb "$DB"
