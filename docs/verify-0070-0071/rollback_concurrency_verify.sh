#!/bin/bash
# 0070・0071 の巻き戻しと、同時の保存との実行順の検証（ローカル専用・使い捨てDBのみ）。
# 各ケースで「ロック待ちが実際に発生したこと」を pg_stat_activity で確認し、データが消えないこと・途中状態が残らないことまで確認する。
# 1件でも失敗・SQLエラー・バックグラウンド処理の失敗があれば非ゼロで終了する。
# 環境変数 VFY_MUTATE=nolock_rollback: 巻き戻しSQLからロック文を除いた版で実行する（検証が失敗を検出できることの確認用）
D=$(cd "$(dirname "$0")" && pwd)
. "$D/verify_common.sh"
vfy_preflight 0058_diagnosis_change_limits.draft.sql 0070_stylist_profile_public.draft.sql 0070_fixture.sql 0070_rollback.draft.sql 0071_student_newgrad.draft.sql 0071_rollback.draft.sql stub_supabase.sql
vfy_ensure_template
PFX=vfy_rc_$$_; trap 'for x in a b c d e f g h i; do vdb_drop ${PFX}$x; done; rm -rf "$VFY_TMPD"' EXIT
R70=$(ffind 0070_rollback.draft.sql); R71=$(ffind 0071_rollback.draft.sql)
if [ "${VFY_MUTATE:-}" = "nolock_rollback" ]; then
  sed '/^lock table/d' "$R70" > "$VFY_TMPD/r70.sql"; sed '/^lock table/d' "$R71" > "$VFY_TMPD/r71.sql"; R70="$VFY_TMPD/r70.sql"; R71="$VFY_TMPD/r71.sql"
  echo "(変異: 巻き戻しSQLからロック文を除去して実行)"; fi
# 保持用の版: ロック取得の直後（目印コメント）に pg_sleep を入れる。検証専用で、本番のSQLには入れない。
hold() { sed "s/^-- ROLLBACK_LOCK_ACQUIRED.*/select pg_sleep($3);/" "$1" > "$2"; grep -q "pg_sleep($3)" "$2" || vfy_die "目印(ROLLBACK_LOCK_ACQUIRED)が見つかりません: $1"; }
U=00000000-0000-0000-0000-0000000bb001
ANS="jsonb_build_object('q1','a','q2','a','q3','a','q4','a','q5','a','q6','a','q7','a','q9','a','q10','a','q11','a','q12','a','q13','a','q14','a')"
newuser() { psql -X -q -v ON_ERROR_STOP=1 -d "$1" -c "insert into auth.users(id,email) values ('$U','rc@t') on conflict do nothing; insert into public.profiles(id,role) values ('$U','stylist') on conflict do nothing;" >/dev/null || vfy_die "利用者の準備に失敗"; }
qn() { psql -X -Atq -d "$1" -c "$2" 2>&1; }
SAVE_STUDENT="begin; set role service_role; select public.commit_student_diagnosis('$U', gen_random_uuid(), 'v', $ANS, '{}'::jsonb)->>'action'; reset role; select pg_sleep(5); commit;"
SAVE_EXP="begin; set role service_role; select public.commit_diagnosis_result('$U', gen_random_uuid(), true, '1.0.0', 'stylist', '[3,3]'::jsonb, 50::smallint,50::smallint,50::smallint,50::smallint,50::smallint,50::smallint,'T1','x',50::smallint,'300-350')->>'action'; reset role; select pg_sleep(5); commit;"

echo "== 0071-A: 学生診断の保存が先 → 巻き戻しは待ち、保存確定後に中止（データ保持）"
DB=${PFX}a; vfy_build_chain $DB 0071; newuser $DB
vfy_bg s psql -X -q -d $DB -c "$SAVE_STUDENT"; vfy_expect_held $DB "pg_sleep(5)" "0071-A 保存側"
vfy_bg r psql -X -q -v ON_ERROR_STOP=1 -d $DB -f "$R71"
vfy_expect_blocked $DB "lock table public.stylist_diagnosis_current" "0071-A 巻き戻しが保存を待つ"
vfy_join s r
vfy_chk "0071-A 保存は成功" "$(vfy_rc s)" "0"
vfy_chk "0071-A 巻き戻しは中止（非ゼロ）" "$([ "$(vfy_rc r)" != 0 ] && echo yes || echo no)" "yes"
vfy_has "0071-A 中止の理由が表示される" "$(vfy_out r)" "rollback refused"
vfy_chk "0071-A 学生診断のデータは残っている" "$(qn $DB "select count(*) from public.student_diagnosis_results")" "1"
vfy_chk "0071-A 途中状態なし: 表・列・制約・トリガー・関数がすべて残る" "$(qn $DB "select (to_regclass('public.stylist_diagnosis_current') is not null)::int + (select count(*) from information_schema.columns where table_name='stylist_profiles' and column_name='career_phase')::int + (select count(*) from pg_constraint where conname='stylist_profiles_career_phase_consistent')::int + (select count(*) from pg_trigger where tgname in ('trg_set_current_diagnosis','trg_student_diagnosis_limit'))::int + (select count(*) from pg_proc where proname in ('commit_student_diagnosis','set_stylist_career_phase'))::int")" "8"

