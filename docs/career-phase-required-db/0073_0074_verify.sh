#!/bin/bash
# 0073/0074（立場を必須の3択にする）の検証。ローカル・使い捨てDBのみ。本番には接続しない。
# 使い方: su postgres -c "bash docs/career-phase-required-db/0073_0074_verify.sh"
D=$(cd "$(dirname "$0")" && pwd); V="$D/../verify-0070-0071"
. "$V/verify_common.sh"
# PROD_ORDER=1: 本番と同じ適用順 0058→0070→0059→0071→0072→0073→0074（既定は 0058→0070→0071→0073→0074）
PROD_ORDER=${PROD_ORDER:-0}
F72="$D/../profile-value-priorities-db/0072_value_priorities_save.draft.sql"
vfy_preflight 0058_diagnosis_change_limits.draft.sql 0070_stylist_profile_public.draft.sql 0070_fixture.sql 0071_student_newgrad.draft.sql stub_supabase.sql
if [ "$PROD_ORDER" = 1 ]; then need_files 0059_close_direct_paths.draft.sql 0059_postapply_check.sql; [ -f "$F72" ] || vfy_die "0072 が見つかりません"; fi
echo "== 適用順: $( [ "$PROD_ORDER" = 1 ] && echo '0058→0070→0059→0071→0072→0073→0074（本番と同じ）' || echo '0058→0070→0071→0073→0074' )"
vfy_ensure_template
PFX=vfy_cp73_$$_; trap 'for x in a b c d e; do vdb_drop ${PFX}$x; done; rm -rf "$VFY_TMPD"' EXIT
S1=00000000-0000-0000-0000-000000000001; S2=00000000-0000-0000-0000-000000000002; S3=00000000-0000-0000-0000-000000000003; S4=00000000-0000-0000-0000-000000000004; S9=00000000-0000-0000-0000-000000000099
F73="$D/0073_career_phase_required.draft.sql"; F74="$D/0074_close_old_save_paths.draft.sql"
qn() { psql -X -Atq -d "$1" -c "$2" 2>&1; }
asu() { local db=$1 sub=$2; shift 2; psql -X -Atq -d "$db" -c "set role authenticated; select set_config('request.jwt.claim.sub','$sub',false); $*" 2>&1; }
verdict() { psql -X -Atq -F'|' -d "$1" -f "$2" 2>&1 | grep -E '^99\|' | cut -d'|' -f2; }
fails() { psql -X -Atq -F'|' -d "$1" -f "$2" 2>&1 | grep -c '^[0-9]*|FAIL|'; }
# 本番と同じ順（0058→0070→0071）で重ねる。0070 の fixture は 0070 の前
build() { local db=$1; vdb_create "$db" "$VFY_TPL"
  vpsql -d "$db" -f "$(ffind 0070_fixture.sql)" >/dev/null || vfy_die "fixture"
  local files="0058_diagnosis_change_limits.draft.sql 0070_stylist_profile_public.draft.sql"
  [ "$PROD_ORDER" = 1 ] && files="$files 0059_close_direct_paths.draft.sql"
  files="$files 0071_student_newgrad.draft.sql"
  for f in $files; do
    vpsql -d "$db" -f "$(ffind $f)" >/dev/null 2>"$VFY_ERR" || { grep -v NOTICE "$VFY_ERR"|head -3 >&2; vfy_die "適用失敗 $f"; }; done
  [ "$PROD_ORDER" = 1 ] && { vpsql -d "$db" -f "$F72" >/dev/null 2>"$VFY_ERR" || { grep -v NOTICE "$VFY_ERR"|head -3 >&2; vfy_die "適用失敗 0072"; }; }
  return 0; }
