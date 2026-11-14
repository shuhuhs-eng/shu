#!/bin/bash
# 0064 同時実行テスト（ローカル検証用）。0062→0063→0064 を適用した、データを「コミット」する専用DBで実行する（本番では実行しない）。
# 使い方: bash 0064_concurrency.sh <DB名>
# 目的: 新方式の採用料の行と旧成功報酬の「存在確認・作成・方式変更」が、採用進行IDの共通ロックで直列化され、
#       どちらの順で同時に走っても「1つの採用に請求は1つだけ」になることを確認する。
DB=${1:-c64}
U=00000000-0000-0000-0000-00000000b
ADM=${U}001
X=00000000-0000-0000-0000-0000000b0a01; X1=00000000-0000-0000-0000-0000000b0b01
pass=0; fail=0
ok(){ if [ "$2" = "1" ]; then echo "PASS $1"; pass=$((pass+1)); else echo "FAIL $1 :: $3"; fail=$((fail+1)); fi; }
q(){ psql -X -At -d $DB -c "$1"; }
claims(){ echo "select set_config('request.jwt.claims','{\"sub\":\"$1\"}', false)"; }
# 先行/後続（運営者のRPC）
slow(){ psql -X -At -d $DB -v ON_ERROR_STOP=1 -c "begin" -c "set role authenticated" -c "$(claims $ADM)" -c "$1" -c "select pg_sleep(2)" -c "commit" >/dev/null 2>&1; }
fast(){ local t0=$(date +%s.%N); local o; o=$(psql -X -At -d $DB -v ON_ERROR_STOP=1 -c "set role authenticated" -c "$(claims $ADM)" -c "$1" 2>&1)
  local t1=$(date +%s.%N); ELAPSED=$(echo "$t1 - $t0" | bc)
  if echo "$o" | grep -q 'ERROR:'; then RES="ERR:$(echo "$o" | grep -m1 'ERROR:' | sed 's/^.*ERROR:  //')"; else RES=$(echo "$o" | tail -1); fi; }
# DB所有者として実行する版（採用成立の記録＝旧成功報酬の自動作成を起こす側。アプリの採用確定に相当）
slowsu(){ psql -X -At -d $DB -v ON_ERROR_STOP=1 -c "begin" -c "$1" -c "select pg_sleep(2)" -c "commit" >/dev/null 2>&1; }
fastsu(){ local t0=$(date +%s.%N); psql -X -At -d $DB -v ON_ERROR_STOP=1 -c "$1" >/dev/null 2>&1; local t1=$(date +%s.%N); ELAPSED=$(echo "$t1 - $t0" | bc); }
waited(){ [ "$(echo "$ELAPSED > 1.0" | bc)" = "1" ] && echo 1 || echo 0; }
P(){ echo "00000000-0000-0000-0000-0000000b6$(printf %03d $1)"; }
CS(){ echo "00000000-0000-0000-0000-0000000b7$(printf %03d $1)"; }
FEES(){ q "select count(*) from public.hiring_success_fees where hiring_process_id='$1' and fee_status not in ('cancelled','waived')"; }
LINES(){ q "select count(*) from public.admin_invoice_lines where hiring_process_id='$1' and fee_kind like 'hire%' and voided_at is null"; }

psql -X -q -d $DB <<SQL
insert into auth.users (id, email) select ('${U}' || lpad(g::text,3,'0'))::uuid, 'b'||g||'@t' from generate_series(1,30) g on conflict do nothing;
insert into public.platform_admins (user_id) values ('${ADM}') on conflict do nothing;
insert into public.salon_organizations (id, name) values ('$X','X社') on conflict do nothing;
insert into public.salon_stores (id, organization_id, store_name) values ('$X1','$X','X1') on conflict do nothing;
-- 切替前から進行中の案件（旧）: P1〜P4。切替後に始まる案件（新）は後で作る
insert into public.store_hiring_processes (id, store_id, stylist_user_id, status, source, created_at)
  select ('00000000-0000-0000-0000-0000000b6' || lpad(g::text,3,'0'))::uuid, '$X1', ('${U}' || lpad((10+g)::text,3,'0'))::uuid, 'contacting', 'interest', now() - interval '1 day' from generate_series(1,4) g;
SQL
psql -X -At -d $DB -c "set role authenticated" -c "$(claims $ADM)" -c "select public.admin_set_billing_regime('$X', now())" >/dev/null
sleep 1
# 切替後に始まる案件（新）: P5〜P8。見学案件も作る
psql -X -q -d $DB <<SQL
insert into public.store_hiring_processes (id, store_id, stylist_user_id, status, source)
  select ('00000000-0000-0000-0000-0000000b6' || lpad(g::text,3,'0'))::uuid, '$X1', ('${U}' || lpad((10+g)::text,3,'0'))::uuid, 'contacting', 'interest' from generate_series(5,8) g;
insert into public.admin_visit_cases (id, stylist_user_id, store_id, status, visit_confirmed_at, stylist_intent, salon_intent, hiring_decision, hiring_process_id)
  select ('00000000-0000-0000-0000-0000000b7' || lpad(g::text,3,'0'))::uuid, ('${U}' || lpad((10+g)::text,3,'0'))::uuid, '$X1', 'visit_confirmed', now(), 'interested','interested','offered',
         ('00000000-0000-0000-0000-0000000b6' || lpad(g::text,3,'0'))::uuid from generate_series(5,8) g;
SQL
newinv(){ psql -X -At -d $DB -c "set role authenticated" -c "$(claims $ADM)" -c "select public.admin_create_invoice('$X')" | tail -1; }

