#!/bin/sh
# ローカル専用。0058 → 0059 → 巻き戻し の順に適用し、適用前の挙動に戻ることを確認する。
set -e
SRC="${1:-hd57}"; DB=hd58r; DIR="$(cd "$(dirname "$0")" && pwd)"
dropdb --if-exists "$DB"; createdb -T "$SRC" "$DB"
U=00000000-0000-0000-0000-00000000d001
q() { psql -Atq -v ON_ERROR_STOP=0 -d "$DB" "$@" 2>&1; }
psql -q -d "$DB" -c "insert into auth.users (id,email) values ('$U','r@t'); update public.profiles set role='stylist' where id='$U';"
ins() { q -c "set role service_role; insert into diagnosis_results (user_id, diagnosis_version, mode, answers, craft_score, sense_score, hospitality_score, brand_score, drive_score, mentor_score, type_id, type_name, market_value_score, salary_band) values ('$U','1.0.0','stylist','[$1]',1,1,1,1,1,1,'T','T',1,'x')" | grep -E "ERROR|INSERT" | head -1; }
snap() { q -c "select 'tbl:' || grantee::regrole::text || ':' || privilege_type from (select (aclexplode(relacl)).* from pg_class where oid='public.diagnosis_results'::regclass) a union all select 'fn:' || proname || ':' || grantee::regrole::text || ':' || privilege_type from (select p.proname, (aclexplode(p.proacl)).* from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('save_salon_culture_profile','save_salon_store_culture_profile','save_salon_culture_analysis_answers','save_salon_store_culture_analysis_answers')) f order by 1"; }
snap > /var/tmp/priv_before.txt
echo "--- 適用前: 変更は何度でも保存できる"; for i in 1 2 3; do ins $i; done; echo "件数(期待3): $(q -c "select count(*) from diagnosis_results where user_id='$U'")"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$DIR/0058_diagnosis_change_limits.draft.sql"
sed '/^begin;$/d;/^commit;$/d' "$DIR/0059_close_direct_paths.draft.sql" | psql -q -v ON_ERROR_STOP=1 -d "$DB"
snap > /var/tmp/priv_after59.txt
echo "--- 0059適用後: 権限が実際に外れている（適用前との差分。期待: 5行が消えている）"; diff /var/tmp/priv_before.txt /var/tmp/priv_after59.txt | grep -E "^[<>]" || echo "（差分なし＝0059が効いていない）"
echo "--- 0058+0059 適用後: service_role の直接INSERTは権限で止まる"; ins 4
echo "--- 0058+0059 適用後: 既存会員の状態が導入時に作られている（変更回数0）"
q -c "select kind || ' change_count=' || change_count from diagnosis_change_limits where user_id='$U'"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$DIR/0058_rollback.draft.sql"
echo "--- 巻き戻し後: 直接INSERTが再び通り、回数制限は無い"; for i in 5 6 7; do ins $i; done; echo "件数(期待6): $(q -c "select count(*) from diagnosis_results where user_id='$U'")"
echo "--- 巻き戻し後: 新関数・トリガーが残っていない（期待: 0 / 0）"
q -c "select count(*) from pg_proc where proname in ('commit_diagnosis_result','get_diagnosis_change_status','save_salon_culture_draft','confirm_salon_culture_diagnosis','_diagnosis_limit_gate')"
q -c "select count(*) from pg_trigger where tgname like 'trg_%_limit' and not tgisinternal"
echo "--- 巻き戻し後: 状態表は残っている（期待: 3）"
q -c "select count(*) from pg_tables where schemaname='public' and tablename in ('diagnosis_change_limits','diagnosis_save_requests','salon_culture_drafts')"
echo "--- 巻き戻し後: 旧サロンRPCを authenticated が再び呼べる（期待: t）"
q -c "select has_function_privilege('authenticated','public.save_salon_culture_profile(public.salon_culture_status, public.salon_culture_respondent_role, integer, jsonb, text[], text)','execute')"
snap > /var/tmp/priv_afterrb.txt
echo "--- 巻き戻し後: 0059で外した権限が、適用前とまったく同じに戻っている（期待: 差分なし）"
diff /var/tmp/priv_before.txt /var/tmp/priv_afterrb.txt && echo "差分なし"
echo "--- 巻き戻し後: 旧アプリの保存経路（旧サロンRPCを authenticated で実行。期待: 権限エラーなし）"
SU=00000000-0000-0000-0000-00000000d002
psql -q -d "$DB" -c "insert into auth.users (id,email) values ('$SU','sr@t'); update public.profiles set role='salon' where id='$SU'; insert into public.user_roles (user_id, role) values ('$SU','salon') on conflict do nothing;"
as_user() { q -c "set role authenticated; select set_config('request.jwt.claims','{\"sub\":\"$1\"}',false); $2" | grep -E "ERROR|^[0-9a-f-]{36}|^\{|^[a-z_ ]+$" | tail -1; }
echo "旧: 本人用の保存(save_salon_culture_profile): $(as_user $SU "select (public.save_salon_culture_profile('completed','owner_representative',3,'{\"q1_education_support\":3,\"q2_challenge_openness\":3,\"q3_personal_brand_support\":3,\"q4_team_collaboration\":3,\"q5_individual_autonomy\":3,\"q6_work_flexibility\":3,\"q7_technical_specialization\":3,\"q8_premium_value\":3,\"q9_trend_orientation\":3,\"q10_creative_output\":3,\"q11_relationship_distance\":3,\"q12_hierarchy_flatness\":3}'::jsonb,array['skill_growth','teamwork','independence'],null)).id is not null")"
echo "旧: 店舗用の保存(save_salon_store_culture_profile) 権限のない利用者: $(as_user $SU "select (public.save_salon_store_culture_profile('00000000-0000-0000-0000-0000000000f1','draft','owner_representative',3,'{\"q1_education_support\":3,\"q2_challenge_openness\":3,\"q3_personal_brand_support\":3,\"q4_team_collaboration\":3,\"q5_individual_autonomy\":3,\"q6_work_flexibility\":3,\"q7_technical_specialization\":3,\"q8_premium_value\":3,\"q9_trend_orientation\":3,\"q10_creative_output\":3,\"q11_relationship_distance\":3,\"q12_hierarchy_flatness\":3}'::jsonb,array['skill_growth','teamwork','independence'],null)).id")"
echo "旧: 店舗用の保存 店舗担当者(権限あり): $(as_user 00000000-0000-0000-0000-000000000106 "select (public.save_salon_store_culture_profile('00000000-0000-0000-0000-0000000000f1','draft','owner_representative',3,'{\"q1_education_support\":3,\"q2_challenge_openness\":3,\"q3_personal_brand_support\":3,\"q4_team_collaboration\":3,\"q5_individual_autonomy\":3,\"q6_work_flexibility\":3,\"q7_technical_specialization\":3,\"q8_premium_value\":3,\"q9_trend_orientation\":3,\"q10_creative_output\":3,\"q11_relationship_distance\":3,\"q12_hierarchy_flatness\":3}'::jsonb,array['skill_growth','teamwork','independence'],null)).id is not null")"
echo "旧: 追加5問の保存(save_salon_culture_analysis_answers): $(as_user $SU "select (public.save_salon_culture_analysis_answers('salon-analysis-v1','{\"q13_nurture_learning_flow\":3,\"q14_nurture_feedback\":3,\"q15_brand_staff_presentation\":3,\"q16_team_handover\":3,\"q17_discretion_proposal\":3}'::jsonb,'{\"q1_education_support\":3,\"q2_challenge_openness\":3,\"q3_personal_brand_support\":3,\"q4_team_collaboration\":3,\"q5_individual_autonomy\":3,\"q6_work_flexibility\":3,\"q7_technical_specialization\":3,\"q8_premium_value\":3,\"q9_trend_orientation\":3,\"q10_creative_output\":3,\"q11_relationship_distance\":3,\"q12_hierarchy_flatness\":3}'::jsonb)).id is not null")"
echo "（上の旧経路は、権限エラー(permission denied)にならず、アプリ側の内容検査の結果が返れば『保存経路は復旧』。入力不備による拒否はあり得る）"
dropdb "$DB"
