#!/bin/bash
# 0064 effective_from（未来日の切替）の前後検証（ローカル用）。コミットされるDBと実時間の待機（sleep）が必要なため、1トランザクションの検証SQLでは確認できない。
# 使い方: bash 0064_effective_from.sh <DB名>   ※0062→0063→0064適用済みの専用DB。本番では実行しない。
# 流れ: 切替を「約8秒後」の日時で記録 → 【切替の記録はあるが、効力は未発生】の判定を確認 → 待つ → 【効力発生後】の判定を確認。
DB=${1:-c64e}
U=00000000-0000-0000-0000-00000000b
ADM=${U}001; E=00000000-0000-0000-0000-0000000b0e01; E1=00000000-0000-0000-0000-0000000b0e11
pass=0; fail=0
ok(){ if [ "$2" = "1" ]; then echo "PASS $1"; pass=$((pass+1)); else echo "FAIL $1 :: $3"; fail=$((fail+1)); fi; }
pick(){ local o; o=$(cat); if echo "$o" | grep -q '^ERROR:'; then echo "$o" | grep -m1 '^ERROR:' | sed 's/^ERROR:  //'; else echo "$o" | grep -v '^$' | grep -v '^INSERT\|^UPDATE\|^SET' | tail -1; fi; }
q(){ psql -X -At -d $DB -c "$1" 2>&1 | pick; }
adm(){ psql -X -At -d $DB -v ON_ERROR_STOP=0 -c "set role authenticated" -c "select set_config('request.jwt.claims','{\"sub\":\"$ADM\"}', false)" -c "$1" 2>&1 | pick; }
MONTHLY="insert into public.stripe_checkout_records (organization_id, purpose, expected_amount, amount_excl_tax, tax_rate, tax_amount, total_amount, livemode, created_by_user_id, expires_at) values ('$E','monthly_subscription',110,100,10,10,110,false,'$ADM', now()+interval '1 hour') returning id"
PR(){ echo "00000000-0000-0000-0000-0000000be$(printf %03d $1)"; }
CSE(){ echo "00000000-0000-0000-0000-0000000bf$(printf %03d $1)"; }
FEES(){ q "select count(*) from public.hiring_success_fees where hiring_process_id='$1' and fee_status not in ('cancelled','waived')"; }

psql -X -q -d $DB <<SQL
insert into auth.users (id, email) select ('${U}' || lpad(g::text,3,'0'))::uuid, 'b'||g||'@t' from generate_series(1,30) g on conflict do nothing;
insert into public.platform_admins (user_id) values ('${ADM}') on conflict do nothing;
insert into public.salon_organizations (id, name) values ('$E','E社') on conflict do nothing;
insert into public.salon_stores (id, organization_id, store_name) values ('$E1','$E','E1') on conflict do nothing;
SQL
# 切替の記録（約8秒後に効力）。記録の「前」に始まった案件 P1
psql -X -q -d $DB -c "insert into public.store_hiring_processes (id, store_id, stylist_user_id, status, source) values ('$(PR 1)','$E1','${U}011','contacting','interest')"
sleep 1
R=$(adm "select public.admin_set_billing_regime('$E', now() + interval '8 seconds')")
EFF=$(q "select effective_from from public.organization_billing_regime where organization_id='$E'")
# 記録の後・効力の前に始まった案件 P2（見学案件も作る）
psql -X -q -d $DB <<SQL
insert into public.store_hiring_processes (id, store_id, stylist_user_id, status, source) values ('$(PR 2)','$E1','${U}012','contacting','interest'),('$(PR 3)','$E1','${U}013','contacting','interest');
insert into public.admin_visit_cases (id, stylist_user_id, store_id, status, visit_confirmed_at, stylist_intent, salon_intent, hiring_decision, hiring_process_id)
  select ('00000000-0000-0000-0000-0000000bf' || lpad(g::text,3,'0'))::uuid, ('${U}' || lpad((10+g)::text,3,'0'))::uuid, '$E1', 'visit_confirmed', now(), 'interested','interested','offered', ('00000000-0000-0000-0000-0000000be' || lpad(g::text,3,'0'))::uuid from generate_series(1,3) g
  on conflict do nothing;
