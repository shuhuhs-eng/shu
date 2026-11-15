#!/bin/bash
# 0059（旧経路の権限整理）のローカル検証（使い捨てDBのみ・本番には接続しない）。
# 使い方: su postgres -c "bash 0059_verify.sh"
# 前提・DBの扱いは ../verify-0070-0071/verify_common.sh と同じ（0001〜0061のmigration＋0058草案から使い捨てDBを作る）。
D=$(cd "$(dirname "$0")" && pwd)
. "$D/../verify-0070-0071/verify_common.sh"
vfy_preflight 0058_diagnosis_change_limits.draft.sql 0059_close_direct_paths.draft.sql 0059_preapply_check.sql 0059_postapply_check.sql 0059_rollback_permissions.sql 0059_salon_path_check.sql 0059_extra5_path_check.sql stub_supabase.sql
vfy_ensure_template
PFX=vfy_59_$$_; trap 'for x in a b c d e; do vdb_drop ${PFX}$x; done; rm -f "$VFY_ERR"' EXIT
F0058=$(ffind 0058_diagnosis_change_limits.draft.sql); BODY=$(ffind 0059_close_direct_paths.draft.sql)
PRE=$(ffind 0059_preapply_check.sql); POST=$(ffind 0059_postapply_check.sql); RB=$(ffind 0059_rollback_permissions.sql)
U=00000000-0000-0000-0000-00000000d001
mk() { vdb_create "$1" "$VFY_TPL"; [ "${2:-58}" = 58 ] && { vpsql -d "$1" -f "$F0058" >/dev/null 2>&1 || vfy_die "0058適用失敗"; }; }
q() { psql -X -Atq -d "$1" -c "$2" 2>&1; }
verdict() { psql -X -Atq -F'|' -d "$1" -f "$2" 2>&1 | grep -E '^99\|' | cut -d'|' -f2; }
fails() { psql -X -Atq -F'|' -d "$1" -f "$2" 2>&1 | grep -E '\|FAIL\|' | cut -d'|' -f1 | grep -v '^99$' | tr '\n' ','; }
fp() { q "$1" "select (select md5(string_agg(id::text||kind||change_count::text||coalesce(last_change_at::text,'-')||coalesce(locked_until::text,'-'),',' order by id)) from diagnosis_change_limits)||'/'||(select count(*) from diagnosis_results)"; }
INS="insert into diagnosis_results (user_id, diagnosis_version, mode, answers, craft_score, sense_score, hospitality_score, brand_score, drive_score, mentor_score, type_id, type_name, market_value_score, salary_band) values ('$U','v',  'stylist','{\"z\":9}',1,1,1,1,1,1,'t','n',50,'a')"
seed() { psql -X -q -d "$1" -c "insert into auth.users (id,email) values ('$U','p@t'); update public.profiles set role='stylist' where id='$U'; insert into diagnosis_results (user_id, diagnosis_version, mode, answers, craft_score, sense_score, hospitality_score, brand_score, drive_score, mentor_score, type_id, type_name, market_value_score, salary_band) values ('$U','v','stylist','{}',1,1,1,1,1,1,'t','n',50,'a');" >/dev/null; }

echo "== 1. 適用前チェック: 新経路の利用実績が無い・旧経路が直近に動いていれば FAIL（0059へ進まない）"
DB=${PFX}a; mk $DB; seed $DB
vfy_chk "利用実績なし → 総合判定 FAIL" "$(verdict $DB $PRE)" "FAIL"
vfy_chk "FAILは行7・8（新経路の実績なし）と行9（直近に旧経路の保存あり）" "$(fails $DB $PRE)" "7,8,9,"
# 実績を作る: 美容師=確定保存の新経路、サロン=送信ID記録（下書き→確定は 0058_verify_salon_app.sql が実行して確認する）
# 新経路の実績（result_ref あり）を作り、種まきの旧経路の記録（直接INSERT由来・result_refなし）は5時間前のものとして扱う
q $DB "insert into diagnosis_save_requests (request_id, kind, user_id, action, result_ref) values (gen_random_uuid(),'stylist','$U','initial','r1'),(gen_random_uuid(),'salon_culture_user','$U','initial','salon_culture_user')" >/dev/null
vfy_chk "旧経路の記録は直近（種まきの直接INSERT）なので、新経路の実績があっても行9で FAIL" "$(verdict $DB $PRE)/$(fails $DB $PRE)" "FAIL/9,"
q $DB "update diagnosis_save_requests set created_at = now() - interval '5 hours' where result_ref is null" >/dev/null
vfy_chk "実績あり・旧経路は3時間より前 → 総合判定 PASS" "$(verdict $DB $PRE)" "PASS"
vfy_chk "適用前は 0059 未適用の判定(行4)も PASS" "$(psql -X -Atq -F'|' -d $DB -f $PRE | grep -E '^4\|' | cut -d'|' -f2)" "PASS"

