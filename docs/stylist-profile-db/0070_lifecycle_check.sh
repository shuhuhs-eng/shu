#!/bin/bash
# 0070 の 巻き戻し（安全装置）／停止（データを残す）／給与提示の再開 の手順確認。ローカル専用（使い捨てDBのみ）。
# 1件でも失敗すれば非ゼロで終了する。前提は verify_common.sh の冒頭を参照。
D=$(cd "$(dirname "$0")" && pwd)
. "$(for c in "$D" "$D/../verify-0070-0071"; do [ -f "$c/verify_common.sh" ] && echo "$c/verify_common.sh" && break; done)" 2>/dev/null || { echo "ERROR: verify_common.sh が見つかりません（同じディレクトリに置いてください）" >&2; exit 2; }
vfy_preflight 0070_fixture.sql 0070_stylist_profile_public.draft.sql 0070_rollback.draft.sql 0070_suspend_keep_data.sql 0070_public_extended_resume.sql 0070_salary_offer_resume.sql 0070_salary_offer_pause.sql 0070_postapply_check.sql 0070_preapply_check.sql stub_supabase.sql
vfy_ensure_template
PFX=vfy_l_$$_
trap 'for x in l1 l2 l2b l3 l3b l4 l5 l6 l7 l8 l9; do vdb_drop ${PFX}$x; done' EXIT
S1=00000000-0000-0000-0000-000000000001; S4=00000000-0000-0000-0000-000000000004
q() { psql -X -Atq -d "$1" -c "$2" 2>&1; }
# Supabase の SQL エディタと同じく、ファイル全文を1つのクエリとして送る（psql の \ コマンドは効かない）。
run() { psql -X -q -d "$1" -c "$(cat "$(ffind "$2")")" 2>&1; }
fresh() { # 使い捨てDB: テンプレート + fixture + 0070 適用
  vdb_create "$1" "$VFY_TPL"
  vpsql -d "$1" -f "$(ffind 0070_fixture.sql)" >/dev/null || vfy_die "fixture 失敗: $1"
  vpsql -d "$1" -f "$(ffind 0070_stylist_profile_public.draft.sql)" >/dev/null 2>&1 || vfy_die "0070 適用失敗: $1"
}
chk() { vfy_chk "$@"; }
has() { vfy_has "$@"; }
P() { bash -c "$1" || { echo "FAIL  準備処理の失敗: ${1:0:100}"; VFY_FAIL=$((VFY_FAIL+1)); }; }

for f in 0070_rollback.draft.sql 0070_suspend_keep_data.sql 0070_public_extended_resume.sql 0070_salary_offer_resume.sql 0070_salary_offer_pause.sql 0070_stylist_profile_public.draft.sql 0070_preapply_check.sql 0070_postapply_check.sql; do
  chk "SQLエディタ実行可: $f に psql の \\ コマンドが無い" "$(grep -c '^[[:space:]]*\\\\' $(ffind $f))" "0"
done

# R1: 生年月日が登録されている → 巻き戻しは何も変更せず中止
fresh ${PFX}l1; q ${PFX}l1 "select set_config('request.jwt.claim.sub','$S1',false)" >/dev/null
P "psql -X -v ON_ERROR_STOP=1 -d ${PFX}l1 -X -q -c \"update stylist_private set birth_date='1995-06-15' where user_id='$S1'\"" >/dev/null
out=$(run ${PFX}l1 0070_rollback.draft.sql)
has "R1 生年月日あり: 巻き戻しは中止メッセージを出す" "$out" "巻き戻しを中止: 生年月日が 1 件"
chk "R1 列も値も残っている" "$(q ${PFX}l1 "select count(*) from stylist_private where birth_date is not null")" "1"
chk "R1 スカウト設定は移行後のまま(true)" "$(q ${PFX}l1 "select scout_enabled from user_settings where user_id='$S4'")" "t"
chk "R1 退避表も残っている" "$(q ${PFX}l1 "select count(*) from scout_optout_migration_0070")" "2"