echo "== 0071-B: 巻き戻しが先 → 保存は待たされ、コミット後にエラーで終わる（途中状態なし）"
DB=${PFX}b; vfy_build_chain $DB 0071; newuser $DB
hold "$R71" "$VFY_TMPD/r71_hold.sql" 5
vfy_bg r psql -X -q -v ON_ERROR_STOP=1 -d $DB -f "$VFY_TMPD/r71_hold.sql"; vfy_expect_held $DB "pg_sleep(5)" "0071-B 巻き戻し側"
vfy_bg s psql -X -q -v ON_ERROR_STOP=1 -d $DB -c "set role service_role; select public.commit_student_diagnosis('$U', gen_random_uuid(), 'v', $ANS, '{}'::jsonb)->>'action'"
vfy_expect_blocked $DB "commit_student_diagnosis" "0071-B 保存が巻き戻しを待つ"
vfy_join r s
vfy_chk "0071-B 巻き戻しは成功" "$(vfy_rc r)" "0"
vfy_chk "0071-B 割り込んだ保存はエラーで終了（非ゼロ）" "$([ "$(vfy_rc s)" != 0 ] && echo yes || echo no)" "yes"
vfy_chk "0071-B 巻き戻し後: 学生診断の表・現在の診断・区分の列が無い" "$(qn $DB "select coalesce(to_regclass('public.student_diagnosis_results')::text,'-')||coalesce(to_regclass('public.stylist_diagnosis_current')::text,'-')||(select count(*) from information_schema.columns where table_name='stylist_profiles' and column_name='career_phase')")" "--0"
vfy_chk "0071-B 保存の途中状態が残っていない（回数・送信ID・結果が0件）" "$(qn $DB "select (select count(*) from public.diagnosis_change_limits where user_id='$U')||'/'||(select count(*) from public.diagnosis_save_requests where user_id='$U')||'/'||(select count(*) from public.diagnosis_results where user_id='$U')")" "0/0/0"
vfy_chk "0071-B 0058の関数に戻っている" "$(qn $DB "select md5(prosrc) from pg_proc where proname='commit_diagnosis_result'")" "04fe4af9ea696398239f95f6f984b6f6"

echo "== 0071-C: 経験者診断の保存が先 → 巻き戻しは待ち、保存確定後に成功（経験者データは残る）"
DB=${PFX}c; vfy_build_chain $DB 0071; newuser $DB
vfy_bg s psql -X -q -d $DB -c "$SAVE_EXP"; vfy_expect_held $DB "pg_sleep(5)" "0071-C 保存側"
vfy_bg r psql -X -q -v ON_ERROR_STOP=1 -d $DB -f "$R71"
vfy_expect_blocked $DB "lock table public.stylist_diagnosis_current" "0071-C 巻き戻しが保存を待つ"
vfy_join s r
vfy_chk "0071-C 保存・巻き戻しとも成功" "$(vfy_rc s)$(vfy_rc r)" "00"
vfy_chk "0071-C 経験者診断の結果は消えていない" "$(qn $DB "select count(*) from public.diagnosis_results where user_id='$U'")" "1"
vfy_chk "0071-C 回数制限の状態も残る（初回保存済み）" "$(qn $DB "select count(*) from public.diagnosis_change_limits where user_id='$U' and kind='stylist'")" "1"

