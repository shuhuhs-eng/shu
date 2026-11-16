#!/bin/bash
# 0076/0077（立場の入力簡素化）の検証。ローカル・使い捨てDBのみ。本番には接続しない。
# 適用順は本番の現状と同じ 0058→0070→0059→0071→0072→0073→0074 のあと、0076 → 0077。
# 使い方: su postgres -c "bash docs/career-phase-simplify-db/0076_0077_verify.sh"
D=$(cd "$(dirname "$0")" && pwd); V="$D/../verify-0070-0071"
. "$V/verify_common.sh"
F72="$D/../profile-value-priorities-db/0072_value_priorities_save.draft.sql"; F73="$D/../career-phase-required-db/0073_career_phase_required.draft.sql"; F74="$D/../career-phase-required-db/0074_close_old_save_paths.draft.sql"
F76="$D/0076_career_phase_simplify.draft.sql"; R76="$D/0076_rollback.draft.sql"; F77="$D/0077_close_v3.draft.sql"; R77="$D/0077_rollback.draft.sql"
vfy_preflight 0058_diagnosis_change_limits.draft.sql 0070_stylist_profile_public.draft.sql 0070_fixture.sql 0071_student_newgrad.draft.sql 0059_close_direct_paths.draft.sql stub_supabase.sql
for f in "$F72" "$F73" "$F74" "$F76" "$R76" "$F77" "$R77"; do [ -f "$f" ] || vfy_die "見つかりません: $f"; done
echo "== 適用順: 0058→0070→0059→0071→0072→0073→0074（本番の現状）→ 0076 → 0077"
vfy_ensure_template
PFX=vfy_cp76_$$_; trap 'for x in a b c; do vdb_drop ${PFX}$x; done; rm -rf "$VFY_TMPD"' EXIT
U=00000000-0000-0000-0000-0000000000; S1=${U}01; S2=${U}02; S3=${U}03; S4=${U}04
qn() { psql -X -Atq -d "$1" -c "$2" 2>&1; }
asu() { local db=$1 sub=$2; shift 2; psql -X -Atq -d "$db" -c "set role authenticated; select set_config('request.jwt.claim.sub','$sub',false); $*" 2>&1; }
verdict() { psql -X -Atq -F'|' -d "$1" -f "$2" 2>&1 | grep -E '^99\|' | cut -d'|' -f2; }
fails() { psql -X -Atq -F'|' -d "$1" -f "$2" 2>&1 | grep -c '^[0-9]*|FAIL|'; }
ap() { vpsql -d "$1" -f "$2" >/dev/null 2>"$VFY_ERR" || { grep -v NOTICE "$VFY_ERR"|head -3 >&2; vfy_die "適用失敗 $2"; }; }
build() { local db=$1; vdb_create "$db" "$VFY_TPL"; vpsql -d "$db" -f "$(ffind 0070_fixture.sql)" >/dev/null || vfy_die fixture
  for f in 0058_diagnosis_change_limits.draft.sql 0070_stylist_profile_public.draft.sql 0059_close_direct_paths.draft.sql 0071_student_newgrad.draft.sql; do ap $db "$(ffind $f)"; done; }
Y=$(date +%Y); NY=$((Y+1)); M0=$(date +%Y-%m-01)
# 旧v3呼び出し（0073の仕様）: v3 SUB 名 立場 卒業 区分 開始 免許
v3() { local db=$1 sub=$2 name=$3 ph=$4 g=${5:-null} gk=${6:-null} st=${7:-null} lic=${8:-null}; q() { [ "$1" = null ] && echo null || echo "'$1'"; }
  asu $db $sub "select (public.save_stylist_profile_v3('$name','山田 花子','30_34','female','東京都','渋谷',0,'スタイリスト','{カット}','full_time','active',null,'[]','自己紹介-$name','PRIVATE',false,null,'{work_life,growth,income}','1990-04-01','decade',$(q $ph),$(q $g)::date,$(q $gk),$(q $st)::date,$(q $lic))).id"; }
