#!/bin/bash
# 0072（value_priorities だけを更新する専用の保存関数）の検証。ローカル・使い捨てDBのみ。本番には接続しない。
# 使い方: su postgres -c "bash docs/profile-value-priorities-db/0072_verify.sh"
D=$(cd "$(dirname "$0")" && pwd); V="$D/../verify-0070-0071"
. "$V/verify_common.sh"
vfy_preflight 0070_stylist_profile_public.draft.sql 0070_fixture.sql stub_supabase.sql
vfy_ensure_template
PFX=vfy_vp72_$$_; trap 'vdb_drop ${PFX}a; vdb_drop ${PFX}b; rm -rf "$VFY_TMPD"' EXIT
S1=00000000-0000-0000-0000-000000000001; S2=00000000-0000-0000-0000-000000000002; S9=00000000-0000-0000-0000-000000000099
VFY_TMPD=${VFY_TMPD:-$(mktemp -d)}
qn() { psql -X -Atq -d "$1" -c "$2" 2>&1; }
asu() { local db=$1 sub=$2; shift 2; psql -X -Atq -d "$db" -c "set role authenticated; select set_config('request.jwt.claim.sub','$sub',false); $*" 2>&1; }
DB=${PFX}a; vfy_build_0070_fixture $DB
fullsave() { echo "select public.save_stylist_profile_v2('さくら','山田 花子','30_34','female','東京都','渋谷',0,'スタイリスト','{カット}','full_time','active',null,'[]','$1','$2',false,null,'$3','1990-04-01','decade')"; }
asu $DB $S1 "$(fullsave 初期の自己紹介 PRIVATE '{work_life,growth,income}')" >/dev/null
# 適用前: 専用関数は無い
vfy_chk "適用前: 専用関数は無い" "$(qn $DB "select to_regprocedure('public.set_stylist_value_priorities(text[])') is null")" "t"
# 適用前チェック（適用前に総合PASS）
vfy_has "適用前チェック: 総合PASS" "$(qn $DB "$(cat "$D/0072_preapply_check.sql")" | tail -1)" "PASS"
psql -X -q -v ON_ERROR_STOP=1 -d $DB -f "$D/0072_value_priorities_save.draft.sql" >/dev/null || { echo "FAIL: 0072の適用"; exit 1; }
vfy_has "適用後チェック: 総合PASS（全項目）" "$(qn $DB "$(cat "$D/0072_postapply_check.sql")" | tail -1)" "PASS"
vfy_chk "適用後チェック: FAILの行なし" "$(qn $DB "$(cat "$D/0072_postapply_check.sql")" | grep -c '|FAIL|')" "0"
vfy_chk "二重適用は拒否される" "$(psql -X -Atq -d $DB -f "$D/0072_value_priorities_save.draft.sql" 2>&1 | grep -c 'already applied')" "1"
# 比較用スナップショット（value_priorities と更新日時を除く全項目。プロフィール4表）
rest() { qn $DB "select (to_jsonb(sp) - 'value_priorities' - 'updated_at')::text || (to_jsonb(s) - 'updated_at')::text || (select (to_jsonb(p) - 'updated_at')::text from public.profiles p where id='$1') || (select (to_jsonb(u) - 'updated_at')::text from public.user_settings u where user_id='$1') from public.stylist_profiles sp, public.stylist_private s where sp.user_id='$1' and s.user_id='$1'"; }
vp() { qn $DB "select array_to_string(value_priorities,',') from public.stylist_profiles where user_id='$1'"; }
set_vp() { asu $DB "$1" "select public.set_stylist_value_priorities('$2'::text[])"; }
# 1) 権限
vfy_chk "権限: authenticated だけが実行できる（anon・service_role・PUBLICは不可）" "$(qn $DB "select has_function_privilege('authenticated','public.set_stylist_value_priorities(text[])','execute')::text||has_function_privilege('anon','public.set_stylist_value_priorities(text[])','execute')::text||has_function_privilege('service_role','public.set_stylist_value_priorities(text[])','execute')::text")" "truefalsefalse"
vfy_has "権限: 表を直接UPDATEできない（本人でも）" "$(asu $DB $S1 "update public.stylist_profiles set value_priorities='{a,b,c}' where user_id='$S1'")" "permission denied"
# 2) 正常
B1=$(rest $S1); B2=$(rest $S2); V2=$(vp $S2)
set_vp $S1 '{teamwork,independence,culture_fit}' >/dev/null
vfy_chk "正常: 診断の3つ（選んだ順）に更新される" "$(vp $S1)" "teamwork,independence,culture_fit"
vfy_chk "正常: value_priorities 以外の全項目（公開範囲・自己紹介・生年月日・表示方法・氏名・画像・受信設定）は不変" "$(rest $S1)" "$B1"
vfy_chk "正常: 他人（S2）の行は変わらない" "$(vp $S2)|$(rest $S2)" "$V2|$B2"
# 3) 検証（DB側）
B1=$(rest $S1); V1=$(vp $S1)
for c in "'{teamwork,independence}'" "'{teamwork,independence,culture_fit,skill_growth}'" "'{teamwork,teamwork,independence}'" "'{teamwork,independence,nope}'" "'{teamwork,independence,NULL}'" "'{{teamwork,independence,culture_fit}}'" "'{}'" "NULL"; do
  out=$(asu $DB $S1 "select public.set_stylist_value_priorities($c::text[])")
  vfy_has "拒否: $c" "$out" "invalid_value_priorities"