# R2: 移行後にスカウト設定が変更されている → 中止（本人の変更を上書きしない）
fresh ${PFX}l2
P "psql -X -v ON_ERROR_STOP=1 -d ${PFX}l2 -X -q -c \"update user_settings set scout_enabled=false where user_id='$S4'\"" >/dev/null
out=$(run ${PFX}l2 0070_rollback.draft.sql)
has "R2 移行後に設定変更あり: 巻き戻しは中止" "$out" "巻き戻しを中止: 移行したスカウト設定のうち 1 件"
chk "R2 本人の変更(false)は上書きされていない・他は変更なし" "$(q ${PFX}l2 "select count(*) from user_settings where scout_enabled=false and user_id in ('$S4','00000000-0000-0000-0000-000000000005')")" "1"
chk "R2 birth_date列は残っている" "$(q ${PFX}l2 "select count(*) from information_schema.columns where table_name='stylist_private' and column_name='birth_date'")" "1"
# R2b: メール設定を変えただけでも（updated_atが進むため）中止
fresh ${PFX}l2b
P "psql -X -v ON_ERROR_STOP=1 -d ${PFX}l2b -X -q -c \"update user_settings set notify_email=true where user_id='$S4'\"" >/dev/null
out=$(run ${PFX}l2b 0070_rollback.draft.sql)
has "R2b 移行後に別の設定変更でも中止（安全側）" "$out" "巻き戻しを中止"

# R3: 何も使われていなければ巻き戻せる。ただし給与提示の停止は外さない
fresh ${PFX}l3
out=$(run ${PFX}l3 0070_rollback.draft.sql)
chk "R3 エラーなしで完了" "$(echo "$out" | grep -c 'ERROR')" "0"
chk "R3 birth_date列が無い" "$(q ${PFX}l3 "select count(*) from information_schema.columns where table_name='stylist_private' and column_name='birth_date'")" "0"
chk "R3 スカウト設定が移行前へ復元(s4,s5=false)" "$(q ${PFX}l3 "select count(*) from user_settings where scout_enabled=false and user_id in ('$S4','00000000-0000-0000-0000-000000000005')")" "2"
chk "R3 退避表が無い" "$(q ${PFX}l3 "select coalesce(to_regclass('public.scout_optout_migration_0070')::text,'なし')")" "なし"
chk "R3 給与提示の停止（フラグ=停止・トリガー）は残っている" "$(q ${PFX}l3 "select (select paused from feature_pauses where feature='salary_offer_presentation')::text||'/'||(select count(*) from pg_trigger where tgname='trg_salary_offers_00_pause')")" "true/1"
chk "R3 既存の給与提示は保持" "$(q ${PFX}l3 "select count(*) from salary_offers")" "1"
chk "R3 追加表示の関数・フラグ行も無い" "$(q ${PFX}l3 "select (select count(*) from pg_proc where proname in ('stylist_public_extended_enabled','get_stylist_public_extended_enabled'))||'/'||(select count(*) from feature_pauses where feature='stylist_public_extended')")" "0/0"
chk "R3 一覧関数は0025の定義（avatar_pathなし）" "$(q ${PFX}l3 "select (pg_get_functiondef(p.oid) not like '%avatar_path%')::text from pg_proc p where p.proname='get_public_stylists_for_scout'")" "true"

chk "R3 公開判定の関数と未成年フラグも無い" "$(q ${PFX}l3 "select (select count(*) from pg_proc where proname='stylist_salon_publishable')||'/'||(select count(*) from feature_pauses where feature='minor_salon_public')")" "0/0"
chk "R3 一覧関数に公開判定が残っていない（0025の定義）" "$(q ${PFX}l3 "select (pg_get_functiondef(p.oid) not like '%stylist_salon_publishable%')::text from pg_proc p where p.proname='get_public_stylists_for_scout'")" "true"

chk "R3 開示依頼の関数・表・トリガー・列も無い" "$(q ${PFX}l3 "select (select count(*) from pg_proc where proname in ('request_stylist_age_disclosure','respond_age_disclosure_request','get_my_age_disclosure_requests','get_store_stylist_age_infos','set_stylist_age_display_mode','save_stylist_profile_v2','_stylist_age_info','_trg_scouts_publishable_guard','_trg_stylist_profiles_birth_required','_trg_stylist_private_birth_guard'))||'/'||(select count(*) from pg_class where relname='age_disclosure_requests')||'/'||(select count(*) from pg_trigger where tgname in ('trg_scouts_publishable_guard','trg_stylist_profiles_birth_required','trg_stylist_private_birth_guard'))||'/'||(select count(*) from information_schema.columns where table_name='stylist_private' and column_name='age_display_mode')")" "0/0/0/0"
chk "R3 通知の種類は元の17種へ戻る" "$(q ${PFX}l3 "select (pg_get_constraintdef(oid) not like '%age_disclosure%' and pg_get_constraintdef(oid) like '%hiring_declined_by_stylist%')::text from pg_constraint where conname='notifications_type_check'")" "true"
chk "R3 引数なしの一覧関数が戻り、(uuid)版は無い" "$(q ${PFX}l3 "select (select count(*) from pg_proc where proname='get_public_stylists_for_scout')||'/'||(select pronargs from pg_proc where proname='get_public_stylists_for_scout')")" "1/0"