# v4: v4 SUB 名 立場 卒業 期間値 単位 [公開範囲] [自己紹介]
v4() { local db=$1 sub=$2 name=$3 ph=$4 g=${5:-null} bv=${6:-null} bu=${7:-null} vis=${8:-PRIVATE} bio=${9:-自己紹介-$3}; q() { [ "$1" = null ] && echo null || echo "'$1'"; }
  asu $db $sub "select (public.save_stylist_profile_v4('$name','山田 花子','30_34','female','東京都','渋谷',0,'スタイリスト','{カット}','full_time','active',null,'[]','$bio','$vis',false,null,'{work_life,growth,income}','1990-04-01','decade',$(q $ph),$(q $g)::date,$bv,$(q $bu))).id"; }
snap() { qn $1 "select (to_jsonb(sp))::text || (to_jsonb(s))::text || (select to_jsonb(p)::text from public.profiles p where id='$2') from public.stylist_profiles sp, public.stylist_private s where sp.user_id='$2' and s.user_id='$2'"; }
ph() { qn $1 "select coalesce(career_phase,'NULL')||'|'||coalesce(to_char(graduation_ym,'YYYY-MM-DD'),'-')||'|'||coalesce(blank_period_value::text,'-')||'/'||coalesce(blank_period_unit,'-') from public.stylist_profiles where user_id='$2'"; }
legacy() { qn $1 "select coalesce(graduation_kind,'-')||'|'||coalesce(desired_start_ym::text,'-')||'|'||coalesce(license_status,'-') from public.stylist_profiles where user_id='$2'"; }
okid() { printf '%s' "$1" | tail -1 | grep -c '^[0-9a-f-]\{36\}$'; }