# K1: 新方式の採用料の作成（先行）→ 同時の採用成立（旧成功報酬の自動作成。後続）。旧成功報酬は作られず、採用の請求は採用料の1行だけ
I=$(newinv)
slow "select public.admin_add_fee_line('$I','hire_stylist','$(CS 5)')" & sleep 0.7
fastsu "update public.store_hiring_processes set status='hired', hired_at=now() where id='$(P 5)'"; wait
ok "K1 新採用料の作成→同時の採用成立: 後続は待たされ、この採用の請求は 採用料1行・旧成功報酬0件" "$([ "$(waited)" = 1 ] && [ "$(LINES $(P 5))" = 1 ] && [ "$(FEES $(P 5))" = 0 ] && echo 1)" "lines=$(LINES $(P 5)) fees=$(FEES $(P 5)) waited=$ELAPSED"
# K2: 採用成立（先行）→ 同時の新採用料の作成（後続）。後続は待たされ、結果は同じ（採用料1行・旧成功報酬0件）
I=$(newinv)
slowsu "update public.store_hiring_processes set status='hired', hired_at=now() where id='$(P 6)'" & sleep 0.7
fast "select public.admin_add_fee_line('$I','hire_stylist','$(CS 6)')"; wait
ok "K2 採用成立→同時の新採用料の作成: 後続は待たされ、採用料1行・旧成功報酬0件" "$([ "${RES#ERR:}" = "$RES" ] && [ "$(waited)" = 1 ] && [ "$(LINES $(P 6))" = 1 ] && [ "$(FEES $(P 6))" = 0 ] && echo 1)" "res=$RES lines=$(LINES $(P 6)) fees=$(FEES $(P 6))"
# K3: 旧の案件(P1)の採用成立で旧成功報酬が作られる（先行）→ 同時に、運営がその案件を新へ（後続）。後続は待たされ、作られた旧成功報酬を取消にして新へ移す
slowsu "update public.store_hiring_processes set status='hired', hired_at=now() where id='$(P 1)'" & sleep 0.7
fast "select public.admin_set_process_billing_basis('$(P 1)','new','同時実行テスト')"; wait
ok "K3 旧成功報酬の自動作成→同時の新方式への移行: 後続は待たされ、作られた旧成功報酬を取消にして新へ。有効な旧成功報酬は0件" "$([ "${RES#ERR:}" = "$RES" ] && [ "$(waited)" = 1 ] && [ "$(FEES $(P 1))" = 0 ] && [ "$(q "select basis from public.hiring_process_billing_basis where hiring_process_id='$(P 1)'")" = new ] && [ "$(q "select count(*) from public.hiring_success_fees where hiring_process_id='$(P 1)' and fee_status='cancelled'")" = 1 ] && echo 1)" "res=$RES fees=$(FEES $(P 1))"
# K4: 新方式への移行（先行）→ 同時の採用成立（後続）。旧成功報酬は作られない
slow "select public.admin_set_process_billing_basis('$(P 2)','new','同時実行テスト')" & sleep 0.7
fastsu "update public.store_hiring_processes set status='hired', hired_at=now() where id='$(P 2)'"; wait
ok "K4 新方式への移行→同時の採用成立: 後続は待たされ、旧成功報酬は作られない（0件）" "$([ "$(waited)" = 1 ] && [ "$(FEES $(P 2))" = 0 ] && [ "$(q "select count(*) from public.hiring_success_fees where hiring_process_id='$(P 2)'")" = 0 ] && echo 1)" "fees=$(FEES $(P 2)) waited=$ELAPSED"
# K5: 旧成功報酬の確定（先行）→ 同時の新方式への移行（後続）。後続は待たされ、確定済みなので拒否
q "update public.store_hiring_processes set status='hired', hired_at=now() where id='$(P 3)'" >/dev/null
slowsu "update public.hiring_success_fees set fee_status='confirmed', fee_amount=100000, tax_amount=10000, total_amount=110000, confirmed_at=now() where hiring_process_id='$(P 3)'" & sleep 0.7
fast "select public.admin_set_process_billing_basis('$(P 3)','new','同時実行テスト')"; wait
ok "K5 旧成功報酬の確定→同時の新方式への移行: 後続は待たされ『確定済み』で拒否。旧成功報酬は確定のまま" "$([ "$RES" = "ERR:success fee already progressed; cannot move to the new regime" ] && [ "$(waited)" = 1 ] && [ "$(q "select fee_status from public.hiring_success_fees where hiring_process_id='$(P 3)'")" = confirmed ] && [ "$(LINES $(P 3))" = 0 ] && echo 1)" "res=$RES"
# K6: 新採用料の作成の同時再送（同じ請求・同じ案件・同じ区分）。後続は先行を待ち、同じ行を返す。採用の請求は1行
I=$(newinv)
slow "select public.admin_add_fee_line('$I','hire_stylist','$(CS 7)')" & sleep 0.7
fast "select public.admin_add_fee_line('$I','hire_stylist','$(CS 7)')"; wait
ok "K6 新採用料作成の同時再送: 後続は待たされ、同じ行を返す。採用の請求は1行" "$([ "$RES" = "$(q "select id from public.admin_invoice_lines where visit_case_id='$(CS 7)' and fee_kind='hire_stylist' and voided_at is null")" ] && [ "$(waited)" = 1 ] && [ "$(LINES $(P 7))" = 1 ] && echo 1)" "res=$RES"
echo "=== $pass PASS / $fail FAIL"