# v3 呼び出し: v3 SUB 公開名 立場 卒業 区分 開始 免許
Y0=$(date +%Y-%m-01); GRAD=$(date -d "$Y0 +6 month" +%Y-%m-01); START=$(date -d "$Y0 +8 month" +%Y-%m-01)
v3() { local db=$1 sub=$2 name=$3 ph=$4 g=${5:-null} gk=${6:-null} st=${7:-null} lic=${8:-null}
  q() { [ "$1" = null ] && echo null || echo "'$1'"; }
  asu $db $sub "select (public.save_stylist_profile_v3('$name','山田 花子','30_34','female','東京都','渋谷',0,'スタイリスト','{カット}','full_time','active',null,'[]','自己紹介-$name','PRIVATE',false,null,'{work_life,growth,income}','1990-04-01','decade',$(q $ph),$(q $g)::date,$(q $gk),$(q $st)::date,$(q $lic))).id"; }
snap() { qn $1 "select (to_jsonb(sp))::text || (to_jsonb(s))::text || (select to_jsonb(p)::text from public.profiles p where id='$2') from public.stylist_profiles sp, public.stylist_private s where sp.user_id='$2' and s.user_id='$2'"; }
ph() { qn $1 "select coalesce(career_phase,'NULL')||'|'||coalesce(graduation_ym::text,'-')||'|'||coalesce(graduation_kind,'-')||'|'||coalesce(desired_start_ym::text,'-')||'|'||coalesce(license_status,'-') from public.stylist_profiles where user_id='$2'"; }