# R5〜R7: 新設データがあるときは、巻き戻しは何も削除せず中止（表示方法・開示依頼・通知のそれぞれ単独でも）
B0=00000000-0000-0000-0000-0000000000b0
fresh ${PFX}l7
P "psql -X -v ON_ERROR_STOP=1 -d ${PFX}l7 -q -c \"insert into stylist_private(user_id, age_display_mode) values ('$S1','exact') on conflict (user_id) do update set age_display_mode='exact'\"" >/dev/null
out=$(run ${PFX}l7 0070_rollback.draft.sql)
has "R5 表示方法の選択だけがあっても巻き戻しは中止" "$out" "年齢の表示方法が 1 件"
chk "R5 選択は残り、関数・列も残る" "$(q ${PFX}l7 "select (select count(*) from stylist_private where age_display_mode='exact')||'/'||(select count(*) from pg_proc where proname='request_stylist_age_disclosure')")" "1/1"
fresh ${PFX}l8
P "psql -X -v ON_ERROR_STOP=1 -d ${PFX}l8 -q -c \"insert into age_disclosure_requests(store_id, stylist_user_id, requested_by) values ('$B0','$S4','00000000-0000-0000-0000-000000000010')\"" >/dev/null
out=$(run ${PFX}l8 0070_rollback.draft.sql)
has "R6 開示依頼が1件でもあれば巻き戻しは中止" "$out" "実年齢の開示依頼が 1 件"
chk "R6 依頼は残る" "$(q ${PFX}l8 "select count(*) from age_disclosure_requests")" "1"
fresh ${PFX}l9
P "psql -X -v ON_ERROR_STOP=1 -d ${PFX}l9 -q -c \"insert into notifications(user_id,type,title,message,related_entity_type,related_entity_id,link_path) values ('$S4','age_disclosure_requested','t','m','age_disclosure_request',gen_random_uuid(),'/stylist/age-requests')\"" >/dev/null
out=$(run ${PFX}l9 0070_rollback.draft.sql)
has "R7 開示依頼の通知があれば巻き戻しは中止" "$out" "開示依頼の通知が 1 件"
chk "R7 通知は残る" "$(q ${PFX}l9 "select count(*) from notifications where type='age_disclosure_requested'")" "1"

# R4: 0071が適用済みなら、0070の巻き戻しは中止（先に0071を戻す）
fresh ${PFX}l3b
P "psql -X -v ON_ERROR_STOP=1 -d ${PFX}l3b -X -q -c \"alter table stylist_profiles add column career_phase text\"" >/dev/null
out=$(run ${PFX}l3b 0070_rollback.draft.sql)
has "R4 0071適用済みなら0070の巻き戻しは中止" "$out" "0071が適用されています"
chk "R4 何も変更されていない（公開判定の関数が残る）" "$(q ${PFX}l3b "select count(*) from pg_proc where proname='stylist_salon_publishable'")" "1"

