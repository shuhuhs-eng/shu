#!/bin/bash
# 0062 同時実行テスト（ローカル検証用）。複数の psql セッションを並行して走らせ、請求のロックが効いているかを確認する。
# 使い方: bash 0062_concurrency.sh <DB名>   ※0060→0061→0062適用済みで、固定データを「コミット」する専用DBで実行（本番では実行しない）
# 方式: 先行セッションがトランザクション内で操作→待機(2秒)→commit。後続セッション(0.7秒遅れ)が、先行のcommitまで待たされ、
#       commit後の状態で判定されることを、結果（エラー/成功）と待ち時間で確認する。
DB=${1:-c62}
U=00000000-0000-0000-0000-00000000f
ADM=${U}001; OWN=${U}016
C=00000000-0000-0000-0000-0000000f0c01; A=00000000-0000-0000-0000-0000000f0a01
A1=00000000-0000-0000-0000-0000000f0a11
pass=0; fail=0
ok(){ if [ "$2" = "1" ]; then echo "PASS $1"; pass=$((pass+1)); else echo "FAIL $1 :: $3"; fail=$((fail+1)); fi; }
q(){ psql -X -At -d $DB -c "$1"; }
claims(){ echo "select set_config('request.jwt.claims','{\"sub\":\"$1\"}', false)"; }
# 先行: トランザクションで sql を実行し、2秒保持してから commit
slow(){ psql -X -At -d $DB -v ON_ERROR_STOP=1 -c "begin" -c "set role authenticated" -c "$(claims $1)" -c "$2" -c "select pg_sleep(2)" -c "commit" >/dev/null 2>&1; }
# 後続: 結果の最終行（エラーは ERR:メッセージ）と経過秒
fast(){ local t0=$(date +%s.%N); local o; o=$(psql -X -At -d $DB -v ON_ERROR_STOP=1 -c "set role authenticated" -c "$(claims $1)" -c "$2" 2>&1)
  local t1=$(date +%s.%N); ELAPSED=$(echo "$t1 - $t0" | bc)
  if echo "$o" | grep -q 'ERROR:'; then RES="ERR:$(echo "$o" | grep -m1 'ERROR:' | sed 's/^.*ERROR:  //')"; else RES=$(echo "$o" | tail -1); fi; }
waited(){ [ "$(echo "$ELAPSED > 1.0" | bc)" = "1" ] && echo 1 || echo 0; }

psql -X -q -d $DB <<SQL
insert into auth.users (id, email) select ('${U}' || lpad(g::text,3,'0'))::uuid, 'u'||g||'@t' from generate_series(1,20) g on conflict do nothing;
insert into public.platform_admins (user_id) values ('${ADM}') on conflict do nothing;
insert into public.salon_organizations (id, name) values ('$A','A社'),('$C','C社(13店)') on conflict do nothing;
insert into public.salon_stores (id, organization_id, store_name) values ('$A1','$A','A1') on conflict do nothing;
insert into public.salon_stores (organization_id, store_name) select '$C', 'C'||g from generate_series(1,13) g where not exists (select 1 from public.salon_stores where organization_id='$C');
insert into public.organization_members (organization_id, user_id, role) values ('$C','$OWN','company_owner'),('$A','${U}002','company_owner') on conflict do nothing;
-- 見学案件（実施確認済み・両者の意向・オファー）を複数
insert into auth.users (id, email) select ('${U}' || lpad(g::text,3,'0'))::uuid, 'u'||g||'@t' from generate_series(21,40) g on conflict do nothing;
insert into public.store_hiring_processes (id, store_id, stylist_user_id, status, source)
  select ('00000000-0000-0000-0000-0000000f50' || lpad(g::text,2,'0'))::uuid, '$A1', ('${U}' || lpad((10+g)::text,3,'0'))::uuid, 'offered', 'interest' from generate_series(1,8) g on conflict do nothing;