DB=${PFX}a; build $DB
# 旧データを用意: S1=未設定(NULL)・S2=美容学生(student)・S3=現役・S4=新卒（0071の関数で。旧アプリの実データ相当）
for u in $S1 $S2 $S3 $S4; do asu $DB $u "select public.save_stylist_profile_v2('旧-$u','山田','30_34','female','東京都','渋谷',0,'スタイリスト','{カット}','full_time','active',null,'[]','旧自己紹介','PRIVATE',false,null,'{work_life,growth,income}','1990-04-01','decade')" >/dev/null; done
asu $DB $S2 "select public.set_stylist_career_phase('student','$GRAD','planned',null,'studying')" >/dev/null
asu $DB $S3 "select public.set_stylist_career_phase('experienced')" >/dev/null
asu $DB $S4 "select public.set_stylist_career_phase('new_graduate','$Y0','completed','$START','obtained')" >/dev/null
# 診断履歴（学生診断の結果）を S2 に1件
ANS='{"q1":["a"],"q2":["a"],"q3":["a"],"q4":["a"],"q5":["a"],"q6":["a"],"q7":["a"],"q9":["a"],"q10":["a"],"q11":["a"],"q12":["a"],"q13":["a"],"q14":["a"]}'
REQ=$(qn $DB "select gen_random_uuid()" | tail -1)
qn $DB "set role service_role; select (public.commit_student_diagnosis('$S2'::uuid,'$REQ'::uuid,'student_newgrad_v1','$ANS'::jsonb,'{\"x\":1}'::jsonb))->>'action'" >/dev/null
DIAG_BEFORE=$(qn $DB "select (select count(*) from public.student_diagnosis_results)||'|'||(select count(*) from public.stylist_diagnosis_current)||'|'||(select count(*) from public.diagnosis_results)")
LEG_BEFORE=$(qn $DB "select string_agg(user_id::text||'='||coalesce(career_phase,'NULL')||'/'||coalesce(graduation_ym::text,'-'), ',' order by user_id) from public.stylist_profiles where user_id in ('$S1','$S2','$S3','$S4')")
echo "== 0073 適用前"
vfy_chk "適用前チェック(0073): 総合PASS" "$(verdict $DB "$D/0073_preapply_check.sql")" "PASS"
psql -X -q -v ON_ERROR_STOP=1 -d $DB -f "$F73" >/dev/null 2>&1 || { echo "FAIL: 0073の適用"; exit 1; }
echo "== 0073 適用後"
vfy_chk "適用後チェック(0073): 総合PASS" "$(verdict $DB "$D/0073_postapply_check.sql")" "PASS"
vfy_chk "適用後チェック(0073): FAIL行なし" "$(fails $DB "$D/0073_postapply_check.sql")" "0"
vfy_chk "二重適用は拒否される" "$(psql -X -Atq -d $DB -f "$F73" 2>&1 | grep -c 'already applied')" "1"
vfy_chk "既存データ: 未設定・美容学生・現役・新卒の行は一切変更されない（勝手に新卒等へ変換しない）" "$(qn $DB "select string_agg(user_id::text||'='||coalesce(career_phase,'NULL')||'/'||coalesce(graduation_ym::text,'-'), ',' order by user_id) from public.stylist_profiles where user_id in ('$S1','$S2','$S3','$S4')")" "$LEG_BEFORE"
vfy_chk "診断履歴は消えない・変わらない" "$(qn $DB "select (select count(*) from public.student_diagnosis_results)||'|'||(select count(*) from public.stylist_diagnosis_current)||'|'||(select count(*) from public.diagnosis_results)")" "$DIAG_BEFORE"
vfy_chk "権限: v3は authenticated のみ（anon・service_role・PUBLIC不可）" "$(qn $DB "select has_function_privilege('authenticated',p,'execute')::text||has_function_privilege('anon',p,'execute')::text||has_function_privilege('service_role',p,'execute')::text from (select 'public.save_stylist_profile_v3(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[],date,text,text,date,text,date,text)'::regprocedure p) x")" "truefalsefalse"
# --- v3 正常系
vfy_chk "v3: 未設定だった本人（S1）が『現役の美容師』を選んで保存できる" "$(v3 $DB $S1 新名S1 experienced | tail -1 | grep -c '^[0-9a-f-]\{36\}$')|$(ph $DB $S1)" "1|experienced|-|-|-|-"
vfy_chk "v3: プロフィール本体も同時に保存される" "$(qn $DB "select public_name from public.stylist_profiles where user_id='$S1'")" "新名S1"
vfy_chk "v3: 美容学生だった本人（S2）が『新卒』を選び直せる（卒業・開始・免許も保存）" "$(v3 $DB $S2 新名S2 new_graduate $Y0 completed $START obtained >/dev/null; ph $DB $S2)" "new_graduate|$Y0|completed|$START|obtained"
vfy_chk "v3: 『ブランクあり』を保存でき、卒業・開始・免許は空" "$(v3 $DB $S3 新名S3 blank >/dev/null; ph $DB $S3)" "blank|-|-|-|-"
vfy_chk "v3: 『新卒』は卒業予定(planned)・開始なし・免許なしでも保存できる" "$(v3 $DB $S4 新名S4 new_graduate $GRAD planned >/dev/null; ph $DB $S4)" "new_graduate|$GRAD|planned|-|-"
vfy_chk "v3: 新卒→現役へ変えると卒業情報が消える" "$(v3 $DB $S4 新名S4 experienced >/dev/null; ph $DB $S4)" "experienced|-|-|-|-"
# --- v3 拒否（何も保存しない）
reject() { # 説明 SUB 期待エラー 引数… ; 保存済みの全項目が不変であること
  local label=$1 sub=$2 exp=$3; shift 3; local b=$(snap $DB $sub); local out=$(v3 $DB $sub 拒否される名 "$@")
  vfy_has "拒否: $label" "$out" "$exp"; vfy_chk "拒否後: $label — プロフィールも立場も何も保存されない" "$(snap $DB $sub)" "$b"; }
