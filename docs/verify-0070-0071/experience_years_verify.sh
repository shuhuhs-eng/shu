#!/bin/bash
# 経験年数（stylist_profiles.experience_years）の NULL / 0 の扱いを、DBの保存関数で確認する（ローカル専用・使い捨てDBのみ）。
# 目的: 「空欄＝未登録(NULL)」と「0年」をDBが区別して保存できるか（アプリの修正案が、DB変更なしで成立するかの確認）。
D=$(cd "$(dirname "$0")" && pwd)
. "$D/verify_common.sh"
vfy_preflight 0070_stylist_profile_public.draft.sql 0070_fixture.sql stub_supabase.sql
vfy_ensure_template
PFX=vfy_ey_$$_; trap 'vdb_drop ${PFX}a; rm -rf "$VFY_TMPD"' EXIT
S1=00000000-0000-0000-0000-000000000001
qn() { psql -X -Atq -d "$1" -c "$2" 2>&1; }
asu() { psql -X -Atq -d "$1" -c "set role authenticated; select set_config('request.jwt.claim.sub','$S1',false); $2" 2>&1; }
save() { echo "select public.save_stylist_profile_v2('新名','新氏名','30_34','female','東京都',null,$1,'スタイリスト','{カット}','full_time','active',null,'[]','新bio','PRIVATE',true,null,'{work_life,growth,income}','1990-04-01','exact')"; }
DB=${PFX}a; vfy_build_0070_fixture $DB
val() { qn $DB "select coalesce(experience_years::text,'NULL') from public.stylist_profiles where user_id='$S1'"; }
asu $DB "$(save null)" >/dev/null; vfy_chk "保存関数に NULL を渡すと NULL（未登録）のまま保存される" "$(val)" "NULL"
asu $DB "$(save 0)" >/dev/null;    vfy_chk "0 を渡すと 0（0年）として保存される（NULLと区別できる）" "$(val)" "0"
asu $DB "$(save 5)" >/dev/null;    vfy_chk "5 を渡すと 5" "$(val)" "5"
asu $DB "$(save null)" >/dev/null; vfy_chk "5のあとに NULL を渡すと NULL に戻せる（本人が空にした場合）" "$(val)" "NULL"
vfy_has "範囲外(61)はDBが拒否する" "$(asu $DB "$(save 61)")" "experience_years"
vfy_exit