SQL
INV=$(adm "select public.admin_create_invoice('$E')")
echo "--- 効力発生前（切替の記録はある。effective_from=$EFF）---"
ok "E1 効力発生前: 切替の記録があっても、新方式は効いていない（is_effective=false）" "$([ "$(q "select public._billing_regime_active('$E')")" = f ] && echo "$(adm "select public.admin_billing_regime_status('$E')")" | grep -q '"is_effective": false' && echo 1)"
ID=$(q "$MONTHLY"); ok "E2 効力発生前: 月額（旧）の決済開始は拒否されない（記録の存在だけで切り替えない）" "$([ "$(echo $ID | grep -cE '^[0-9a-f-]{36}$')" = 1 ] && echo 1)" "$ID"
q "update public.stripe_checkout_records set status='expired' where organization_id='$E'" >/dev/null
M=$(adm "select public.admin_add_fee_line('$INV','hire_stylist','$(CSE 2)')"); ok "E3 効力発生前: 新方式の採用料の行は作れない" "$([ "$M" = "organization is not on the new billing regime" ] && echo 1)" "$M"
M=$(adm "select public.admin_set_process_billing_basis('$(PR 2)','new','効力前の移行テスト')"); ok "E4 効力発生前: 案件を明示的に新へは移せない" "$([ "$M" = "organization is not on the new regime yet" ] && echo 1)" "$M"
q "update public.store_hiring_processes set status='hired', hired_at=now() where id='$(PR 2)'" >/dev/null
ok "E5 効力発生前に採用成立した案件(P2)は旧: 旧成功報酬が通常どおり作られる" "$([ "$(FEES $(PR 2))" = 1 ] && [ "$(q "select public._hiring_process_basis('$(PR 2)')")" = legacy ] && echo 1)"
echo "--- 待機（効力発生まで）---"
while [ "$(q "select now() < '$EFF'::timestamptz")" = t ]; do sleep 1; done; sleep 1
echo "--- 効力発生後 ---"
ok "E6 効力発生後: 新方式が効く（is_effective=true）" "$([ "$(q "select public._billing_regime_active('$E')")" = t ] && echo "$(adm "select public.admin_billing_regime_status('$E')")" | grep -q '"is_effective": true' && echo 1)"
ID=$(q "$MONTHLY"); ok "E7 効力発生後: 月額の決済開始は拒否される" "$(echo "$ID" | grep -q 'monthly subscription is not billed' && echo 1)" "$ID"
psql -X -q -d $DB -c "insert into public.store_hiring_processes (id, store_id, stylist_user_id, status, source) values ('$(PR 4)','$E1','${U}014','contacting','interest')"
ok "E8 切替の記録の前・効力の前に始まった案件(P1,P3)は旧のまま／効力後に始まった案件(P4)は新" "$([ "$(q "select public._hiring_process_basis('$(PR 1)')")" = legacy ] && [ "$(q "select public._hiring_process_basis('$(PR 3)')")" = legacy ] && [ "$(q "select public._hiring_process_basis('$(PR 4)')")" = new ] && echo 1)"
M=$(adm "select public.admin_add_fee_line('$INV','hire_stylist','$(CSE 3)')"); ok "E9 効力発生後でも、旧のままの案件(P3)には新採用料の行を作れない" "$([ "$M" = "hiring process is on the legacy billing basis" ] && echo 1)" "$M"
psql -X -q -d $DB -c "insert into public.admin_visit_cases (id, stylist_user_id, store_id, status, visit_confirmed_at, stylist_intent, salon_intent, hiring_decision, hiring_process_id) values ('$(CSE 4)','${U}014','$E1','visit_confirmed',now(),'interested','interested','offered','$(PR 4)')"
M=$(adm "select public.admin_add_fee_line('$INV','hire_stylist','$(CSE 4)')"); ok "E10 効力発生後: 新方式の案件(P4)には新採用料の行を作れる" "$(echo "$M" | grep -qE '^[0-9a-f-]{36}$' && echo 1)" "$M"
q "update public.store_hiring_processes set status='hired', hired_at=now() where id='$(PR 4)'" >/dev/null
ok "E11 効力発生後に始まった案件(P4)の採用成立: 旧成功報酬は作られない" "$([ "$(FEES $(PR 4))" = 0 ] && echo 1)"
M=$(adm "select public.admin_set_process_billing_basis('$(PR 3)','new','効力後の移行')"); ok "E12 効力発生後: 進行中で旧の案件(P3)を、運営が明示的に新へ移せる" "$(echo "$M" | grep -q '"basis": "new"' && echo 1)" "$M"
M=$(adm "select public.admin_set_process_billing_basis('$(PR 2)','new','確定済みの案件')"); q "update public.hiring_success_fees set fee_status='confirmed', fee_amount=1, tax_amount=0, total_amount=1, confirmed_at=now() where hiring_process_id='$(PR 2)'" >/dev/null
ok "E13 記録の存在だけでは変わらず、すでに作られた旧成功報酬(P2)は削除・書換えされない（行は残る）" "$([ "$(q "select count(*) from public.hiring_success_fees where hiring_process_id='$(PR 2)'")" = 1 ] && echo 1)" "$M"
echo "=== $pass PASS / $fail FAIL"