reject "立場が未選択(NULL)" $S1 career_phase_required null
reject "旧値 student（美容学生）" $S1 career_phase_required student $GRAD planned
reject "空文字" $S1 career_phase_required ""
reject "存在しない値" $S1 career_phase_required other
reject "新卒で卒業年月なし" $S1 "graduation month required" new_graduate null planned
reject "新卒で区分なし" $S1 "graduation kind required" new_graduate $GRAD null
reject "新卒で区分が不正" $S1 "graduation kind required" new_graduate $GRAD bogus
reject "新卒で卒業済みなのに未来" $S1 "cannot be in the future" new_graduate $GRAD completed
reject "新卒で開始が卒業より前" $S1 "start month out of range" new_graduate $GRAD planned $Y0
reject "新卒で免許が不正" $S1 "invalid license" new_graduate $GRAD planned null bogus
reject "現役に卒業年月を付ける" $S1 "must be empty" experienced $GRAD
reject "ブランクありに免許を付ける" $S1 "must be empty" blank null null null studying
vfy_has "未認証は拒否" "$(psql -X -Atq -d $DB -c "set role authenticated; select set_config('request.jwt.claim.sub','',false); select public.save_stylist_profile_v3('x','y','30_34','female','東京都','渋谷',0,'a','{}','full_time','active',null,'[]','b','PRIVATE',false,null,'{a,b,c}','1990-04-01','decade','experienced',null,null,null,null)" 2>&1)" "not authenticated"
# 生年月日が無い場合（v2の既存規則）でも、立場だけが保存されることはない
B=$(snap $DB $S1)
vfy_has "v3: 生年月日なしは拒否（既存規則）" "$(asu $DB $S1 "select public.save_stylist_profile_v3('x','山田','30_34','female','東京都','渋谷',0,'a','{}','full_time','active',null,'[]','b','PRIVATE',false,null,'{work_life,growth,income}',null,'decade','blank',null,null,null,null)")" "birth"
vfy_chk "v3: 生年月日なしで拒否後、プロフィール・立場とも不変（別々に保存されない）" "$(snap $DB $S1)" "$B"
# 途中失敗の原子性: v2 が失敗（value_priorities が不正）しても立場だけが変わらない
B=$(snap $DB $S1)
vfy_has "v3: プロフィール側の検証エラー（不正なvalue_priorities）" "$(asu $DB $S1 "select public.save_stylist_profile_v3('x','山田','30_34','female','東京都','渋谷',0,'a','{}','full_time','active',null,'[]','b','PRIVATE',false,null,'{x}','1990-04-01','decade','blank',null,null,null,null)")" "ERROR"
vfy_chk "v3: その場合、立場も変わらない（1つの取引で全部取り消し）" "$(snap $DB $S1)" "$B"
# --- トリガー: 立場を別の経路で NULL/student/不正値に変えられない（所有者権限でも）
vfy_has "トリガー: 立場をNULLへ更新できない" "$(qn $DB "update public.stylist_profiles set career_phase=null, graduation_ym=null, graduation_kind=null where user_id='$S1'")" "career_phase_required"
vfy_has "トリガー: 立場を student へ更新できない" "$(qn $DB "update public.stylist_profiles set career_phase='student', graduation_ym='$GRAD', graduation_kind='planned' where user_id='$S1'")" "career_phase_required"
vfy_has "制約: 不正値は制約で拒否" "$(qn $DB "update public.stylist_profiles set career_phase='other' where user_id='$S1'")" "career_phase_check\|career_phase_required"
vfy_has "制約: blank に卒業年月は付けられない" "$(qn $DB "update public.stylist_profiles set career_phase='blank', graduation_ym='$GRAD', graduation_kind='planned' where user_id='$S1'")" "career_phase_consistent"
vfy_has "authenticated は表を直接UPDATEできない" "$(asu $DB $S1 "update public.stylist_profiles set career_phase='blank' where user_id='$S1'")" "permission denied"
# 旧データの行は「立場を変えない更新」が妨げられない（未設定のままの行 S9' を作って確認）
qn $DB "insert into auth.users (id,email) values ('$S9','x@t'); insert into public.stylist_private (user_id,birth_date,age_display_mode) values ('$S9','1990-04-01','decade'); insert into public.stylist_profiles (user_id) values ('$S9')" >/dev/null
vfy_chk "旧データ(0073適用中): 未設定のままの行で、立場以外の更新は通る（既存の他機能を止めない）" "$(qn $DB "update public.stylist_profiles set bio='x' where user_id='$S9'" | grep -c ERROR)" "0"
vfy_chk "旧データ: その行は未設定のまま" "$(ph $DB $S9)" "NULL|-|-|-|-"
# --- 診断・回数制限・マッチングへの影響なし: ブランクありでも診断の保存関数は動き、制限関数の定義は不変
vfy_chk "診断: ブランクあり(S3)でも既存診断関数は定義が不変（0073は触らない）" "$(qn $DB "select count(*) from pg_proc where proname in ('commit_student_diagnosis','commit_diagnosis') and prosrc like '%career_phase%'")" "0"
vfy_chk "診断・回数制限: 診断関連の関数は career_phase を参照しない（ブランクを足しても採点・制限は変わらない）" "$(qn $DB "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosrc ilike '%career_phase%' and p.proname not in ('set_stylist_career_phase','save_stylist_profile_v3','_trg_career_phase_valid','_trg_career_phase_required_on_insert')")" "0"
echo "INFO  アプリ側のTypeScript（診断の採点・回数制限・マッチング計算）は career_phase を使わない。差分は、診断関連ファイルが変更されていないことで確認する（レビュー用パッケージ参照）"

