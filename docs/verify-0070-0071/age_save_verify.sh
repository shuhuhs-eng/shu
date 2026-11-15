#!/bin/bash
# 生年月日・表示方法・プロフィールの一括保存（save_stylist_profile_v2）の検証（ローカル専用・使い捨てDBのみ）。
#  (a) 途中で失敗したら、生年月日・表示方法・公開設定・プロフィールが全て保存前のまま
#  (b) 表示方法の未選択・不正値、生年月日の欠落はDBが拒否（旧保存関数の直接呼び出しも拒否）
#  (c) 0070を適用していないDBでは、従来の保存関数がそのまま使える（v2は存在しない）
D=$(cd "$(dirname "$0")" && pwd)
. "$D/verify_common.sh"
vfy_preflight 0070_stylist_profile_public.draft.sql 0070_fixture.sql stub_supabase.sql
vfy_ensure_template
PFX=vfy_sv_$$_; trap 'for x in a b; do vdb_drop ${PFX}$x; done; rm -rf "$VFY_TMPD"' EXIT
S1=00000000-0000-0000-0000-000000000001
qn() { psql -X -Atq -d "$1" -c "$2" 2>&1; }
# 本人(S1)として実行
asu() { psql -X -Atq -d "$1" -c "set role authenticated; select set_config('request.jwt.claim.sub','$S1',false); $2" 2>&1; }
V2ARGS="'新名','新氏名','30_34','female','東京都',null,6,'スタイリスト','{カット}','full_time','active',null,'[]','新bio','PRIVATE',true,AVATAR,'{work_life,growth,income}'"
v2() { echo "select public.save_stylist_profile_v2(${V2ARGS/AVATAR/$2}, $3, $4)"; }
state() { qn "$1" "select coalesce(to_char(sp.birth_date,'YYYY-MM-DD'),'null')||'/'||coalesce(sp.age_display_mode,'null')||'/'||p.visibility||'/'||p.public_name from public.stylist_private sp join public.stylist_profiles p using (user_id) where user_id='$S1'"; }

echo "== (a) 途中で失敗したら全て取り消される"
DB=${PFX}a; vfy_build_0070_fixture $DB
qn $DB "insert into public.stylist_private(user_id,birth_date,age_display_mode) values ('$S1','1990-04-01','decade') on conflict (user_id) do update set birth_date='1990-04-01', age_display_mode='decade'; update public.stylist_profiles set visibility='PUBLIC' where user_id='$S1'" >/dev/null
BEFORE=$(state $DB); vfy_has "準備: 変更前は 1990-04-01 / decade / PUBLIC" "$BEFORE" "^1990-04-01/decade/PUBLIC/"
# 「年代表示・公開」→「実年齢表示・非公開」に変える保存が、プロフィール保存の途中で失敗するケース
OUT=$(asu $DB "$(v2 $DB "'$S1/nofile.webp'" "'1985-01-01'" "'exact'")")
vfy_has "他人/存在しない画像パスでプロフィール保存が失敗する（先に生年月日・表示方法の更新が走った後の失敗）" "$OUT" "avatar"
vfy_chk "失敗後も生年月日・表示方法・公開設定・公開名は保存前のまま" "$(state $DB)" "$BEFORE"
# さらに遅い段階（プロフィール行の更新後）で失敗させる: user_settings への書き込みを一時的に失敗させる（検証専用）
qn $DB "create function public._vfy_fail() returns trigger language plpgsql as \$f\$ begin raise exception 'vfy_forced_failure'; end \$f\$; create trigger vfy_fail before insert or update on public.user_settings for each row execute function public._vfy_fail()" >/dev/null
OUT=$(asu $DB "$(v2 $DB null "'1985-01-01'" "'exact'")")
vfy_has "プロフィール行の更新後に失敗する" "$OUT" "vfy_forced_failure"
vfy_chk "この場合も全て保存前のまま（実年齢表示だけが公開のまま残らない）" "$(state $DB)" "$BEFORE"
qn $DB "drop trigger vfy_fail on public.user_settings; drop function public._vfy_fail()" >/dev/null
OUT=$(asu $DB "$(v2 $DB null "'1985-01-01'" "'exact'")")
vfy_chk "対照: 失敗要因がなければ、同じ呼び出しで3つが一緒に更新される" "$(state $DB)" "1985-01-01/exact/PRIVATE/新名"

echo "== (b) 表示方法の未選択・欠落はDBが拒否する"
qn $DB "update public.stylist_private set age_display_mode='decade', birth_date='1990-04-01' where user_id='$S1'; update public.stylist_profiles set visibility='PUBLIC', public_name='元名' where user_id='$S1'" >/dev/null
BEFORE=$(state $DB)
vfy_has "v2: 表示方法がNULLなら拒否" "$(asu $DB "$(v2 $DB null "'1985-01-01'" "null::text")")" "age_display_mode_required"
vfy_has "v2: 表示方法が不正値なら拒否" "$(asu $DB "$(v2 $DB null "'1985-01-01'" "'both'")")" "age_display_mode_required"
vfy_has "v2: 表示方法が空文字なら拒否" "$(asu $DB "$(v2 $DB null "'1985-01-01'" "''")")" "age_display_mode_required"
vfy_has "v2: 生年月日がNULLなら拒否" "$(asu $DB "$(v2 $DB null "null::date" "'exact'")")" "birth_date_required"
vfy_chk "拒否された保存では何も変わらない" "$(state $DB)" "$BEFORE"
# 表示方法が未選択の会員（0070適用前から居る人）: 旧保存関数を直接呼んでも、プロフィールは保存されない
qn $DB "alter table public.stylist_private disable trigger user; update public.stylist_private set age_display_mode=null where user_id='$S1'; alter table public.stylist_private enable trigger user" >/dev/null
vfy_chk "準備: 表示方法が未選択の状態" "$(qn $DB "select age_display_mode is null from public.stylist_private where user_id='$S1'")" "t"
LEG="select public.save_stylist_profile('直接','氏名','30_34','female','東京都',null,5,'スタイリスト','{カット}','full_time','active',null,'[]','b','PUBLIC',true,null,'{work_life,growth,income}')"
vfy_has "旧保存関数を直接呼んでも、表示方法が未選択なら拒否" "$(asu $DB "$LEG")" "age_display_mode_required"
vfy_chk "プロフィール名は変わらない" "$(qn $DB "select public_name from public.stylist_profiles where user_id='$S1'")" "元名"

echo "== (c) 0070未適用のDBでは従来の保存がそのまま動く"
DB=${PFX}b; vdb_create $DB "$VFY_TPL"
vpsql -d $DB -f "$(ffind 0070_fixture.sql)" >/dev/null || vfy_die "fixture 失敗"
vfy_chk "準備: 0070未適用（age_display_mode列・v2が無い）" "$(qn $DB "select (select count(*) from information_schema.columns where table_name='stylist_private' and column_name='age_display_mode')||'/'||(select count(*) from pg_proc where proname='save_stylist_profile_v2')")" "0/0"
OUT=$(asu $DB "$(echo "$LEG" | sed "s/'直接'/'従来保存'/")")
vfy_chk "従来の save_stylist_profile が成功する" "$(qn $DB "select public_name from public.stylist_profiles where user_id='$S1'")" "従来保存"
vfy_has "v2 は存在しない（アプリはPGRST202相当で判別できる）" "$(asu $DB "$(v2 $DB null "'1985-01-01'" "'exact'")")" "save_stylist_profile_v2"
vfy_exit
