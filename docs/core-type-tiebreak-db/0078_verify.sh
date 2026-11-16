#!/bin/bash
# 0078（8タイプの同点順序）のDB側の検証。ローカル・使い捨てDBのみ。本番には接続しない。
# 適用順は本番の現状と同じ 0058→0070→0059→0071→0072→0073→0074→0076→0077 のあと、0078。
# 使い方（全体）: bash docs/core-type-tiebreak-db/run_0078_verify.sh   （ケース生成→このスクリプト→TSとの突き合わせ）
# このスクリプトだけ: su postgres -c "bash docs/core-type-tiebreak-db/0078_verify.sh <作業ディレクトリ>"（作業DIRに cases.csv が必要）
D=$(cd "$(dirname "$0")" && pwd); V="$D/../verify-0070-0071"; W="${1:?作業ディレクトリ（cases.csv のある場所）}"
. "$V/verify_common.sh"
F72="$D/../profile-value-priorities-db/0072_value_priorities_save.draft.sql"; F73="$D/../career-phase-required-db/0073_career_phase_required.draft.sql"; F74="$D/../career-phase-required-db/0074_close_old_save_paths.draft.sql"
F76="$D/../career-phase-simplify-db/0076_career_phase_simplify.draft.sql"; F77="$D/../career-phase-simplify-db/0077_close_v3.draft.sql"
F78="$D/0078_core_type_tiebreak.draft.sql"; R78="$D/0078_rollback.draft.sql"
vfy_preflight 0058_diagnosis_change_limits.draft.sql 0070_stylist_profile_public.draft.sql 0070_fixture.sql 0071_student_newgrad.draft.sql 0059_close_direct_paths.draft.sql stub_supabase.sql
for f in "$F72" "$F73" "$F74" "$F76" "$F77" "$F78" "$R78" "$W/cases.csv"; do [ -f "$f" ] || vfy_die "見つかりません: $f"; done
echo "== 適用順: 0058→0070→0059→0071→0072→0073→0074→0076→0077（本番の現状）→ 0078"
vfy_ensure_template
PFX=vfy_tb78_$$_; trap 'for x in a b c d; do vdb_drop ${PFX}$x; done' EXIT
U=00000000-0000-0000-0000-0000000000
qn() { psql -X -Atq -d "$1" -c "$2" 2>&1; }
verdict() { psql -X -Atq -F'|' -d "$1" -f "$2" 2>&1 | grep -E '^99\|' | cut -d'|' -f2; }
fails() { psql -X -Atq -F'|' -d "$1" -f "$2" 2>&1 | grep -c '^[0-9]*|FAIL|'; }
ap() { vpsql -d "$1" -f "$2" >/dev/null 2>"$VFY_ERR" || { grep -v NOTICE "$VFY_ERR"|head -3 >&2; vfy_die "適用失敗 $2"; }; }
apx() { psql -X -q -d "$1" -v ON_ERROR_STOP=1 -f "$2" 2>&1 | grep -E "ERROR|aborted|already" | head -2; }   # 拒否されることの確認用（出力にエラー文が出る）
build() { local db=$1; vdb_create "$db" "$VFY_TPL"; vpsql -d "$db" -f "$(ffind 0070_fixture.sql)" >/dev/null || vfy_die fixture
  for f in 0058_diagnosis_change_limits.draft.sql 0070_stylist_profile_public.draft.sql 0059_close_direct_paths.draft.sql 0071_student_newgrad.draft.sql; do ap $db "$(ffind $f)"; done
  for f in "$F72" "$F73" "$F74" "$F76" "$F77"; do ap $db "$f"; done; }
