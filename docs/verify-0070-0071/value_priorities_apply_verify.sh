#!/bin/bash
# 「診断結果の大切にしたい働き方をプロフィールへ反映」を、実DB（ローカル・使い捨て）の既存の保存関数で確認する。
# 確認: アプリが作る保存パラメータ（保存済みの値をそのまま渡し value_priorities だけ差し替える）で保存したとき、
#       ・value_priorities だけが変わる（公開範囲・経験年数・SNS・受信設定・生年月日・表示方法・氏名など他の項目は不変）
#       ・本人（authenticated）の権限だけで保存できる（権限は増やさない）  ・DBの既存ルール（3つ・重複禁止）が効く
D=$(cd "$(dirname "$0")" && pwd); R=$(cd "$D/../.." && pwd)
. "$D/verify_common.sh"
vfy_preflight 0070_stylist_profile_public.draft.sql 0070_fixture.sql stub_supabase.sql
vfy_ensure_template
PFX=vfy_vp_$$_; trap 'vdb_drop ${PFX}a; rm -rf "$VFY_TMPD"' EXIT
S1=00000000-0000-0000-0000-000000000001
qn() { psql -X -Atq -d "$1" -c "$2" 2>&1; }
asu() { psql -X -Atq -d "$1" -c "set role authenticated; select set_config('request.jwt.claim.sub','$S1',false); $2" 2>&1; }
DB=${PFX}a; vfy_build_0070_fixture $DB
asu $DB "select public.save_stylist_profile_v2('さくら','山田 花子','30_34','female','東京都','渋谷',0,'スタイリスト','{カット,カラー}','full_time','active',null,'[{\"platform\":\"instagram\",\"handle\":\"sakura\"},{\"platform\":\"x\",\"handle\":\"s\"}]','自己紹介','PRIVATE',false,null,'{work_life,growth,income}','1990-04-01','decade')" >/dev/null
tables() { qn $DB "select json_build_object('stylist_profiles',(select to_jsonb(sp) from public.stylist_profiles sp where user_id='$S1'),'stylist_private',(select to_jsonb(s) from public.stylist_private s where user_id='$S1'),'profiles',(select to_jsonb(p) from public.profiles p where id='$S1'),'user_settings',(select to_jsonb(u) from public.user_settings u where user_id='$S1'))"; }
# 比較用: value_priorities と更新日時・版（profile_version は保存のたびに進む＝通常のプロフィール保存と同じ）を除いた全項目
rest() { qn $DB "select (to_jsonb(sp) - 'value_priorities' - 'updated_at' - 'profile_version')::text || (to_jsonb(s) - 'updated_at')::text || (select (to_jsonb(p) - 'updated_at' - 'profile_version')::text from public.profiles p where id='$S1') || (select (to_jsonb(u) - 'updated_at')::text from public.user_settings u where user_id='$S1') from public.stylist_profiles sp, public.stylist_private s where sp.user_id='$S1' and s.user_id='$S1'"; }
vp() { qn $DB "select array_to_string(value_priorities,',') from public.stylist_profiles where user_id='$S1'"; }
cd "$R"
tables > "$VFY_TMPD/t.json"; BEFORE=$(rest); VP0=$(vp)
SQL=$(npx tsx docs/verify-0070-0071/value_priorities_params.ts "$VFY_TMPD/t.json" "teamwork,independence,culture_fit") || { echo "FAIL: パラメータの生成"; exit 1; }
OUT=$(asu $DB "$SQL"); [ -n "$OUT" ] && echo "(出力: $OUT)" | head -3
vfy_chk "反映前の値は保存時のまま" "$VP0" "work_life,growth,income"
vfy_chk "反映後: value_priorities が診断の3つ（選んだ順）に変わる" "$(vp)" "teamwork,independence,culture_fit"
vfy_chk "反映後: value_priorities 以外の全項目（公開範囲・経験年数0・SNS・受信設定・生年月日・表示方法・氏名・画像）が不変" "$(rest)" "$BEFORE"
# DBの既存ルール。3つ未満はDBが拒否する。重複はDBは拒否しない（通常のプロフィール保存と同じで、アプリ側の検証で拒否。tests/apply-diagnosis-values.test.ts で確認）
tables > "$VFY_TMPD/t.json"; BEFORE2=$(rest)
BAD2=$(npx tsx docs/verify-0070-0071/value_priorities_params.ts "$VFY_TMPD/t.json" "teamwork,independence")
vfy_has "3つ未満はDBも拒否する（既存ルール）" "$(asu $DB "$BAD2")" "value_priorities"
vfy_chk "拒否されたあとも保存済みの内容は変わらない" "$(vp)|$(rest)" "teamwork,independence,culture_fit|$BEFORE2"
vfy_exit