echo "== 2. 本体の適用 → 適用後チェック"
BEFORE=$(fp $DB)
OUT=$(psql -X -q -v ON_ERROR_STOP=1 -d $DB -f $BODY 2>&1); vfy_chk "本体が成功する" "$?" "0"
vfy_chk "適用後チェック 総合 PASS" "$(verdict $DB $POST)" "PASS"
vfy_chk "診断結果・変更回数・ロック日時は変わらない（指紋一致）" "$(fp $DB)" "$BEFORE"
vfy_chk "再度の適用前チェックは FAIL（行4=適用済み。再適用しない）" "$(verdict $DB $PRE)/$(fails $DB $PRE)" "FAIL/4,"
vfy_chk "旧経路: service_role の直接INSERTは権限で拒否" "$(q $DB "set role service_role; $INS" | grep -c 'permission denied')" "1"
vfy_chk "旧経路: authenticated は旧サロン保存関数を実行できない（権限エラー）" "$(q $DB "set role authenticated; select public.save_salon_culture_analysis_answers('x','{}','{}')" | grep -c 'permission denied')" "1"
vfy_chk "新経路: 確定保存（service_role）が動く（同じ回答=変更なし）" "$(q $DB "set role service_role; select (public.commit_diagnosis_result('$U'::uuid, gen_random_uuid(), true, 'v','stylist'::public.diagnosis_mode,'{}'::jsonb,1::smallint,1::smallint,1::smallint,1::smallint,1::smallint,1::smallint,'t','n',50::smallint,'a',null::uuid,null::timestamptz))->>'action'")" "unchanged"
vfy_chk "新経路: 状態取得（authenticated）が動く" "$(q $DB "set role authenticated; select set_config('request.jwt.claims','{\"sub\":\"$U\"}',false); select (public.get_diagnosis_change_status('stylist', null))::jsonb ? 'locked_until' or true" | tail -1)" "t"
vfy_chk "0058の制限は維持: 回答を変える確定は1回目だけ許される（change）" "$(q $DB "set role service_role; select (public.commit_diagnosis_result('$U'::uuid, gen_random_uuid(), true, 'v','stylist'::public.diagnosis_mode,'{\"a\":1}'::jsonb,2::smallint,1::smallint,1::smallint,1::smallint,1::smallint,1::smallint,'t','n',50::smallint,'a',null::uuid,null::timestamptz))->>'action'")" "change"
vfy_chk "0058の制限は維持: 続けて回答を変える確定は拒否される（ロック中）" "$(q $DB "set role service_role; select (public.commit_diagnosis_result('$U'::uuid, gen_random_uuid(), true, 'v','stylist'::public.diagnosis_mode,'{\"a\":2}'::jsonb,3::smallint,1::smallint,1::smallint,1::smallint,1::smallint,1::smallint,'t','n',50::smallint,'a',null::uuid,null::timestamptz))->>'action'" | grep -o 'diagnosis_change_locked' | head -1)" "diagnosis_change_locked"
vfy_chk "ロックが実際に記録された（変更回数1・ロック日時あり）" "$(q $DB "select change_count || '/' || (locked_until is not null) from diagnosis_change_limits where kind='stylist'")" "1/true"

echo "== 3. サロン側の新経路（下書き保存→確定）が0059適用後に動く"
DB=${PFX}b; mk $DB; psql -X -q -v ON_ERROR_STOP=1 -d $DB -f $BODY >/dev/null 2>&1 || vfy_die "0059適用失敗(b)"
psql -X -q -d $DB -f "$(ffind 0059_salon_path_check.sql)" > $VFY_TMPD/salon.out 2>&1
vfy_chk "0059_salon_path_check.sql: FAIL 0 / PASS 7以上" "$(grep -cE '\| *FAIL|ERROR' $VFY_TMPD/salon.out)/$([ "$(grep -cE '\| *PASS' $VFY_TMPD/salon.out)" -ge 7 ] && echo ok)" "0/ok"

echo "== 3b. 追加の5問（下書き→確定）も新経路で動き、行8の証跡（result_ref付き）が残る"
for m in 58 59; do
  DB=${PFX}c; mk $DB; [ $m = 59 ] && { psql -X -q -v ON_ERROR_STOP=1 -d $DB -f $BODY >/dev/null 2>&1 || vfy_die "0059適用失敗(c)"; }
  psql -X -q -d $DB -f "$(ffind 0059_extra5_path_check.sql)" > $VFY_TMPD/extra5.out 2>&1
  vfy_chk "0059_extra5_path_check.sql（0058のみ/0059後=$m）: FAIL 0 / PASS 6" "$(grep -cE '\| *FAIL|ERROR' $VFY_TMPD/extra5.out)/$(grep -cE '\| *PASS' $VFY_TMPD/extra5.out)" "0/6"
  vdb_drop $DB