echo "== 0074 適用前"
vfy_chk "適用前チェック(0074): 総合PASS" "$(verdict $DB "$D/0074_preapply_check.sql")" "PASS"
psql -X -q -v ON_ERROR_STOP=1 -d $DB -f "$F74" >/dev/null 2>&1 || { echo "FAIL: 0074の適用"; exit 1; }
echo "== 0074 適用後"
vfy_chk "適用後チェック(0074): 総合PASS" "$(verdict $DB "$D/0074_postapply_check.sql")" "PASS"
vfy_chk "適用後チェック(0074): FAIL行なし" "$(fails $DB "$D/0074_postapply_check.sql")" "0"
vfy_chk "二重適用は拒否される" "$(psql -X -Atq -d $DB -f "$F74" 2>&1 | grep -c 'already applied')" "1"
OLD2="select public.save_stylist_profile_v2('回避','山田','30_34','female','東京都','渋谷',0,'a','{}','full_time','active',null,'[]','b','PRIVATE',false,null,'{work_life,growth,income}','1990-04-01','decade')"
B=$(snap $DB $S3)
vfy_has "回避不可: v2での直接保存は拒否" "$(asu $DB $S3 "$OLD2")" "permission denied"
vfy_has "回避不可: 18引数版での直接保存は拒否" "$(asu $DB $S3 "select public.save_stylist_profile('回避','山田','30_34','female','東京都','渋谷',0,'a','{}','full_time','active',null,'[]','b','PRIVATE',false,null,'{work_life,growth,income}')")" "permission denied"
vfy_has "回避不可: 立場だけを別に保存する関数も拒否" "$(asu $DB $S3 "select public.set_stylist_career_phase('experienced')")" "permission denied"
vfy_chk "回避不可: 拒否後も保存済みの内容は不変" "$(snap $DB $S3)" "$B"
vfy_chk "v3は引き続き動く" "$(v3 $DB $S3 再保存S3 experienced | tail -1 | grep -c '^[0-9a-f-]\{36\}$')|$(ph $DB $S3)" "1|experienced|-|-|-|-"
vfy_chk "旧データ(0074適用後): 未設定のままの行も、立場以外の更新は通る" "$(qn $DB "update public.stylist_profiles set bio='y' where user_id='$S9'" | grep -c ERROR)|$(ph $DB $S9)" "0|NULL|-|-|-|-"
# 新規登録: 立場なしの新規プロフィール行は、コミット時に拒否される（どの経路でも）
S8=00000000-0000-0000-0000-000000000098
qn $DB "insert into auth.users (id,email) values ('$S8','y@t'); insert into public.stylist_private (user_id,birth_date,age_display_mode) values ('$S8','1990-04-01','decade')" >/dev/null
vfy_has "新規: 立場なしでプロフィール行を作るとコミットで拒否" "$(qn $DB "insert into public.stylist_profiles (user_id) values ('$S8')")" "career_phase_required"
vfy_chk "新規: その行は作られていない" "$(qn $DB "select count(*) from public.stylist_profiles where user_id='$S8'")" "0"
vfy_has "新規: student で行を作ってもコミットで拒否" "$(qn $DB "insert into public.stylist_profiles (user_id, career_phase, graduation_ym, graduation_kind) values ('$S8','student','$GRAD','planned')")" "career_phase_required"
vfy_chk "新規: 同一トランザクションで立場を入れれば作れる" "$(qn $DB "begin; insert into public.stylist_profiles (user_id) values ('$S8'); update public.stylist_profiles set career_phase='blank' where user_id='$S8'; commit;" | grep -c ERROR)|$(ph $DB $S8)" "0|blank|-|-|-|-"
# 新規登録をv3で（本人・プロフィール行なし）→ 1回で作成される
S7=00000000-0000-0000-0000-000000000097
qn $DB "insert into auth.users (id,email) values ('$S7','z@t'); select 1" >/dev/null
vfy_chk "新規登録: v3だけでプロフィール行と立場が1回で作られる" "$(v3 $DB $S7 新規S7 new_graduate $GRAD planned | tail -1 | grep -c '^[0-9a-f-]\{36\}$')|$(ph $DB $S7)" "1|new_graduate|$GRAD|planned|-|-"
S6=00000000-0000-0000-0000-000000000096
qn $DB "insert into auth.users (id,email) values ('$S6','w@t'); select 1" >/dev/null
vfy_has "新規登録: 立場未選択のv3は拒否され、行は作られない" "$(v3 $DB $S6 新規S6 null)" "career_phase_required"
vfy_chk "新規登録: 拒否後に行・個人情報が残らない" "$(qn $DB "select (select count(*) from public.stylist_profiles where user_id='$S6')||'|'||(select count(*) from public.stylist_private where user_id='$S6')")" "0|0"
# 診断は不変
vfy_chk "診断履歴・現在の診断・回数制限の表は、0073/0074の前後で変化なし" "$(qn $DB "select (select count(*) from public.student_diagnosis_results)||'|'||(select count(*) from public.stylist_diagnosis_current)||'|'||(select count(*) from public.diagnosis_results)")" "$DIAG_BEFORE"
vfy_chk "診断: service_role は学生診断の確定保存を従来どおり実行できる（ブランクありの本人でも）" "$(qn $DB "set role service_role; select (public.commit_student_diagnosis('$S3'::uuid,gen_random_uuid(),'student_newgrad_v1','$ANS'::jsonb,'{\"x\":1}'::jsonb))->>'action'" | tail -1)" "initial"