echo "== 0070-A: 生年月日の保存が先 → 巻き戻しは待ち、保存確定後に中止（生年月日は消えない）"
DB=${PFX}d; vfy_build_0070_fixture $DB
S1=00000000-0000-0000-0000-000000000001; S4=00000000-0000-0000-0000-000000000004
vfy_bg s psql -X -q -d $DB -c "begin; set local role authenticated; select set_config('request.jwt.claim.sub','$S1',true); select set_stylist_birth_date('1995-06-15'); reset role; select pg_sleep(5); commit;"
vfy_expect_held $DB "pg_sleep(5)" "0070-A 保存側"
vfy_bg r psql -X -q -v ON_ERROR_STOP=1 -d $DB -f "$R70"
vfy_expect_blocked $DB "lock table public.stylist_private" "0070-A 巻き戻しが保存を待つ"
vfy_join s r
vfy_chk "0070-A 保存は成功" "$(vfy_rc s)" "0"
vfy_chk "0070-A 巻き戻しは中止（非ゼロ）" "$([ "$(vfy_rc r)" != 0 ] && echo yes || echo no)" "yes"
vfy_has "0070-A 中止の理由が表示される" "$(vfy_out r)" "巻き戻しを中止: 生年月日が 1 件"
vfy_chk "0070-A 生年月日は残っている" "$(qn $DB "select birth_date from public.stylist_private where user_id='$S1'")" "1995-06-15"
vfy_chk "0070-A 途中状態なし: 退避表・フラグ・関数が残り、スカウト設定も移行後のまま" "$(qn $DB "select (to_regclass('public.scout_optout_migration_0070') is not null)::int||'/'||(select count(*) from public.feature_pauses where feature in ('stylist_public_extended','minor_salon_public'))||'/'||(select count(*) from pg_proc where proname in ('set_stylist_birth_date','stylist_salon_publishable'))||'/'||(select scout_enabled::int from public.user_settings where user_id='$S4')")" "1/2/2/1"

echo "== 0070-B: 巻き戻しが先 → 生年月日の保存は待たされ、コミット後にエラーで終わる（途中状態なし）"
DB=${PFX}e; vfy_build_0070_fixture $DB
hold "$R70" "$VFY_TMPD/r70_hold.sql" 5
BEFORE=$(qn $DB "select count(*) from public.stylist_private")
vfy_bg r psql -X -q -v ON_ERROR_STOP=1 -d $DB -f "$VFY_TMPD/r70_hold.sql"; vfy_expect_held $DB "pg_sleep(5)" "0070-B 巻き戻し側"
vfy_bg s psql -X -q -v ON_ERROR_STOP=1 -d $DB -c "set role authenticated; select set_config('request.jwt.claim.sub','$S1',false); select set_stylist_birth_date('1995-06-15')"
vfy_expect_blocked $DB "set_stylist_birth_date" "0070-B 保存が巻き戻しを待つ"
vfy_join r s
vfy_chk "0070-B 巻き戻しは成功" "$(vfy_rc r)" "0"
vfy_chk "0070-B 割り込んだ保存はエラーで終了（非ゼロ）" "$([ "$(vfy_rc s)" != 0 ] && echo yes || echo no)" "yes"
vfy_chk "0070-B 巻き戻し後: 生年月日の列・退避表が無い。個人情報の行は減っていない" "$(qn $DB "select (select count(*) from information_schema.columns where table_name='stylist_private' and column_name='birth_date')||'/'||coalesce(to_regclass('public.scout_optout_migration_0070')::text,'-')||'/'||(select count(*) from public.stylist_private)")" "0/-/$BEFORE"

echo "== 0070-C: スカウト設定の変更が先 → 巻き戻しは待ち、確定後に中止（本人の設定は上書きされない）"
DB=${PFX}f; vfy_build_0070_fixture $DB
vfy_bg s psql -X -q -d $DB -c "begin; update public.user_settings set scout_enabled=false where user_id='$S4'; select pg_sleep(5); commit;"
vfy_expect_held $DB "pg_sleep(5)" "0070-C 保存側"
vfy_bg r psql -X -q -v ON_ERROR_STOP=1 -d $DB -f "$R70"
vfy_expect_blocked $DB "lock table public.user_settings" "0070-C 巻き戻しが保存を待つ"
vfy_join s r
vfy_chk "0070-C 巻き戻しは中止（非ゼロ）" "$([ "$(vfy_rc r)" != 0 ] && echo yes || echo no)" "yes"
vfy_has "0070-C 中止の理由が表示される" "$(vfy_out r)" "巻き戻しを中止: 移行したスカウト設定のうち 1 件"
vfy_chk "0070-C 本人の変更(false)が残っている" "$(qn $DB "select scout_enabled::text from public.user_settings where user_id='$S4'")" "false"