done

echo "== 4. 本体の安全装置（何も変えずに止まる）"
DB=${PFX}d; mk $DB 0; seed $DB
OUT=$(psql -X -q -v ON_ERROR_STOP=1 -d $DB -f $BODY 2>&1); vfy_chk "0058未適用では本体が中止（非ゼロ）" "$([ $? -ne 0 ] && echo stop)" "stop"
vfy_chk "中止の理由が表示される" "$(echo "$OUT" | grep -c '0059を中止')" "1"
vfy_chk "中止後も権限は変わらない（service_roleのINSERT権限が残る）" "$(q $DB "select has_table_privilege('service_role','public.diagnosis_results','insert')")" "t"
DB=${PFX}e; mk $DB; q $DB "grant execute on function public.save_salon_culture_analysis_answers(text,jsonb,jsonb) to public" >/dev/null
vfy_chk "PUBLIC付与が残っていると適用前チェックの行5が FAIL" "$(fails $DB $PRE | grep -o '5,')" "5,"
OUT=$(psql -X -q -v ON_ERROR_STOP=1 -d $DB -f $BODY 2>&1); vfy_chk "PUBLIC付与が残る場合、本体は自己検証で取り消される（非ゼロ）" "$([ $? -ne 0 ] && echo stop)" "stop"
vfy_chk "取り消し後は何も変わらない（service_roleのINSERT権限も残る＝途中までの変更なし）" "$(q $DB "select has_table_privilege('service_role','public.diagnosis_results','insert')")" "t"

echo "== 5. 適用後チェックが壊れた状態を検出する"
DB=${PFX}a   # 1〜2で本体適用済み
q $DB "grant execute on function public.save_salon_culture_profile(public.salon_culture_status,public.salon_culture_respondent_role,integer,jsonb,text[],text) to authenticated" >/dev/null
vfy_chk "旧関数が1つ開いている → FAIL（行3）" "$(verdict $DB $POST)/$(fails $DB $POST)" "FAIL/3,"
q $DB "revoke execute on function public.save_salon_culture_profile(public.salon_culture_status,public.salon_culture_respondent_role,integer,jsonb,text[],text) from authenticated; revoke execute on function public.confirm_salon_culture_diagnosis(uuid,uuid,integer) from authenticated" >/dev/null
vfy_chk "新経路の権限（確定）が欠けている → FAIL（行5）" "$(verdict $DB $POST)/$(fails $DB $POST)" "FAIL/5,"
q $DB "grant execute on function public.confirm_salon_culture_diagnosis(uuid,uuid,integer) to authenticated; alter table public.diagnosis_results disable trigger trg_diagnosis_results_limit" >/dev/null
vfy_chk "0058の制限トリガーが無効 → FAIL（行7）" "$(verdict $DB $POST)/$(fails $DB $POST)" "FAIL/7,"
q $DB "alter table public.diagnosis_results enable trigger trg_diagnosis_results_limit" >/dev/null
vfy_chk "元に戻すと総合 PASS" "$(verdict $DB $POST)" "PASS"

echo "== 6. 0059だけを戻す手順"
BEFORE=$(fp $DB)
psql -X -q -v ON_ERROR_STOP=1 -d $DB -f $RB >/dev/null 2>&1; vfy_chk "実行できる" "$?" "0"
vfy_chk "結果表の総合判定 PASS" "$(verdict $DB $RB | tail -1)" "PASS"
vfy_chk "戻した直後も、0058の制限は有効（直接INSERTは制限トリガーが拒否: 初回保存済みで2件目は拒否される）" "$(q $DB "set role service_role; $INS" | grep -c 'diagnosis_change_locked')" "1"
vfy_chk "診断結果・変更回数・ロック日時は変わらない" "$(fp $DB)" "$BEFORE"
vfy_chk "旧経路が復旧: authenticated が旧サロン保存関数を実行できる（権限エラーにならない）" "$(q $DB "set role authenticated; select set_config('request.jwt.claims','{\"sub\":\"$U\"}',false); select public.save_salon_culture_analysis_answers('x','{}','{}')" | grep -c 'permission denied')" "0"
psql -X -q -v ON_ERROR_STOP=1 -d $DB -f $RB >/dev/null 2>&1; vfy_chk "2回実行しても同じ（冪等）" "$(verdict $DB $RB | tail -1)" "PASS"
psql -X -q -v ON_ERROR_STOP=1 -d $DB -f $BODY >/dev/null 2>&1; vfy_chk "戻したあとに0059を再適用できる" "$(verdict $DB $POST)" "PASS"
vfy_exit