-- 見学案件8件。案件7と8は、同じ採用進行(f5007)への2件の見学案件（1採用で採用料が二重にならないことの確認用）
insert into public.admin_visit_cases (id, stylist_user_id, store_id, status, visit_confirmed_at, stylist_intent, salon_intent, hiring_decision, hiring_process_id)
  select ('00000000-0000-0000-0000-0000000f30' || lpad(g::text,2,'0'))::uuid, ('${U}' || lpad((10+g)::text,3,'0'))::uuid, '$A1', 'visit_confirmed', now(), 'interested','interested','offered',
         ('00000000-0000-0000-0000-0000000f50' || lpad((case when g = 8 then 7 else g end)::text,2,'0'))::uuid from generate_series(1,8) g on conflict do nothing;
SQL
CASE(){ echo "00000000-0000-0000-0000-0000000f30$(printf %02d $1)"; }
newinv(){ q "select 1" >/dev/null; psql -X -At -d $DB -c "set role authenticated" -c "$(claims $ADM)" -c "select public.admin_create_invoice('$1')" | tail -1; }
adv(){ psql -X -At -d $DB -c "set role authenticated" -c "$(claims $ADM)" -c "select public.admin_advance_invoice('$1','$2')" >/dev/null; }
addv(){ psql -X -At -d $DB -c "set role authenticated" -c "$(claims $ADM)" -c "select public.admin_add_fee_line('$1','$2','$3')" | tail -1; }