OLDMD=319b6c1fd85ed6f22024d908a4b2bb3b; NEWMD=ae6160867fd1cb88fd2cbb61c67dcb30
fnmd() { qn $1 "select md5(prosrc) from pg_proc where proname='save_core_type_result'"; }
grants() { qn $1 "select has_function_privilege('authenticated','public.save_core_type_result(uuid)','execute')::text||has_function_privilege('anon','public.save_core_type_result(uuid)','execute')::text||has_function_privilege('public','public.save_core_type_result(uuid)','execute')::text||has_function_privilege('service_role','public.save_core_type_result(uuid)','execute')::text"; }
hh() { qn $1 "select md5(string_agg(id::text||'|'||user_id::text||'|'||diagnosis_result_id::text||'|'||top_type_code::text||'|'||second_type_code::text||'|'||score_gap::text||'|'||match_scores::text||'|'||created_at::text, ',' order by id)) from public.stylist_core_type_history"; }
# 旧関数（適用前）で保存した履歴だけのハッシュ。新関数の保存の「前」に取った値と、「後」の値を比べる（同じ時点を左右で比べない）。
OLDHIST_SQL="select md5(string_agg(h.id::text||'|'||h.user_id::text||'|'||h.diagnosis_result_id::text||'|'||h.top_type_code::text||'|'||h.second_type_code::text||'|'||h.score_gap::text||'|'||h.match_scores::text||'|'||h.created_at::text, ',' order by h.id)) from public.stylist_core_type_history h join tb_map m on m.id=h.diagnosis_result_id where m.ph='old'"
oldh() { qn $1 "$OLDHIST_SQL"; }
ha() { qn $1 "select md5(string_agg(user_id::text||'|'||core_type_code::text||'|'||source_diagnosis_result_id::text||'|'||assignment_method||'|'||assigned_at::text, ',' order by user_id)) from public.stylist_core_type_assignments"; }

DB=${PFX}a; build $DB
# ---- ケースの読み込みと診断結果の仮データ（所有者は S1..S4 に振り分ける）。app.diag_gate は0058の入口を通すための検証用の指定。
load_and_run() { # DB 相 : 診断結果を作り、所有者として save_core_type_result を呼び、結果を $W/results_<相>.csv へ
  local db=$1 ph=$2
  psql -X -q -v ON_ERROR_STOP=1 -d "$db" <<SQL >/dev/null 2>"$VFY_ERR" || { head -3 "$VFY_ERR" >&2; vfy_die "ケース投入に失敗"; }
create table if not exists tb_cases(i int, tag text, t int, s int, h int, b int, a int, m int);
create table if not exists tb_map(ph text, i int, id uuid, uid uuid);
truncate tb_cases; \copy tb_cases from '$W/cases.csv' csv
select set_config('app.diag_gate','stylist',false);
insert into public.diagnosis_results (user_id, diagnosis_version, mode, answers, craft_score, sense_score, hospitality_score, brand_score, drive_score, mentor_score, type_id, type_name)
select ('${U}0'||(1 + (c.i % 4)))::uuid, '1.0.0', 'stylist', jsonb_build_object('i', c.i, 'ph', '$ph'), c.t, c.s, c.h, c.b, c.a, c.m, 'cm', 'テスト' from tb_cases c order by c.i;
insert into tb_map select '$ph', (d.answers->>'i')::int, d.id, d.user_id from public.diagnosis_results d where d.answers->>'ph' = '$ph';
SQL
  psql -X -q -v ON_ERROR_STOP=1 -d "$db" <<SQL >/dev/null 2>"$VFY_ERR" || { head -3 "$VFY_ERR" >&2; vfy_die "save_core_type_result の実行に失敗"; }
do \$\$
declare ids uuid[]; uids uuid[]; n int; k int;
begin
  select array_agg(id order by i), array_agg(uid order by i) into ids, uids from tb_map where ph = '$ph';
  n := coalesce(array_length(ids, 1), 0);
  execute 'set local role authenticated';
  for k in 1..n loop
    perform set_config('request.jwt.claim.sub', uids[k]::text, true);
    perform public.save_core_type_result(ids[k]);
  end loop;
end \$\$;
SQL
  psql -X -Atq -F'|' -d "$db" -c "select m.i, h.top_type_code, h.second_type_code, h.score_gap, h.match_scores::text from tb_map m join public.stylist_core_type_history h on h.diagnosis_result_id = m.id where m.ph = '$ph' order by m.i" > "$W/results_$ph.csv"
}