if [ "$PROD_ORDER" = 1 ]; then
echo "== 本番順の追加確認（0059の旧経路閉鎖・0072の専用保存が 0073/0074 の後も維持される）"
vfy_chk "0059の適用後チェック: 0074適用後も総合PASS" "$(verdict $DB "$(ffind 0059_postapply_check.sql)")" "PASS"
vfy_chk "0072の適用後チェック: 0074適用後も総合PASS" "$(verdict $DB "$D/../profile-value-priorities-db/0072_postapply_check.sql")" "PASS"
vfy_chk "0072: 専用関数は authenticated のみ実行可（0074の後も）" "$(qn $DB "select has_function_privilege('authenticated','public.set_stylist_value_priorities(text[])','execute')::text||has_function_privilege('anon','public.set_stylist_value_priorities(text[])','execute')::text||has_function_privilege('service_role','public.set_stylist_value_priorities(text[])','execute')::text")" "truefalsefalse"
B=$(qn $DB "select (to_jsonb(sp)-'value_priorities'-'updated_at')::text from public.stylist_profiles sp where user_id='$S3'")
vfy_chk "0072: 専用関数で value_priorities だけ更新できる（立場・他の項目は不変）" "$(asu $DB $S3 "select public.set_stylist_value_priorities('{teamwork,independence,culture_fit}'::text[])" | grep -c ERROR)|$(qn $DB "select array_to_string(value_priorities,',') from public.stylist_profiles where user_id='$S3'")|$(qn $DB "select (to_jsonb(sp)-'value_priorities'-'updated_at')::text from public.stylist_profiles sp where user_id='$S3'")" "0|teamwork,independence,culture_fit|$B"
vfy_chk "0072: 立場が未設定の旧データの本人でも専用関数は動く（立場は変わらない）" "$(asu $DB $S9 "select public.set_stylist_value_priorities('{teamwork,independence,culture_fit}'::text[])" | grep -c ERROR)|$(ph $DB $S9)" "0|NULL|-|-|-|-"
vfy_has "0059: 診断結果の表への直接書き込みは authenticated・service_role とも拒否のまま" "$(qn $DB "set role authenticated; insert into public.diagnosis_results (user_id) values ('$S3')")" "permission denied"
vfy_has "0059: service_role も直接INSERTは拒否のまま" "$(qn $DB "set role service_role; insert into public.diagnosis_results (user_id) values ('$S3')")" "permission denied"
fi

