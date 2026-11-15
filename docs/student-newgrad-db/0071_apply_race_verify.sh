#!/bin/bash
# 0071 適用の最中に診断の保存が進行中でも、「現在の診断」の初期登録から漏れないことの検証（ローカル専用・使い捨てDBのみ）。
# 保存を開いたまま保持 → 0071 適用を開始 → 適用側が結果表のロック待ちになったことを確認 → 保存確定後に適用が完了、を確認する。
# 環境変数 VFY_MUTATE=nolock: 0071本体の「結果表を先にロックする」行を除いた版で実行（検証が失敗を検出できることの確認用）。
D=$(cd "$(dirname "$0")" && pwd)
. "$(for c in "$D" "$D/../verify-0070-0071"; do [ -f "$c/verify_common.sh" ] && echo "$c/verify_common.sh" && break; done)" 2>/dev/null || { echo "ERROR: verify_common.sh が見つかりません（同じディレクトリに置いてください）" >&2; exit 2; }
vfy_preflight 0058_diagnosis_change_limits.draft.sql 0070_stylist_profile_public.draft.sql 0071_student_newgrad.draft.sql stub_supabase.sql
vfy_ensure_template
DB=vfy_race_$$; trap 'vdb_drop $DB; rm -rf "$VFY_TMPD"' EXIT
vfy_build_chain $DB 0070
U=00000000-0000-0000-0000-0000000aa001
psql -X -q -v ON_ERROR_STOP=1 -d $DB -c "insert into auth.users (id,email) values ('$U','race@t'); insert into public.profiles (id,role) values ('$U','stylist') on conflict do nothing;" >/dev/null || vfy_die "準備に失敗"
APPLY=$(ffind 0071_student_newgrad.draft.sql)
if [ "${VFY_MUTATE:-}" = "nolock" ]; then sed 's/^lock table public.diagnosis_results in share row exclusive mode;/-- (mutation) no lock/' "$APPLY" > "$VFY_TMPD/0071_nolock.sql"; APPLY="$VFY_TMPD/0071_nolock.sql"; echo "(変異: 結果表のロックを除去)"; fi
vfy_bg save psql -X -q -v ON_ERROR_STOP=1 -d $DB -c "begin; set local role service_role; select public.commit_diagnosis_result('$U', gen_random_uuid(), true, '1.0.0', 'stylist', '[4,4]'::jsonb, 50::smallint,50::smallint,50::smallint,50::smallint,50::smallint,50::smallint,'T1','x',50::smallint,'300-350')->>'action'; reset role; select pg_sleep(5); commit;"
vfy_expect_held $DB "pg_sleep(5)" "保存側"
vfy_bg apply psql -X -q -v ON_ERROR_STOP=1 -d $DB -f "$APPLY"
vfy_expect_blocked $DB "lock table public.diagnosis_results" "0071適用が進行中の保存を待つ"
vfy_join save apply
vfy_chk "保存・適用とも成功" "$(vfy_rc save)$(vfy_rc apply)" "00"
R=$(psql -X -Atq -d $DB -c "select (select count(*) from public.diagnosis_results where user_id='$U')||'|'||coalesce((select seq::text from public.stylist_diagnosis_current where user_id='$U'),'無')||'|'||coalesce((select bank from public.stylist_diagnosis_current where user_id='$U'),'無')" 2>&1)
vfy_chk "適用中に保存された診断が、現在の診断（経験者・連番1）として登録されている" "$R" "1|1|experienced"
# 適用後の保存は新しい関数・トリガーで処理される（学生への切替＝変更1回）
out=$(psql -X -Atq -d $DB -c "set role service_role; select public.commit_student_diagnosis('$U', gen_random_uuid(), 'v', jsonb_build_object('q1','a','q2','a','q3','a','q4','a','q5','a','q6','a','q7','a','q9','a','q10','a','q11','a','q12','a','q13','a','q14','a'), '{}'::jsonb)->>'action'" 2>&1 | tail -1)
vfy_chk "適用後: 学生診断への切替は変更1回" "$out" "change"
vfy_exit