NCASES=$(wc -l < "$W/cases.csv")
vfy_chk "前提: 適用前は 0004 の定義（権限を基準値として記録。authenticated 実行可・anon/public 不可）" "$(fnmd $DB)|$(grants $DB)" "$OLDMD|$(grants $DB)"
G0=$(grants $DB)
vfy_chk "適用前チェック: 総合PASS・FAIL行なし" "$(verdict $DB "$D/0078_preapply_check.sql")|$(fails $DB "$D/0078_preapply_check.sql")" "PASS|0"
vfy_chk "適用後チェックは、適用前の状態ではFAILになる（検出力）" "$(verdict $DB "$D/0078_postapply_check.sql")" "FAIL"
# 検証用の故障注入（通常は使わない）: VFY_INJECT_HISTORY_CHANGE=1 で、新関数の保存の「後」に旧履歴を1行だけ変更してから比較する。
# 比較がFAILになること（＝変更を検出できること）を、実際の比較で示すためのもの。使い捨てDBの中だけ。
inject() { [ -n "${VFY_INJECT_HISTORY_CHANGE:-}" ] && psql -X -q -d $DB >/dev/null 2>&1 <<SQL
set session_replication_role = replica;
update public.stylist_core_type_history set score_gap = score_gap + 0.1 where id = (select h.id from public.stylist_core_type_history h join tb_map m on m.id=h.diagnosis_result_id where m.ph='old' order by h.id limit 1);
SQL
return 0; }
# ---- 適用前（旧関数）で実行: 履歴の元データを作り、同点でずれることを確認（比較は run_0078_verify.sh が行う）
load_and_run $DB old
vfy_chk "旧関数で全ケースを保存した（ケース数と履歴数が一致）" "$(qn $DB "select count(*) from public.stylist_core_type_history")" "$NCASES"
H0=$(hh $DB); A0=$(ha $DB); HOLD0=$(oldh $DB)   # 適用前（旧関数）の時点のハッシュを保持する
[ -n "$HOLD0" ] || vfy_die "旧関数で保存した履歴のハッシュが取れない"
PRE_INFO=$(psql -X -Atq -F'|' -d $DB -f "$D/0078_preapply_check.sql" | grep -E '^(4|5|6)\|')
# ---- 適用
ap $DB "$F78"
vfy_chk "適用後: 関数が 0078 の定義・権限は変わらない" "$(fnmd $DB)|$(grants $DB)" "$NEWMD|$G0"
vfy_chk "適用後チェック: 総合PASS・FAIL行なし" "$(verdict $DB "$D/0078_postapply_check.sql")|$(fails $DB "$D/0078_postapply_check.sql")" "PASS|0"
vfy_chk "適用前チェックは、適用後はFAILになる（二重適用の検出）" "$(verdict $DB "$D/0078_preapply_check.sql")" "FAIL"
vfy_chk "保存済みの履歴は無変更（ハッシュ一致）" "$(hh $DB)" "$H0"
vfy_chk "初回確定タイプは無変更（ハッシュ一致）" "$(ha $DB)" "$A0"
vfy_chk "適用前後チェックのINFO（件数・ハッシュ）が、適用前と一致" "$(psql -X -Atq -F'|' -d $DB -f "$D/0078_postapply_check.sql" | grep -E '^(6|7|8)\|' | cut -d'|' -f4 | tr '\n' ',')" "$(printf '%s' "$PRE_INFO" | cut -d'|' -f4 | tr '\n' ',')"
vfy_chk "二重適用は拒否される" "$(apx $DB "$F78" | grep -c 'already applied')" "1"
# 保存済みの結果を再度保存しようとしても、既存の行が返るだけで履歴は変わらない（冪等）
vfy_chk "適用後に、保存済みの診断を再保存しても履歴・初回確定は変わらない（冪等）" "$(psql -X -q -d $DB -c "do \$\$ declare r record; begin execute 'set local role authenticated'; for r in select id, uid from tb_map where ph='old' order by i limit 300 loop perform set_config('request.jwt.claim.sub', r.uid::text, true); perform public.save_core_type_result(r.id); end loop; end \$\$" >/dev/null 2>&1; echo "$(hh $DB)|$(ha $DB)")" "$H0|$A0"
# ---- 適用後（新関数）で実行
load_and_run $DB new
vfy_chk "新関数で全ケースを保存した（履歴数 = 旧ケース数＋新ケース数）" "$(qn $DB "select count(*) from public.stylist_core_type_history")" "$((NCASES*2))"
inject
vfy_chk "適用前に保存した履歴は、新関数の保存後も無変更（保持した処理前のハッシュと比較）" "$(oldh $DB)" "$HOLD0"
vfy_chk "初回確定は、新関数の保存後も上書きされない（ハッシュ一致）" "$(ha $DB)" "$A0"
# ---- 検出力の確認: 検証用データを意図的に変更すると、上の比較がFAILになる（変更を検出できる比較であること）。変更は巻き戻す。
MUT=$(psql -X -Atq -d $DB 2>&1 <<SQL | tail -1
begin;
set local session_replication_role = replica;
update public.stylist_core_type_history set score_gap = score_gap + 0.1 where id = (select h.id from public.stylist_core_type_history h join tb_map m on m.id=h.diagnosis_result_id where m.ph='old' order by h.id limit 1);
$OLDHIST_SQL;
rollback;
SQL
)
if [ "$MUT" != "$HOLD0" ] && [ -n "$MUT" ]; then MUTRES=differ; else MUTRES="same($MUT)"; fi
vfy_chk "検出力: 旧履歴の1行を意図的に変えると、保持したハッシュと一致しなくなる（比較は変更を検出できる）" "$MUTRES" "differ"
MUTA=$(psql -X -Atq -d $DB 2>&1 <<SQL | tail -1
begin;
set local session_replication_role = replica;
update public.stylist_core_type_assignments set core_type_code = 'brand_builder' where user_id = (select user_id from public.stylist_core_type_assignments order by user_id limit 1) and core_type_code <> 'brand_builder';
select md5(string_agg(user_id::text||'|'||core_type_code::text||'|'||source_diagnosis_result_id::text||'|'||assignment_method||'|'||assigned_at::text, ',' order by user_id)) from public.stylist_core_type_assignments;
rollback;
SQL
)
if [ "$MUTA" != "$A0" ] && [ -n "$MUTA" ]; then MUTARES=differ; else MUTARES="same($MUTA)"; fi
vfy_chk "検出力: 初回確定の1行を意図的に変えると、保持したハッシュと一致しなくなる" "$MUTARES" "differ"
vfy_chk "検出力の確認後、変更は巻き戻されている（旧履歴・初回確定のハッシュが元のまま）" "$(oldh $DB)|$(ha $DB)" "$HOLD0|$A0"
# ---- 巻き戻し
ap $DB "$R78"
vfy_chk "巻き戻し: 関数が 0004 の定義に戻り、権限は変わらない" "$(fnmd $DB)|$(grants $DB)" "$OLDMD|$G0"
vfy_chk "巻き戻し: 履歴は変更されない（0078中に保存された分も残る）" "$(qn $DB "select count(*) from public.stylist_core_type_history")" "$((NCASES*2))"
vfy_chk "巻き戻し: 二重の巻き戻しは拒否される" "$(apx $DB "$R78" | grep -c 'not applied')" "1"
vfy_chk "巻き戻し後の適用前チェック: 総合PASS（再適用できる状態）" "$(verdict $DB "$D/0078_preapply_check.sql")" "PASS"
ap $DB "$F78"
vfy_chk "再適用できる（0078の定義）" "$(fnmd $DB)" "$NEWMD"
# ---- 想定外の定義（0004でも0078でもない）には適用しない
DBb=${PFX}b; build $DBb
psql -X -q -d $DBb -c "create or replace function public.save_core_type_result(p_diagnosis_result_id uuid) returns public.stylist_core_type_history language plpgsql security definer set search_path=public as \$\$ begin raise exception 'x'; end \$\$" >/dev/null 2>&1
vfy_chk "想定外の定義には適用しない（0004と違う）" "$(apx $DBb "$F78" | grep -c 'differs from the 0004 definition')" "1"
vfy_chk "想定外の定義は巻き戻しも拒否する（0078と違う）" "$(apx $DBb "$R78" | grep -c 'differs from the 0078 definition')" "1"
vfy_exit