# --- チェック自体の確認（変異）: 0074 を一部欠いた状態を FAIL にできる
DB3=${PFX}c; build $DB3; psql -X -q -v ON_ERROR_STOP=1 -d $DB3 -f "$F73" >/dev/null 2>&1
sed '/^revoke execute on function public.set_stylist_career_phase/d' "$F74" | psql -X -q -v ON_ERROR_STOP=1 -d $DB3 >/dev/null 2>&1
vfy_has "変異: 立場だけの保存関数を閉じ忘れた 0074 は適用後チェックで FAIL" "$(verdict $DB3 "$D/0074_postapply_check.sql")" "FAIL"
DB4=${PFX}d; build $DB4; psql -X -q -v ON_ERROR_STOP=1 -d $DB4 -f "$F73" >/dev/null 2>&1
vfy_has "変異: 0073 のみ適用の状態では 0074 の適用後チェックは FAIL" "$(verdict $DB4 "$D/0074_postapply_check.sql")" "FAIL"
DB5=${PFX}e; build $DB5
sed 's/in (.new_graduate.,.experienced.,.blank.)) then/in ('"'"'new_graduate'"'"','"'"'experienced'"'"')) then/' "$F73" | psql -X -q -v ON_ERROR_STOP=1 -d $DB5 >/dev/null 2>&1
vfy_has "変異: v3が blank を拒否する版（仕様逸脱）は 0073 の動作確認で検出される" "$(v3 $DB5 $S1 x blank)" "career_phase_required"
vfy_has "変異: 前提（0071）が無いDBに 0073 を当てると止まる" "$(vdb_create ${PFX}e "$VFY_TPL"; psql -X -q -d ${PFX}e -f "$F73" 2>&1)" "requires 0071"

# --- 巻き戻し
echo "== 巻き戻し"
vfy_chk "0074巻き戻し: 実行できる" "$(psql -X -q -v ON_ERROR_STOP=1 -d $DB -f "$D/0074_rollback.draft.sql" 2>&1 | grep -c ERROR)" "0"
vfy_chk "0074巻き戻し: 旧経路の権限が戻り、挿入トリガーが消える" "$(qn $DB "select has_function_privilege('authenticated','public.set_stylist_career_phase(text,date,text,date,text)','execute')::text||(select count(*) from pg_trigger where tgname='trg_career_phase_required_on_insert')")" "true0"
qn $DB "update public.stylist_profiles set career_phase='blank', graduation_ym=null, graduation_kind=null, desired_start_ym=null, license_status=null where user_id='$S3'" >/dev/null
vfy_has "0073巻き戻し: ブランクありの人がいる間は拒否（データを消さない）" "$(psql -X -q -v ON_ERROR_STOP=1 -d $DB -f "$D/0073_rollback.draft.sql" 2>&1)" "blank"
qn $DB "update public.stylist_profiles set career_phase='experienced' where career_phase='blank'" >/dev/null
vfy_chk "0073巻き戻し: ブランクありが0なら実行でき、v3とトリガーが消える" "$(psql -X -q -v ON_ERROR_STOP=1 -d $DB -f "$D/0073_rollback.draft.sql" 2>&1 | grep -c ERROR)|$(qn $DB "select (to_regprocedure('public.save_stylist_profile_v3(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[],date,text,text,date,text,date,text)') is null)::text||(select count(*) from pg_trigger where tgname='trg_career_phase_valid')")" "0|true0"
vfy_chk "0073巻き戻し: 0071の制約（student可・blank不可）に戻り、データは残る" "$(qn $DB "select (select count(*) from pg_constraint where conname='stylist_profiles_career_phase_check' and pg_get_constraintdef(oid) like '%blank%')||'|'||(select count(*) from public.stylist_profiles)")" "0|$(qn $DB "select count(*) from public.stylist_profiles")"
vfy_exit