# S1: 運用開始後の停止（データを残す）。追加表示のフラグだけを切り替える。
fresh ${PFX}l4
P "psql -X -v ON_ERROR_STOP=1 -d ${PFX}l4 -X -q -c \"update stylist_private set birth_date='1995-06-15' where user_id='$S1'\" -c \"update user_settings set scout_enabled=false where user_id='$S4'\"" >/dev/null
out=$(run ${PFX}l4 0070_suspend_keep_data.sql)
chk "S1 エラーなしで完了" "$(echo "$out" | grep -c 'ERROR')" "0"
chk "S1 追加表示のフラグが停止" "$(q ${PFX}l4 "select paused from feature_pauses where feature='stylist_public_extended'")" "t"
chk "S1 生年月日は残る" "$(q ${PFX}l4 "select birth_date from stylist_private where user_id='$S1'")" "1995-06-15"
chk "S1 本人が変えたスカウト設定(false)は触らない" "$(q ${PFX}l4 "select scout_enabled from user_settings where user_id='$S4'")" "f"
chk "S1 退避表は残る" "$(q ${PFX}l4 "select count(*) from scout_optout_migration_0070")" "2"
chk "S1 本人プレビュー用の判定が false（生年月日の列は残っている）" "$(q ${PFX}l4 "select stylist_public_extended_enabled()::text")" "false"
chk "S1 給与提示の停止は維持" "$(q ${PFX}l4 "select paused from feature_pauses where feature='salary_offer_presentation'")" "t"
chk "S1 本人の生年月日保存関数は残る" "$(q ${PFX}l4 "select count(*) from pg_proc where proname='set_stylist_birth_date'")" "1"
out=$(run ${PFX}l4 0070_public_extended_resume.sql)
chk "S1b 再開でフラグが有効に戻る（エラーなし）" "$(echo "$out" | grep -c 'ERROR')$(q ${PFX}l4 "select stylist_public_extended_enabled()::text")" "0true"
chk "S1b 再開しても本人が変えたスカウト設定(false)は上書きされない" "$(q ${PFX}l4 "select scout_enabled from user_settings where user_id='$S4'")" "f"

chk "S1 停止しても未成年の公開保留フラグは保留のまま" "$(q ${PFX}l4 "select paused from feature_pauses where feature='minor_salon_public'")" "t"
chk "S1b 再開しても未成年の公開保留は解除されない" "$(q ${PFX}l4 "select paused from feature_pauses where feature='minor_salon_public'")" "t"
chk "S1 停止・再開SQLは未成年の公開フラグに触れない" "$(grep -c minor_salon_public $(ffind 0070_suspend_keep_data.sql) $(ffind 0070_public_extended_resume.sql) | grep -vc ':0')" "0"
chk "S1 停止中も公開判定は動く（満16歳は保留）" "$(q ${PFX}l4 "insert into stylist_private(user_id,birth_date) values ('$S4',(current_date - interval '16 years')::date) on conflict (user_id) do update set birth_date=excluded.birth_date; select (not stylist_salon_publishable('$S4'))::text")" "true"

# S2: 給与提示の再開は、確認なしでは実行できない
fresh ${PFX}l5
out=$(run ${PFX}l5 0070_salary_offer_resume.sql)
has "S2 確認なしの再開は拒否される" "$out" "再開は未確認です"
chk "S2 停止のまま" "$(q ${PFX}l5 "select paused from feature_pauses where feature='salary_offer_presentation'")" "t"
RC=$(mktemp); sed "s#^-- select set_config#select set_config#" $(ffind 0070_salary_offer_resume.sql) > "$RC"
psql -X -q -d ${PFX}l5 -c "$(cat "$RC")" >/dev/null 2>&1
chk "S2 確認行を有効にすると再開される" "$(q ${PFX}l5 "select paused from feature_pauses where feature='salary_offer_presentation'")" "f"
psql -X -q -d ${PFX}l5 -c "$(cat "$(ffind 0070_salary_offer_pause.sql)")" >/dev/null 2>&1
chk "S2 再停止できる" "$(q ${PFX}l5 "select paused from feature_pauses where feature='salary_offer_presentation'")" "t"

# N1: 適用後チェックが、未適用のDBでは FAIL を出す（常にPASSになっていない）
vdb_create ${PFX}l6 "$VFY_TPL"
P "psql -X -v ON_ERROR_STOP=1 -d ${PFX}l6 -X -q -v ON_ERROR_STOP=1 -f $(ffind 0070_fixture.sql)" >/dev/null
out=$(P "psql -X -v ON_ERROR_STOP=1 -d ${PFX}l6 -X -Atq -f $(ffind 0070_postapply_check.sql)" 2>&1)
chk "N1 未適用DBの適用後チェックはエラーにならず結果表を出す" "$(echo "$out" | grep -c 'ERROR')" "0"
chk "N1 未適用DBの総合判定は FAIL" "$(echo "$out" | grep '^99|' | cut -d'|' -f2)" "FAIL"

vfy_exit
