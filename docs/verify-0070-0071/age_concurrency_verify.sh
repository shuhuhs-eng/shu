#!/bin/bash
# 実年齢の開示依頼の「連打・同時操作」の検証（ローカル専用・使い捨てDBのみ）。
# 8本の接続から同時に依頼 → 依頼は1件・通知は1件。同時の承認と辞退 → どちらか一方だけが確定し、状態が壊れない。
# 1件でも失敗・SQLエラー・バックグラウンド処理の異常があれば非ゼロで終了する。
D=$(cd "$(dirname "$0")" && pwd)
. "$D/verify_common.sh"
vfy_preflight 0070_stylist_profile_public.draft.sql 0070_fixture.sql stub_supabase.sql
vfy_ensure_template
PFX=vfy_ac_$$_; trap 'for x in a b c; do vdb_drop ${PFX}$x; done; rm -rf "$VFY_TMPD"' EXIT
S1=00000000-0000-0000-0000-000000000001; A1=00000000-0000-0000-0000-000000000010; B0=00000000-0000-0000-0000-0000000000b0
qn() { psql -X -Atq -d "$1" -c "$2" 2>&1; }
prep() { vfy_build_0070_fixture "$1"; psql -X -q -v ON_ERROR_STOP=1 -d "$1" -c "insert into public.stylist_private(user_id,birth_date,age_display_mode) values ('$S1','1990-04-01','decade') on conflict (user_id) do update set birth_date='1990-04-01', age_display_mode='decade'" >/dev/null || vfy_die "準備失敗"; }
req() { psql -X -Atq -v ON_ERROR_STOP=1 -d "$1" -c "set role authenticated; select set_config('request.jwt.claim.sub','$A1',false); select public.request_stylist_age_disclosure('$B0','$S1')->>'created'"; }
resp1() { resp "$@" 2>&1 | grep -E 'ERROR|^(approved|declined)$' | head -1; }
resp() { psql -X -Atq -v ON_ERROR_STOP=1 -d "$1" -c "set role authenticated; select set_config('request.jwt.claim.sub','$S1',false); select public.respond_age_disclosure_request('$2', $3)->>'status'"; }

echo "== 同時に8回の依頼（連打・複数画面）"
DB=${PFX}a; prep $DB
for i in 1 2 3 4 5 6 7 8; do vfy_bg r$i req $DB; done
vfy_join r1 r2 r3 r4 r5 r6 r7 r8
ok=0; created=0; for i in 1 2 3 4 5 6 7 8; do [ "$(vfy_rc r$i)" = 0 ] && ok=$((ok+1)); vfy_out r$i | grep -q '^true$' && created=$((created+1)); done
vfy_chk "8回とも成功（エラー・拒否にならない）" "$ok" "8"
vfy_chk "新規作成として扱われたのは1回だけ" "$created" "1"
vfy_chk "依頼は1件" "$(qn $DB "select count(*) from public.age_disclosure_requests")" "1"
vfy_chk "通知（美容師宛）は1件" "$(qn $DB "select count(*) from public.notifications where type='age_disclosure_requested'")" "1"
RID=$(qn $DB "select id from public.age_disclosure_requests")

echo "== 同時の承認と辞退（6本: 承認3・辞退3）"
for i in 1 2 3; do vfy_bg ap$i resp $DB $RID true; vfy_bg dc$i resp $DB $RID false; done
vfy_join ap1 ap2 ap3 dc1 dc2 dc3
final=$(qn $DB "select status from public.age_disclosure_requests")
vfy_chk "状態は approved か declined のどちらか一方で確定" "$([ "$final" = approved ] || [ "$final" = declined ] && echo yes || echo no)" "yes"
okc=0; ngc=0; for n in ap1 ap2 ap3 dc1 dc2 dc3; do if [ "$(vfy_rc $n)" = 0 ]; then okc=$((okc+1)); else ngc=$((ngc+1)); fi; done
vfy_chk "成功した呼び出しは、確定した決定と同じ側の3回だけ（逆の決定はすべて拒否）" "$okc/$ngc" "3/3"
vfy_has "逆の決定は『already_decided』で拒否" "$(for n in ap1 ap2 ap3 dc1 dc2 dc3; do vfy_out $n; done)" "age_disclosure_already_decided"
vfy_chk "decided_at が設定され、statusと整合" "$(qn $DB "select (status<>'pending' and decided_at is not null)::text from public.age_disclosure_requests")" "true"
na=$(qn $DB "select count(*) from public.notifications where type='age_disclosure_approved'")
if [ "$final" = approved ]; then vfy_chk "承認が確定したなら、承認通知は1件だけ" "$na" "1"; else vfy_chk "辞退が確定したなら、承認通知は0件" "$na" "0"; fi
vfy_chk "確定後に再度、同じ決定を繰り返しても状態は変わらない" "$(resp1 $DB $RID $([ "$final" = approved ] && echo true || echo false))" "$final"

echo "== 承認の連打（同じ決定を6本同時）"
DB=${PFX}b; prep $DB; req $DB >/dev/null; RID=$(qn $DB "select id from public.age_disclosure_requests")
for i in 1 2 3 4 5 6; do vfy_bg p$i resp $DB $RID true; done
vfy_join p1 p2 p3 p4 p5 p6
s=0; for i in 1 2 3 4 5 6; do [ "$(vfy_rc p$i)" = 0 ] && s=$((s+1)); done
vfy_chk "6回とも成功（同じ結果）" "$s" "6"
vfy_chk "状態は approved・承認通知は1件" "$(qn $DB "select (select status from public.age_disclosure_requests)||'/'||(select count(*) from public.notifications where type='age_disclosure_approved')")" "approved/1"

echo "== 並行依頼（同じ店舗から3回）と、存在しない依頼IDの承認"
DB=${PFX}c; prep $DB
for i in 1 2 3; do vfy_bg q$i req $DB; done
vfy_join q1 q2 q3
RID=$(qn $DB "select id from public.age_disclosure_requests")
vfy_chk "並行依頼でも1件" "$(qn $DB "select count(*) from public.age_disclosure_requests")" "1"
vfy_chk "存在しない依頼IDの承認は拒否される" "$(resp1 $DB 00000000-0000-0000-0000-00000000dead true | grep -c 'request not found')" "1"
vfy_exit