done
vfy_chk "拒否されたあとも保存済みの内容は変わらない" "$(vp $S1)|$(rest $S1)" "$V1|$B1"
# 4) 本人確認
vfy_has "未認証（auth.uid()なし）は拒否" "$(psql -X -Atq -d $DB -c "set role authenticated; select set_config('request.jwt.claim.sub','',false); select public.set_stylist_value_priorities('{teamwork,independence,culture_fit}')" 2>&1)" "not authenticated"
vfy_has "プロフィール未保存の本人は拒否（行を作らない）" "$(set_vp $S9 '{teamwork,independence,culture_fit}')" "profile_not_found"
vfy_chk "プロフィール未保存の本人: 行は作られない" "$(qn $DB "select count(*) from public.stylist_profiles where user_id='$S9'")" "0"
vfy_has "生年月日が未登録の本人は、既存の規則どおり拒否（0070のトリガー）" "$(qn $DB "update public.stylist_private set age_display_mode=null where user_id='$S2'" >/dev/null; qn $DB "select 1" >/dev/null; asu $DB $S2 "select public.set_stylist_value_priorities('{teamwork,independence,culture_fit}')")" "age_display_mode_required\|birth_date_required\|violates"
# 5) 競合: 別画面でのプロフィール保存（公開範囲・自己紹介）と重なっても、その変更が残る
DB2=${PFX}b; vfy_build_0070_fixture $DB2; DB=$DB2
psql -X -q -v ON_ERROR_STOP=1 -d $DB -f "$D/0072_value_priorities_save.draft.sql" >/dev/null || { echo "FAIL: 0072の適用（競合テスト用DB）"; exit 1; }
asu $DB $S1 "$(fullsave 初期の自己紹介 PRIVATE '{work_life,growth,income}')" >/dev/null
# 5a) プロフィール保存が先（保持中）→ 専用関数は待つ → 両方の変更が残る
vfy_bg hold psql -X -q -v ON_ERROR_STOP=1 -d $DB -c "set role authenticated; select set_config('request.jwt.claim.sub','$S1',false); begin; $(fullsave 別画面で更新した自己紹介 PUBLIC '{work_life,growth,income}'); select pg_sleep(3); commit;"
vfy_expect_held $DB "pg_sleep(3)" "5a プロフィール保存（保持側）"
vfy_bg wait psql -X -q -v ON_ERROR_STOP=1 -d $DB -c "set role authenticated; select set_config('request.jwt.claim.sub','$S1',false); select public.set_stylist_value_priorities('{teamwork,independence,culture_fit}')"
vfy_expect_blocked $DB "set_stylist_value_priorities" "5a 専用関数（待ち側）"
vfy_join hold wait; echo "  (hold: $(vfy_out hold | head -c 200) | wait: $(vfy_out wait | head -c 200))"
vfy_chk "5a: 両方成功" "$(vfy_rc hold)$(vfy_rc wait)" "00"
vfy_chk "5a: 別画面の公開範囲・自己紹介の変更が残り、value_priorities は専用関数の値" "$(qn $DB "select visibility||'|'||bio||'|'||array_to_string(value_priorities,',') from public.stylist_profiles where user_id='$S1'")" "PUBLIC|別画面で更新した自己紹介|teamwork,independence,culture_fit"
# 5b) 専用関数が先（保持中）→ プロフィール保存は待つ。保存した公開範囲・自己紹介は残る
asu $DB $S1 "$(fullsave 初期の自己紹介 PRIVATE '{work_life,growth,income}')" >/dev/null
vfy_bg hold psql -X -q -v ON_ERROR_STOP=1 -d $DB -c "set role authenticated; select set_config('request.jwt.claim.sub','$S1',false); begin; select public.set_stylist_value_priorities('{teamwork,independence,culture_fit}'); select pg_sleep(3); commit;"
vfy_expect_held $DB "pg_sleep(3)" "5b 専用関数（保持側）"
vfy_bg wait psql -X -q -v ON_ERROR_STOP=1 -d $DB -c "set role authenticated; select set_config('request.jwt.claim.sub','$S1',false); $(fullsave 別画面で更新した自己紹介 PUBLIC '{work_life,growth,income}')"
vfy_expect_blocked $DB "save_stylist_profile_v2" "5b プロフィール保存（待ち側）"
vfy_join hold wait; echo "  (hold: $(vfy_out hold | head -c 200) | wait: $(vfy_out wait | head -c 200))"
vfy_chk "5b: 両方成功" "$(vfy_rc hold)$(vfy_rc wait)" "00"
vfy_chk "5b: プロフィール保存の公開範囲・自己紹介の変更が残る" "$(qn $DB "select visibility||'|'||bio from public.stylist_profiles where user_id='$S1'")" "PUBLIC|別画面で更新した自己紹介"
echo "INFO  5b: このとき value_priorities は、後から確定したプロフィール保存の入力値（$(qn $DB "select array_to_string(value_priorities,',') from public.stylist_profiles where user_id='$S1'")）になる。プロフィール保存は全項目を送る既存の仕様で、古い画面から保存すると、その画面にあった値が残る（0072では変えない）"
# 5c) 適用後チェックが、逸脱した関数（SET に bio を足した版）を検出できる（チェック自体の確認）
DB3=${PFX}c; trap 'vdb_drop ${PFX}a; vdb_drop ${PFX}b; vdb_drop ${PFX}c; rm -rf "$VFY_TMPD"' EXIT
vfy_build_0070_fixture $DB3
sed "s/set value_priorities = p_value_priorities where/set value_priorities = p_value_priorities, bio = 'x' where/" "$D/0072_value_priorities_save.draft.sql" | psql -X -q -v ON_ERROR_STOP=1 -d $DB3 >/dev/null
vfy_has "適用後チェックは、他の列も更新する関数を FAIL にする" "$(qn $DB3 "$(cat "$D/0072_postapply_check.sql")" | tail -1)" "99|FAIL"
# 6) 巻き戻し
psql -X -q -v ON_ERROR_STOP=1 -d $DB -f "$D/0072_rollback.draft.sql" >/dev/null
vfy_chk "巻き戻し: 専用関数が消え、保存済みのデータは残る" "$(qn $DB "select (to_regprocedure('public.set_stylist_value_priorities(text[])') is null)::text||'|'||(select count(*) from public.stylist_profiles where value_priorities is not null)")" "true|$(qn $DB "select count(*) from public.stylist_profiles where value_priorities is not null")"
vfy_exit