DB=${PFX}a; build $DB; ap $DB "$F72"; ap $DB "$F73"
# 旧データ（0073の仕様で保存）: S1=新卒(卒業月5月・区分completed・開始・免許) S2=現役 S3=ブランク S4=新卒(3月・planned)
PAST5=$(date -d "$M0 -2 month" +%Y-%m-01); START=$(date -d "$M0 +1 month" +%Y-%m-01)
v3 $DB $S1 旧S1 new_graduate $PAST5 completed $START obtained >/dev/null; v3 $DB $S2 旧S2 experienced >/dev/null; v3 $DB $S3 旧S3 blank >/dev/null; v3 $DB $S4 旧S4 new_graduate ${NY}-03-01 planned >/dev/null
ap $DB "$F74"
LEG_BEFORE=$(qn $DB "select md5(string_agg(to_jsonb(sp)::text, ',' order by user_id)) from public.stylist_profiles sp")
echo "INFO  旧S1の旧3項目: $(legacy $DB $S1)"
echo "== 0076 適用前"
vfy_chk "適用前チェック: 総合PASS" "$(verdict $DB "$D/0076_preapply_check.sql")" "PASS"
ap $DB "$F76"
echo "== 0076 適用後"
vfy_chk "適用後チェック: 総合PASS" "$(verdict $DB "$D/0076_postapply_check.sql")" "PASS"
vfy_chk "適用後チェック: FAIL行なし" "$(fails $DB "$D/0076_postapply_check.sql")" "0"
vfy_chk "二重適用は拒否される" "$(psql -X -Atq -d $DB -f "$F76" 2>&1 | grep -c 'already applied')" "1"
vfy_chk "既存データは一切変更されない（美容師プロフィール全行。列追加分はNULL）" "$(qn $DB "select md5(string_agg((to_jsonb(sp) - 'blank_period_value' - 'blank_period_unit')::text, ',' order by user_id)) from public.stylist_profiles sp")" "$LEG_BEFORE"
vfy_chk "旧S1（卒業月5月・区分・開始・免許）は丸めず・消さず残る" "$(ph $DB $S1)|$(legacy $DB $S1)" "new_graduate|$PAST5|-/-|completed|$START|obtained"
vfy_chk "権限: v4は authenticated のみ。v2・v1・set_stylist_career_phase は閉じたまま。v3は0077まで実行可" "$(qn $DB "select has_function_privilege('authenticated'::name,'public.save_stylist_profile_v4(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[],date,text,text,date,integer,text)'::regprocedure::oid,'execute')::text||has_function_privilege('anon'::name,'public.save_stylist_profile_v4(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[],date,text,text,date,integer,text)'::regprocedure::oid,'execute')::text||has_function_privilege('authenticated'::name,'public.set_stylist_career_phase(text,date,text,date,text)'::regprocedure::oid,'execute')::text||has_function_privilege('authenticated'::name,'public.save_stylist_profile_v3(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[],date,text,text,date,text,date,text)'::regprocedure::oid,'execute')::text")" "truefalsefalsetrue"
# ---- 新卒: 3月・10月は保存でき、ほかの月は拒否。旧3項目なしで保存できる
vfy_chk "v4: 新卒・3月が旧3項目なしで保存できる（区分を裏で補わない）" "$(okid "$(v4 $DB $S2 新S2 new_graduate ${NY}-03-01)")|$(ph $DB $S2)|$(legacy $DB $S2)" "1|new_graduate|${NY}-03-01|-/-|-|-|-"
vfy_chk "v4: 新卒・10月が保存できる（再選択）" "$(v4 $DB $S2 新S2 new_graduate ${NY}-10-01 >/dev/null; ph $DB $S2)" "new_graduate|${NY}-10-01|-/-"
vfy_chk "旧S1: 3月へ選び直して保存でき、旧3項目（completed・開始・免許）は変わらない" "$(v4 $DB $S1 新S1 new_graduate ${NY}-03-01 >/dev/null; ph $DB $S1)|$(legacy $DB $S1)" "new_graduate|${NY}-03-01|-/-|completed|$START|obtained"
reject() { local label=$1 sub=$2 exp=$3; shift 3; local b=$(snap $DB $sub); local out=$(v4 $DB $sub 拒否される名 "$@"); vfy_has "拒否: $label" "$out" "$exp"; vfy_chk "拒否後: $label — 何も保存されない" "$(snap $DB $sub)" "$b"; }
for m in 01 02 04 05 06 07 08 09 11 12; do reject "新卒の月が $m 月" $S2 graduation_month_invalid new_graduate ${NY}-$m-01; done
reject "新卒で卒業年月なし" $S2 "graduation month required" new_graduate null
reject "新卒で範囲外（10年後の3月）" $S2 "out of range" new_graduate $((Y+10))-03-01
reject "新卒で範囲外（10年前の10月）" $S2 "out of range" new_graduate $((Y-10))-10-01
reject "新卒でブランク期間が付いている" $S2 "blank period must be empty" new_graduate ${NY}-03-01 6 months
reject "現役に卒業年月" $S3 "must be empty" experienced ${NY}-03-01
reject "現役にブランク期間" $S3 "must be empty" experienced null 6 months
reject "ブランクに卒業年月" $S3 "must be empty" blank ${NY}-03-01
reject "立場が未選択(NULL)" $S3 career_phase_required null
reject "旧値student" $S3 career_phase_required student
# ---- ブランク期間
vfy_chk "ブランク: 6ヶ月が保存される" "$(v4 $DB $S3 新S3 blank null 6 months >/dev/null; ph $DB $S3)" "blank|-|6/months"
vfy_chk "ブランク: 2年が保存される" "$(v4 $DB $S3 新S3 blank null 2 years >/dev/null; ph $DB $S3)" "blank|-|2/years"
vfy_chk "ブランク: 10年超も保存できる（121ヶ月・11年・25年）と、上限（720ヶ月・60年）" "$(for c in "121 months" "11 years" "25 years" "720 months" "60 years"; do set -- $c; v4 $DB $S3 新S3 blank null $1 $2 >/dev/null; ph $DB $S3; done | tr '\n' ',')" "blank|-|121/months,blank|-|11/years,blank|-|25/years,blank|-|720/months,blank|-|60/years,"
vfy_chk "ブランク: 未入力でも保存でき、0ヶ月にはならない（NULLのまま）" "$(v4 $DB $S3 新S3 blank >/dev/null; ph $DB $S3)" "blank|-|-/-"
for c in "0 months" "-1 months" "721 months" "61 years" "9999 months" "0 years" "6 weeks" "6 null" "null months"; do set -- $c; reject "ブランク期間の不正値（$1 $2）" $S3 "blank period" blank null $1 $2; done
# ---- 立場の切り替え
v4 $DB $S3 切替S3 blank null 6 months >/dev/null
vfy_chk "切替: ブランク→現役でブランク期間が消える（ほかの旧3項目・プロフィールは不変）" "$(v4 $DB $S3 切替S3 experienced >/dev/null; ph $DB $S3)" "experienced|-|-/-"
v4 $DB $S1 切替S1 new_graduate ${NY}-10-01 >/dev/null
vfy_chk "切替: 新卒→現役で卒業年月が消え、旧3項目（completed・開始・免許）は残る" "$(v4 $DB $S1 切替S1 experienced >/dev/null; ph $DB $S1)|$(legacy $DB $S1)" "experienced|-|-/-|completed|$START|obtained"
vfy_chk "切替: 現役→ブランク（期間つき）。旧3項目は残る" "$(v4 $DB $S1 切替S1 blank null 3 years >/dev/null; ph $DB $S1)|$(legacy $DB $S1)" "blank|-|3/years|completed|$START|obtained"
vfy_chk "切替: ブランク→新卒でブランク期間が消え、卒業年月が入る" "$(v4 $DB $S1 切替S1 new_graduate ${NY}-03-01 >/dev/null; ph $DB $S1)" "new_graduate|${NY}-03-01|-/-"
# ---- プロフィール・公開範囲・生年月日・自己紹介が意図せず変わらない／全体が取り消される
B=$(qn $DB "select visibility||'|'||coalesce(bio,'')||'|'||coalesce(value_priorities::text,'') from public.stylist_profiles where user_id='$S4'"); BD=$(qn $DB "select birth_date from public.stylist_private where user_id='$S4'")
v4 $DB $S4 同じ名 experienced null null null PRIVATE "自己紹介-旧S4" >/dev/null
vfy_chk "公開範囲・自己紹介・大切にしたいこと・生年月日は、送った値のまま（立場の切り替えで変わらない）" "$(qn $DB "select visibility||'|'||bio||'|'||value_priorities::text from public.stylist_profiles where user_id='$S4'")|$(qn $DB "select birth_date from public.stylist_private where user_id='$S4'")" "PRIVATE|自己紹介-旧S4|{work_life,growth,income}|1990-04-01"
b=$(snap $DB $S4); out=$(asu $DB $S4 "select (public.save_stylist_profile_v4('名','山田','30_34','female','東京都','渋谷',0,'スタイリスト','{カット}','full_time','active',null,'[]','変更される自己紹介','PRIVATE',false,null,'{work_life,growth,income}','1990-04-01','bogus_mode','blank',null,6,'months')).id")
vfy_has "全体が取り消される: 追加情報（年齢表示方法）が不正なら失敗する" "$out" "ERROR"
vfy_chk "全体が取り消される: 失敗後、プロフィールも立場もブランク期間も何も保存されない" "$(snap $DB $S4)" "$b"
# ---- DB（トリガー・制約）でも拒否。既存行の他項目の更新は妨げない
vfy_has "DB: 卒業月5月を直接書くと拒否（トリガー）" "$(qn $DB "update public.stylist_profiles set graduation_ym='${NY}-05-01' where user_id='$S4'")" "graduation_month_invalid\|violates"
vfy_has "DB: 立場を新卒にする更新で月が5月なら拒否" "$(qn $DB "update public.stylist_profiles set career_phase='experienced', graduation_ym=null where user_id='$S4'; update public.stylist_profiles set career_phase='new_graduate', graduation_ym='${NY}-05-01' where user_id='$S4'")" "graduation_month_invalid"
vfy_has "DB: ブランク期間が不正（0ヶ月・単位だけ）は拒否（制約）" "$(qn $DB "update public.stylist_profiles set career_phase='blank', blank_period_value=0, blank_period_unit='months' where user_id='$S4'; update public.stylist_profiles set blank_period_unit='years' where user_id='$S4'")" "violates check constraint"
vfy_has "DB: ブランク期間の上限超え（721ヶ月・61年）は拒否。11年は通る" "$(qn $DB "update public.stylist_profiles set career_phase='blank', blank_period_value=721, blank_period_unit='months' where user_id='$S4'")|$(qn $DB "update public.stylist_profiles set career_phase='blank', blank_period_value=61, blank_period_unit='years' where user_id='$S4'")|$(qn $DB "update public.stylist_profiles set career_phase='blank', blank_period_value=11, blank_period_unit='years' where user_id='$S4'; select 'OK11'")" "violates check constraint"
vfy_has "DB: 現役にブランク期間が残る更新は、トリガーで消えて通る" "$(qn $DB "update public.stylist_profiles set career_phase='blank', blank_period_value=6, blank_period_unit='months' where user_id='$S4'; update public.stylist_profiles set career_phase='experienced' where user_id='$S4'; select coalesce(blank_period_value::text,'cleared') from public.stylist_profiles where user_id='$S4'")" "cleared"
# 旧データ（卒業月5月）の行が、他の項目の更新で拒否されない
DBb=${PFX}b; build $DBb; ap $DBb "$F72"; ap $DBb "$F73"; v3 $DBb $S1 旧S1 new_graduate $PAST5 completed $START obtained >/dev/null; ap $DBb "$F74"; ap $DBb "$F76"
vfy_chk "既存行（卒業月が5月の新卒）は、他の項目の更新で拒否されない・丸められない" "$(qn $DBb "update public.stylist_profiles set bio='別の更新' where user_id='$S1'; select to_char(graduation_ym,'YYYY-MM')||'|'||bio from public.stylist_profiles where user_id='$S1'" | tail -1)" "$(date -d "$PAST5" +%Y-%m)|別の更新"
vfy_chk "既存行（5月・新卒）が、v4で立場も月も変えずに保存しようとすると、選び直しを求めて拒否される" "$(v4 $DBb $S1 保存 new_graduate $PAST5 | grep -c graduation_month_invalid)" "1"
# ---- 0072 の専用保存は維持（その1列だけ）
VB=$(qn $DB "select md5((to_jsonb(sp) - 'value_priorities' - 'updated_at')::text) from public.stylist_profiles sp where user_id='$S4'"); PB=$(qn $DB "select md5(to_jsonb(s)::text) from public.stylist_private s where user_id='$S4'")
asu $DB $S4 "select public.set_stylist_value_priorities('{teamwork,independence,culture_fit}')" >/dev/null
vfy_chk "0072の専用保存: value_priorities だけが変わる（立場・ブランク期間・ほかの項目・個人情報は不変）" "$(qn $DB "select value_priorities::text from public.stylist_profiles where user_id='$S4'")|$(qn $DB "select md5((to_jsonb(sp) - 'value_priorities' - 'updated_at')::text) from public.stylist_profiles sp where user_id='$S4'")|$(qn $DB "select md5(to_jsonb(s)::text) from public.stylist_private s where user_id='$S4'")" "{teamwork,independence,culture_fit}|$VB|$PB"
# ---- 0077
echo "== 0077"
vfy_chk "0077 適用前チェック: 総合PASS" "$(verdict $DB "$D/0077_preapply_check.sql")" "PASS"
ap $DB "$F77"
vfy_chk "0077 適用後チェック: 総合PASS・FAIL行なし" "$(verdict $DB "$D/0077_postapply_check.sql")|$(fails $DB "$D/0077_postapply_check.sql")" "PASS|0"
vfy_chk "v3は誰も実行できない" "$(v3 $DB $S4 旧経路 experienced | grep -c 'permission denied')" "1"
vfy_chk "v4は引き続き保存できる" "$(okid "$(v4 $DB $S4 新経路 blank null 1 years)")" "1"
vfy_chk "0077 の二重適用は拒否される" "$(psql -X -Atq -d $DB -f "$F77" 2>&1 | grep -c 'already applied')" "1"
ap $DB "$R77"
vfy_chk "0077 巻き戻し: v3が再び実行できる（データ不変）" "$(v3 $DB $S4 戻し experienced | grep -c 'permission denied')" "0"
# ---- 0076 の巻き戻し: 新データが失われるなら中止。データは削除しない
echo "== 0076 巻き戻し"
DBc=${PFX}c; build $DBc; ap $DBc "$F72"; ap $DBc "$F73"; ap $DBc "$F74"; ap $DBc "$F76"
# 実行順のガード: 0077（v3を閉じる）適用済みなら、0076の巻き戻しは何も変更せず拒否される（先に0077を巻き戻す）
ap $DBc "$F77"; GB=$(qn $DBc "select md5(string_agg(to_jsonb(sp)::text, ',' order by user_id)) from public.stylist_profiles sp")
GOUT=$(psql -X -Atq -d $DBc -f "$R76" 2>&1)
vfy_has "0077適用済みなら、0076の巻き戻しは拒否され、先に0077を巻き戻すよう案内する" "$GOUT" "Roll back 0077 first"
vfy_chk "拒否後: v4は残り、v3は閉じたまま、v4で保存でき、データは不変（保存できなくなる事態にならない）" "$(qn $DBc "select (to_regprocedure('public.save_stylist_profile_v4(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[],date,text,text,date,integer,text)') is not null)::text||(select count(*) from information_schema.columns where table_name='stylist_profiles' and column_name like 'blank_period%')::text||(select md5(string_agg(to_jsonb(sp)::text, ',' order by user_id)) from public.stylist_profiles sp)")|$(okid "$(v4 $DBc $S4 保存可 experienced)")" "true2$GB|1"
GB2=$(qn $DBc "select md5(string_agg(to_jsonb(sp)::text, ',' order by user_id)) from public.stylist_profiles sp")
vfy_has "ブランク期間などほかの中止条件があっても、先に実行順のガードで拒否される（0077を先に戻す案内）" "$(v4 $DBc $S3 先S3 blank null 6 months >/dev/null; psql -X -Atq -d $DBc -f "$R76" 2>&1)" "Roll back 0077 first"
ap $DBc "$R77"   # 先に0077を巻き戻す（v3の実行権が戻る）。以降は0076の巻き戻しの通常の判定を確認する
v4 $DBc $S3 戻しS3 blank null 6 months >/dev/null; SB=$(qn $DBc "select md5(string_agg(to_jsonb(sp)::text, ',' order by user_id)) from public.stylist_profiles sp")
vfy_has "ブランク期間が保存されていると、巻き戻しは中止される" "$(psql -X -Atq -d $DBc -f "$R76" 2>&1)" "rollback aborted"
vfy_chk "中止後、データは何も削除・変更されない" "$(qn $DBc "select md5(string_agg(to_jsonb(sp)::text, ',' order by user_id)) from public.stylist_profiles sp")" "$SB"
v4 $DBc $S2 戻しS2 new_graduate ${NY}-03-01 >/dev/null
vfy_has "新卒で卒業の区分が空の行があると、巻き戻しは中止される（区分を補わない）" "$(qn $DBc "update public.stylist_profiles set blank_period_value=null, blank_period_unit=null where user_id='$S3'" >/dev/null; psql -X -Atq -d $DBc -f "$R76" 2>&1)" "no graduation kind"
qn $DBc "update public.stylist_profiles set career_phase='experienced', graduation_ym=null where user_id='$S2'" >/dev/null
vfy_chk "新データが無ければ巻き戻せる: v4・列が消え、v3での保存が元の仕様で動く" "$(psql -X -q -v ON_ERROR_STOP=1 -d $DBc -f "$R76" >/dev/null 2>&1; qn $DBc "select (to_regprocedure('public.save_stylist_profile_v4(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[],date,text,text,date,integer,text)') is null)::text||(select count(*) from information_schema.columns where table_name='stylist_profiles' and column_name like 'blank_period%')::text")|$(okid "$(v3 $DBc $S2 元仕様 new_graduate ${NY}-03-01 planned)")" "true0|1"
vfy_exit