# R1a: 行の追加（先行）→ 同時の運営確認（後続）。確認は追加のcommitを待ち、行を含んだ状態で確定する
I=$(newinv $A); slow $ADM "select public.admin_add_fee_line('$I','visit','$(CASE 1)')" & sleep 0.7
fast $ADM "select public.admin_advance_invoice('$I','admin_confirmed')"; wait
ok "R1a 行の追加と運営確認の同時実行: 確認は待たされ成功し、行は1行・確認済み" "$([ "$RES" != ERR* ] && [ "$(waited)" = 1 ] && [ "$(q "select count(*) from public.admin_invoice_lines where invoice_id='$I' and voided_at is null")" = 1 ] && [ "$(q "select status from public.admin_invoices where id='$I'")" = admin_confirmed ] && echo 1)" "res=$RES waited=$ELAPSED"
# R1b: 運営確認（先行）→ 同時の行の追加（後続）。追加は待たされ、確認後なので拒否される
I=$(newinv $A); slow $ADM "select public.admin_advance_invoice('$I','admin_confirmed')" & sleep 0.7
fast $ADM "select public.admin_add_fee_line('$I','visit','$(CASE 2)')"; wait
ok "R1b 運営確認と行の追加の同時実行: 追加は待たされ拒否され、確認後に行が増えない" "$([ "$RES" = "ERR:invoice is not editable" ] && [ "$(waited)" = 1 ] && [ "$(q "select count(*) from public.admin_invoice_lines where invoice_id='$I'")" = 0 ] && echo 1)" "res=$RES waited=$ELAPSED"
# R2: 請求確定（先行）→ 同時の行の取消（後続）
I=$(newinv $A); L=$(addv $I visit $(CASE 3)); adv $I admin_confirmed
slow $ADM "select public.admin_advance_invoice('$I','finalized')" & sleep 0.7
fast $ADM "select public.admin_void_line('$L')"; wait
ok "R2 請求確定と行の取消の同時実行: 取消は待たされ拒否され、確定後に行が変わらない" "$([ "$RES" = "ERR:invoice is not editable" ] && [ "$(waited)" = 1 ] && [ "$(q "select count(*) from public.admin_invoice_lines where invoice_id='$I' and voided_at is null")" = 1 ] && echo 1)" "res=$RES waited=$ELAPSED"
# R3a: 決済開始（先行）→ 同時の請求取消（後続）。取消は拒否
I=$(newinv $A); addv $I visit $(CASE 4) >/dev/null; for s in admin_confirmed finalized payment_pending; do adv $I $s; done
slow ${U}002 "select public.billing_begin_checkout('$I')" & sleep 0.7
fast $ADM "select public.admin_advance_invoice('$I','cancelled')"; wait
ok "R3a 決済開始と請求取消の同時実行: 取消は待たされ『決済の進行中』で拒否。決済は1件で請求は支払い待ちのまま" "$([ "$RES" = "ERR:checkout in progress" ] && [ "$(waited)" = 1 ] && [ "$(q "select count(*) from public.admin_invoice_checkouts where invoice_id='$I' and status='pending'")" = 1 ] && [ "$(q "select status from public.admin_invoices where id='$I'")" = payment_pending ] && echo 1)" "res=$RES waited=$ELAPSED"
# R3b: 請求取消（先行）→ 同時の決済開始（後続）。決済開始は拒否
I=$(newinv $A); addv $I visit $(CASE 5) >/dev/null; for s in admin_confirmed finalized payment_pending; do adv $I $s; done
slow $ADM "select public.admin_advance_invoice('$I','cancelled')" & sleep 0.7
fast ${U}002 "select public.billing_begin_checkout('$I')"; wait
ok "R3b 請求取消と決済開始の同時実行: 決済開始は待たされ拒否され、決済記録が作られない" "$([ "$RES" = "ERR:invoice is not payable" ] && [ "$(waited)" = 1 ] && [ "$(q "select count(*) from public.admin_invoice_checkouts where invoice_id='$I'")" = 0 ] && [ "$(q "select status from public.admin_invoices where id='$I'")" = cancelled ] && echo 1)" "res=$RES waited=$ELAPSED"
# R4a: 登録手数料の行の作成（先行）→ 同時の見積の取下げ（後続）。取下げは拒否
QID=$(psql -X -At -d $DB -c "set role authenticated" -c "$(claims $ADM)" -c "select public.admin_propose_quote('$C', 1200000, '13店舗')" | tail -1)
psql -X -At -d $DB -c "set role authenticated" -c "$(claims $OWN)" -c "select public.company_respond_quote('$QID', true)" >/dev/null
I=$(newinv $C)
slow $ADM "select public.admin_add_registration_line('$I')" & sleep 0.7
fast $ADM "select public.admin_withdraw_quote('$QID')"; wait
ok "R4a 見積を使う行の作成と見積の取下げの同時実行: 取下げは待たされ拒否され、見積は合意済みのまま" "$([ "$RES" = "ERR:quote is used by an invoice line" ] && [ "$(waited)" = 1 ] && [ "$(q "select status from public.admin_quotes where id='$QID'")" = agreed ] && [ "$(q "select count(*) from public.admin_invoice_lines where quote_id='$QID' and voided_at is null")" = 1 ] && echo 1)" "res=$RES waited=$ELAPSED"
# R4b: 見積の取下げ（先行）→ 同時の行の作成（後続）。行の作成は拒否され、取下げ済みの見積を使った行が残らない
psql -X -At -d $DB -c "set role authenticated" -c "$(claims $ADM)" -c "select public.admin_advance_invoice('$I','cancelled')" >/dev/null   # R4a の行を解放
I2=$(newinv $C)
slow $ADM "select public.admin_withdraw_quote('$QID')" & sleep 0.7
fast $ADM "select public.admin_add_registration_line('$I2')"; wait
ok "R4b 見積の取下げと行の作成の同時実行: 行の作成は待たされ拒否され、取下げ済みの見積を使う行が残らない" "$([ "$RES" = "ERR:agreed quote required" ] && [ "$(waited)" = 1 ] && [ "$(q "select status from public.admin_quotes where id='$QID'")" = withdrawn ] && [ "$(q "select count(*) from public.admin_invoice_lines where quote_id='$QID' and voided_at is null")" = 0 ] && echo 1)" "res=$RES waited=$ELAPSED"
# R5: 請求確定（先行）→ 同時の案件の採用判断の変更（後続）。変更は待たされ、確認後の請求済みなので拒否
EH=$(CASE 6); I=$(newinv $A); addv $I hire_stylist $EH >/dev/null
slow $ADM "select public.admin_advance_invoice('$I','admin_confirmed')" & sleep 0.7
fast $ADM "select 1" ; t0=$(date +%s.%N); O=$(psql -X -At -d $DB -v ON_ERROR_STOP=1 -c "update public.admin_visit_cases set hiring_decision='declined' where id='$EH'" 2>&1); t1=$(date +%s.%N); wait
ELAPSED=$(echo "$t1 - $t0" | bc)
ok "R5 運営確認と案件の採用判断の変更の同時実行: 変更は待たされ拒否され、確認済みの請求の根拠が崩れない" "$([ -n "$(echo "$O" | grep 'case has an invoiced fee')" ] && [ "$(q "select hiring_decision from public.admin_visit_cases where id='$EH'")" = offered ] && echo 1)" "out=$O"