A1=00000000-0000-0000-0000-000000000010; B0=00000000-0000-0000-0000-0000000000b0
prep_age() { psql -X -q -v ON_ERROR_STOP=1 -d "$1" -c "insert into public.stylist_private(user_id,birth_date,age_display_mode) values ('$S1','1990-04-01','decade') on conflict (user_id) do update set birth_date='1990-04-01', age_display_mode='decade'" >/dev/null || vfy_die "準備失敗: $1"; }
REQ="select set_config('request.jwt.claim.sub','$A1',true); select public.request_stylist_age_disclosure('$B0','$S1')->>'status'"

echo "== 0070-E: 開示依頼の送信が先 → 巻き戻しは待ち、確定後に中止（依頼・通知は消えない）"
DB=${PFX}h; vfy_build_0070_fixture $DB; prep_age $DB
vfy_bg s psql -X -q -d $DB -c "begin; set local role authenticated; $REQ; reset role; select pg_sleep(5); commit;"
vfy_expect_held $DB "pg_sleep(5)" "0070-E 依頼側"
vfy_bg r psql -X -q -v ON_ERROR_STOP=1 -d $DB -f "$R70"
vfy_expect_blocked $DB "lock table public.stylist_private" "0070-E 巻き戻しが依頼の確定を待つ"
vfy_join s r
vfy_chk "0070-E 依頼は成功" "$(vfy_rc s)" "0"
vfy_chk "0070-E 巻き戻しは中止（非ゼロ）" "$([ "$(vfy_rc r)" != 0 ] && echo yes || echo no)" "yes"
vfy_has "0070-E 中止の理由が表示される" "$(vfy_out r)" "巻き戻しを中止"
vfy_chk "0070-E 依頼と通知が残っている" "$(qn $DB "select (select count(*) from public.age_disclosure_requests)||'/'||(select count(*) from public.notifications where type='age_disclosure_requested')")" "1/1"
vfy_chk "0070-E 途中状態なし: 関数・表・トリガー・制約が残る" "$(qn $DB "select (select count(*) from pg_proc where proname in ('request_stylist_age_disclosure','respond_age_disclosure_request'))||'/'||(select count(*) from pg_trigger where tgname in ('trg_scouts_publishable_guard','trg_stylist_profiles_birth_required','trg_stylist_private_birth_guard'))")" "2/3"

echo "== 0070-F: 巻き戻しが先 → 開示依頼は待たされ、コミット後にエラーで終わる（依頼は作られない）"
DB=${PFX}i; vfy_build_0070_fixture $DB; prep_age $DB
hold "$R70" "$VFY_TMPD/r70_holdF.sql" 5
vfy_bg r psql -X -q -d $DB -v ON_ERROR_STOP=1 -f "$VFY_TMPD/r70_holdF.sql"; vfy_expect_held $DB "pg_sleep(5)" "0070-F 巻き戻し側"
vfy_bg s psql -X -q -v ON_ERROR_STOP=1 -d $DB -c "set role authenticated; $REQ"
vfy_expect_blocked $DB "request_stylist_age_disclosure" "0070-F 依頼が巻き戻しを待つ"
vfy_join r s
vfy_chk "0070-F 巻き戻しは、生年月日・表示方法が既にあるため中止" "$([ "$(vfy_rc r)" != 0 ] && echo yes || echo no)" "yes"
vfy_chk "0070-F 中止なので依頼はそのまま実行できる（待たされたあと成功）" "$(vfy_rc s)" "0"
vfy_chk "0070-F 依頼は1件（巻き戻しの中止後に成立）" "$(qn $DB "select count(*) from public.age_disclosure_requests")" "1"

echo "== 0070-D: 0071適用済みなら0070単独の巻き戻しは拒否（ロック取得後でも何も変更しない）"
DB=${PFX}g; vfy_build_chain $DB 0071
out=$(psql -X -q -v ON_ERROR_STOP=1 -d $DB -f "$R70" 2>&1); rc=$?
vfy_chk "0070-D 拒否（非ゼロ）" "$([ $rc != 0 ] && echo yes || echo no)" "yes"
vfy_has "0070-D 拒否の理由が表示される" "$out" "0071が適用されています"
vfy_chk "0070-D 何も変更されていない（生年月日の列・公開判定が残る）" "$(qn $DB "select (select count(*) from information_schema.columns where table_name='stylist_private' and column_name='birth_date')||'/'||(select count(*) from pg_proc where proname='stylist_salon_publishable')")" "1/1"
vfy_exit