# R6: 同じ採用進行（案件7・8）への採用料を、別々の請求へ同時に作成。後続は先行のcommitを待ち、二重にならない
P7=00000000-0000-0000-0000-0000000f5007
I6a=$(newinv $A); I6b=$(newinv $A)
slow $ADM "select public.admin_add_fee_line('$I6a','hire_stylist','$(CASE 7)')" & sleep 0.7
fast $ADM "select public.admin_add_fee_line('$I6b','hire_stylist','$(CASE 8)')"; wait
ok "R6 同じ採用進行の2件の見学案件への採用料の同時作成: 後続は待たされ拒否され、その採用の採用料は1行だけ" "$([ "${RES#ERR:}" != "$RES" ] && echo "$RES" | grep -q one_hire_per_process && [ "$(waited)" = 1 ] && [ "$(q "select count(*) from public.admin_invoice_lines where hiring_process_id='$P7' and fee_kind like 'hire%' and voided_at is null")" = 1 ] && echo 1)" "res=$RES waited=$ELAPSED"
# R7: 請求作成の同時再送（同じ request_id）。後続は先行を待ち、同じ請求を返す。請求は1件
RID=$(cat /proc/sys/kernel/random/uuid)
slow $ADM "select public.admin_create_invoice('$A','$RID')" & sleep 0.7
fast $ADM "select public.admin_create_invoice('$A','$RID')"; wait
ok "R7 請求作成の同時再送（同じ request_id）: 後続は待たされ、同じ請求を返す。請求は1件だけ" "$([ "$RES" = "$(q "select id from public.admin_invoices where request_id='$RID'")" ] && [ "$(waited)" = 1 ] && [ "$(q "select count(*) from public.admin_invoices where request_id='$RID'")" = 1 ] && echo 1)" "res=$RES"
# R8: 決済開始の同時再送。後続は先行を待ち、同じ受付を返す。決済は1件
I=$(newinv $A); addv $I visit $(CASE 8) >/dev/null; for s in admin_confirmed finalized payment_pending; do adv $I $s; done
slow ${U}002 "select public.billing_begin_checkout('$I')" & sleep 0.7
fast ${U}002 "select public.billing_begin_checkout('$I')"; wait
ok "R8 決済開始の同時再送: 後続は待たされ、同じ受付を返す（existing=true）。決済受付は1件だけ" "$(echo "$RES" | grep -q '"existing": true' && [ "$(waited)" = 1 ] && [ "$(q "select count(*) from public.admin_invoice_checkouts where invoice_id='$I'")" = 1 ] && echo 1)" "res=$RES"
# R9: 通信切れ（接続の強制切断）の後の再試行。切断された取引は残らず、再試行で1件だけできる
RID=$(cat /proc/sys/kernel/random/uuid)
psql -X -At -d $DB -c "begin" -c "set role authenticated" -c "$(claims $ADM)" -c "select public.admin_create_invoice('$A','$RID')" -c "select pg_sleep(10)" >/dev/null 2>&1 & PP=$!
sleep 1.2; KILLED=$(q "select count(*) from pg_stat_activity where datname='$DB' and query like '%pg_sleep(10)%' and pid <> pg_backend_pid()")
q "select pg_terminate_backend(pid) from pg_stat_activity where datname='$DB' and query like '%pg_sleep(10)%' and pid <> pg_backend_pid()" >/dev/null; wait $PP 2>/dev/null
N0=$(q "select count(*) from public.admin_invoices where request_id='$RID'")
fast $ADM "select public.admin_create_invoice('$A','$RID')"; R1=$RES; fast $ADM "select public.admin_create_invoice('$A','$RID')"
ok "R9 接続の強制切断（取引は未commit）の後の再試行: 切断分は残らず(0件)、再試行で1件だけ、さらに再送しても同じ請求" "$([ "$KILLED" = 1 ] && [ "$N0" = 0 ] && [ "${R1#ERR:}" = "$R1" ] && [ "$RES" = "$R1" ] && [ "$(q "select count(*) from public.admin_invoices where request_id='$RID'")" = 1 ] && echo 1)" "killed=$KILLED n0=$N0 r1=$R1 r2=$RES"
echo "=== $pass PASS / $fail FAIL"
