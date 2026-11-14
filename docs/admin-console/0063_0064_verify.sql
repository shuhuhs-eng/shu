-- 0063/0064（草案 v3）の検証。0062→0063→0064 の順に適用済みのローカルDBで実行し、最後にROLLBACKする（0064は0062の請求行と接続するため、0062が先）。
\set ON_ERROR_STOP on
begin;
create temp table t_log (n serial, name text, ok boolean, info text);
grant all on t_log to public; grant all on sequence t_log_n_seq to public;
create or replace function pg_temp.chk(p_name text, p_ok boolean, p_info text default '') returns void language plpgsql as
$$ begin insert into t_log(name, ok, info) values (p_name, coalesce(p_ok,false), p_info); if not coalesce(p_ok,false) then raise notice 'FAIL % : %', p_name, p_info; end if; end $$;
create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$ begin execute p_sql; return 'OK'; exception when others then return sqlerrm; end $$;
grant execute on function pg_temp.chk(text,boolean,text), pg_temp.try(text) to public;

-- 適用直後の既存データ: 会社所在地は全社 未設定（店舗住所から推測して埋めていない）
select pg_temp.chk('C0 既存の会社の所在地は、適用直後すべて未設定(NULL)', (select count(*) from public.salon_organizations where hq_prefecture is not null or hq_city is not null or hq_street_address is not null) = 0);

insert into auth.users (id, email) select ('00000000-0000-0000-0000-00000000b' || lpad(g::text,3,'0'))::uuid, 'b'||g||'@t' from generate_series(1,12) g;
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-00000000b001');
insert into public.salon_organizations (id, name) values
 ('00000000-0000-0000-0000-0000000b0a01','X社'),('00000000-0000-0000-0000-0000000b0a02','Y社(旧のまま)'),('00000000-0000-0000-0000-0000000b0a03','Z社(定期課金あり)');
insert into public.salon_stores (id, organization_id, store_name, prefecture) values
 ('00000000-0000-0000-0000-0000000b0b01','00000000-0000-0000-0000-0000000b0a01','X1','神奈川県'),
 ('00000000-0000-0000-0000-0000000b0b02','00000000-0000-0000-0000-0000000b0a02','Y1',null),
 ('00000000-0000-0000-0000-0000000b0b03','00000000-0000-0000-0000-0000000b0a03','Z1',null);
-- 切替前の状態: Y社の採用成立（旧の成功報酬が自動で作られる）
insert into public.store_hiring_processes (id, store_id, stylist_user_id, status, source, hired_at) values
 ('00000000-0000-0000-0000-0000000b1001','00000000-0000-0000-0000-0000000b0b02','00000000-0000-0000-0000-00000000b010','hired','interest', now());
select pg_temp.chk('L1 旧方式の会社(Y)では、採用成立で旧成功報酬が自動作成される（従来どおり）', (select count(*) from public.hiring_success_fees where hiring_process_id = '00000000-0000-0000-0000-0000000b1001') = 1);
-- X社: 切替前に作られていた案件（進行中・取消待ち・確定済みなど）
insert into public.store_hiring_processes (id, store_id, stylist_user_id, status, source, created_at) values
 ('00000000-0000-0000-0000-0000000b2001','00000000-0000-0000-0000-0000000b0b01','00000000-0000-0000-0000-00000000b011','contacting','interest', now() - interval '2 days'),  -- 進行中（既定=旧）
 ('00000000-0000-0000-0000-0000000b2002','00000000-0000-0000-0000-0000000b0b01','00000000-0000-0000-0000-00000000b012','contacting','interest', now() - interval '2 days'),  -- 進行中（運営が新へ）
 ('00000000-0000-0000-0000-0000000b2003','00000000-0000-0000-0000-0000000b0b01','00000000-0000-0000-0000-00000000b013','contacting','interest', now() - interval '2 days');
insert into public.store_hiring_processes (id, store_id, stylist_user_id, status, source, hired_at, created_at) values
 ('00000000-0000-0000-0000-0000000b2004','00000000-0000-0000-0000-0000000b0b01','00000000-0000-0000-0000-00000000b014','hired','interest', now() - interval '1 day', now() - interval '3 days'),  -- 既に採用成立・旧成功報酬あり(pending)
 ('00000000-0000-0000-0000-0000000b2005','00000000-0000-0000-0000-0000000b0b01','00000000-0000-0000-0000-00000000b015','hired','interest', now() - interval '1 day', now() - interval '3 days');  -- 同上（金額確定まで進める）
update public.hiring_success_fees set fee_status='confirmed', fee_amount=100000, tax_amount=10000, total_amount=110000, confirmed_at=now() where hiring_process_id='00000000-0000-0000-0000-0000000b2005';
-- 履歴の件数（切替前）
create temp table before_fees as select id, fee_status, fee_amount, total_amount from public.hiring_success_fees;
grant select on before_fees to public;
-- Z社: 定期課金が有効
insert into public.organization_subscriptions (organization_id, stripe_customer_id, stripe_subscription_id, subscription_status, payment_state, cancel_at_period_end, current_period_end, synced_at)
 values ('00000000-0000-0000-0000-0000000b0a03','cus_zz','sub_zz','active','active', false, now() + interval '20 days', now());

do $$
declare
  adm text := '{"sub":"00000000-0000-0000-0000-00000000b001"}'; non text := '{"sub":"00000000-0000-0000-0000-00000000b002"}';
  X uuid := '00000000-0000-0000-0000-0000000b0a01'; Z uuid := '00000000-0000-0000-0000-0000000b0a03'; Y uuid := '00000000-0000-0000-0000-0000000b0a02';
  r jsonb; msg text; fid uuid; n int; ev int;
begin
  ---- 権限 ----
  set local role authenticated; perform set_config('request.jwt.claims', non, true);
  perform pg_temp.chk('A1 運営者以外は、切替・案件判定・状況確認・会社所在地の取得/更新をすべて拒否',
    pg_temp.try(format($q$select public.admin_set_billing_regime('%s')$q$, X)) = 'admin access required'
    and pg_temp.try(format($q$select public.admin_set_process_billing_basis('00000000-0000-0000-0000-0000000b2001','new','x')$q$)) = 'admin access required'
    and pg_temp.try(format($q$select public.admin_billing_regime_status('%s')$q$, X)) = 'admin access required'
    and pg_temp.try(format($q$select public.admin_get_organization_location('%s')$q$, X)) = 'admin access required'
    and pg_temp.try(format($q$select public.admin_set_organization_location('%s','東京都',null,null)$q$, X)) = 'admin access required');
  perform pg_temp.chk('A2 会社の所属者でも、salon_organizations の所在地列を直接更新できない', pg_temp.try(format($q$update public.salon_organizations set hq_prefecture='東京都' where id='%s'$q$, X)) like 'permission denied%');
  reset role;
  set local role anon;
  perform pg_temp.chk('A3 未ログイン(anon)は切替を実行できない', pg_temp.try(format($q$select public.admin_set_billing_regime('%s')$q$, X)) like 'permission denied%');
  reset role;

  set local role authenticated; perform set_config('request.jwt.claims', adm, true);
  ---- 切替の前提（定期課金・過去日時） ----
  r := public.admin_billing_regime_status(Z);
  perform pg_temp.chk('S1 状況確認: Z社は定期課金が有効のため切替不可と分かる', r->>'switch_blocked_reason' = 'legacy_subscription_active', r::text);
  perform pg_temp.chk('S2 定期課金が有効(解約予約なし)の会社は切替できない', pg_temp.try(format($q$select public.admin_set_billing_regime('%s')$q$, Z)) like 'legacy subscription is still active%');
  perform pg_temp.chk('S3 過去の日時での切替は不可（既存案件の判定が変わらないように）', pg_temp.try(format($q$select public.admin_set_billing_regime('%s', now() - interval '1 day')$q$, X)) = 'effective_from must not be in the past');
  reset role; update public.organization_subscriptions set cancel_at_period_end = true where organization_id = Z; set local role authenticated; perform set_config('request.jwt.claims', adm, true);
  r := public.admin_billing_regime_status(Z);
  perform pg_temp.chk('S4 期間末での解約が反映(cancel_at_period_end)された後は切替できる（反映確認が済んだ状態）', r->>'switch_blocked_reason' is null, r::text);
  reset role; insert into public.stripe_checkout_records (organization_id, purpose, livemode, status, created_by_user_id, expires_at) values ('00000000-0000-0000-0000-0000000b0a02','payment_method_setup', false, 'open','00000000-0000-0000-0000-00000000b001', now()+interval '1 hour');
  set local role authenticated; perform set_config('request.jwt.claims', adm, true);
  perform pg_temp.chk('S5 進行中の決済がある会社(Y)は切替できない', pg_temp.try(format($q$select public.admin_set_billing_regime('%s')$q$, Y)) like 'an open checkout exists%');

  ---- X社を新方式へ ----
  r := public.admin_set_billing_regime(X, now());
  perform pg_temp.chk('N1 X社を新方式へ切替。進行中の旧案件は旧のまま完結する件数が返る', (r->>'in_progress_cases_kept_legacy')::int = 3, r::text);
  r := public.admin_set_billing_regime(X, now() + interval '1 day');
  reset role;
  perform pg_temp.chk('N1b 同じ会社の再切替（再試行）は何も変えず、設定済みの内容を返す（日時も最初のまま）', (r->>'already_set')::boolean and (select count(*) from public.organization_billing_regime where organization_id = X) = 1
    and (select effective_from from public.organization_billing_regime where organization_id = X) <= now(), r::text);
  perform pg_temp.chk('N1c 記録表は追記専用（更新・削除できない）', pg_temp.try(format($q$update public.organization_billing_regime set effective_from = now() where organization_id='%s'$q$, X)) like '%append-only%'
    and pg_temp.try(format($q$delete from public.organization_billing_regime where organization_id='%s'$q$, X)) like '%append-only%');
  ---- 切替前から進行中の案件（既定=旧）が採用成立 → 旧成功報酬が作られる ----
  update public.store_hiring_processes set status='hired', hired_at = now() where id = '00000000-0000-0000-0000-0000000b2001';
  perform pg_temp.chk('N2 切替前から進行中の案件は旧のまま: 採用成立で旧成功報酬が作られる', (select count(*) from public.hiring_success_fees where hiring_process_id = '00000000-0000-0000-0000-0000000b2001') = 1);
  ---- 切替後に始まった案件 → 新 ----
  insert into public.store_hiring_processes (id, store_id, stylist_user_id, status, source, hired_at) values
    ('00000000-0000-0000-0000-0000000b3001','00000000-0000-0000-0000-0000000b0b01','00000000-0000-0000-0000-00000000b016','hired','interest', now());
  perform pg_temp.chk('N3 切替後に始まった案件は新: 採用成立しても旧成功報酬は作られず、採用成立の記録は通常どおり', (select count(*) from public.hiring_success_fees where hiring_process_id = '00000000-0000-0000-0000-0000000b3001') = 0
    and (select status from public.store_hiring_processes where id = '00000000-0000-0000-0000-0000000b3001') = 'hired');
  ---- 運営が進行中の案件を明示的に新へ ----
  set local role authenticated; perform set_config('request.jwt.claims', adm, true);
  perform pg_temp.chk('N4a 判定理由が空だと拒否', pg_temp.try($q$select public.admin_set_process_billing_basis('00000000-0000-0000-0000-0000000b2002','new','')$q$) = 'reason required');
  perform pg_temp.chk('N4b 新方式でない会社の案件は「新」にできない', pg_temp.try($q$select public.admin_set_process_billing_basis('00000000-0000-0000-0000-0000000b1001','new','x')$q$) = 'organization is not on the new regime yet');
  r := public.admin_set_process_billing_basis('00000000-0000-0000-0000-0000000b2002', 'new', '見学から新料金で合意');
  perform pg_temp.chk('N4c 進行中(旧成功報酬なし)の案件を明示的に新へ', r->>'basis' = 'new' and (r->>'legacy_fee_cancelled')::boolean = false, r::text);
  perform pg_temp.chk('N4d 同じ案件の判定は二度決められない', pg_temp.try($q$select public.admin_set_process_billing_basis('00000000-0000-0000-0000-0000000b2002','legacy','y')$q$) = 'basis already decided');
  reset role;
  update public.store_hiring_processes set status='hired', hired_at = now() where id = '00000000-0000-0000-0000-0000000b2002';
  perform pg_temp.chk('N5 明示的に新にした案件は、採用成立でも旧成功報酬が作られない', (select count(*) from public.hiring_success_fees where hiring_process_id = '00000000-0000-0000-0000-0000000b2002') = 0);
  ---- 既に旧成功報酬がある案件 ----
  set local role authenticated; perform set_config('request.jwt.claims', adm, true);
  perform pg_temp.chk('N6 金額確定済み(confirmed)の旧成功報酬がある案件は、新へ移せない', pg_temp.try($q$select public.admin_set_process_billing_basis('00000000-0000-0000-0000-0000000b2005','new','x')$q$) = 'success fee already progressed; cannot move to the new regime');
  reset role; select count(*) into n from public.hiring_success_fees; select count(*) into ev from public.hiring_success_fee_events;
  set local role authenticated; perform set_config('request.jwt.claims', adm, true);
  r := public.admin_set_process_billing_basis('00000000-0000-0000-0000-0000000b2004', 'new', '見学から新料金');
  reset role;
  perform pg_temp.chk('N7 金額・請求の無い自動作成の旧成功報酬(pending)だけは、取消にして新へ。行は削除されず履歴が残る',
    (r->>'legacy_fee_cancelled')::boolean and (select count(*) from public.hiring_success_fees) = n and (select count(*) from public.hiring_success_fee_events) = ev + 1
    and (select fee_status from public.hiring_success_fees where hiring_process_id = '00000000-0000-0000-0000-0000000b2004') = 'cancelled', r::text);
  ---- 旧画面・旧APIからの確定・決済の拒否（DBで） ----
  insert into public.hiring_process_billing_basis (hiring_process_id, basis, reason, decided_by) values ('00000000-0000-0000-0000-0000000b2001','new','検証用（トリガー確認のため運営RPCを通さず直接）','00000000-0000-0000-0000-00000000b001');
  select id into fid from public.hiring_success_fees where hiring_process_id = '00000000-0000-0000-0000-0000000b2001';
  perform pg_temp.chk('G1 新方式の案件の旧成功報酬を「確定」にしようとすると、旧画面・旧APIからでもDBが拒否',
    pg_temp.try(format($q$update public.hiring_success_fees set fee_status='confirmed', fee_amount=1, tax_amount=0, total_amount=1, confirmed_at=now() where id='%s'$q$, fid)) like '%legacy success fee is not allowed%');
  perform pg_temp.chk('G2 同じく「請求済み」「支払い済み」への遷移も拒否', pg_temp.try(format($q$update public.hiring_success_fees set fee_status='paid', paid_at=now() where id='%s'$q$, fid)) like '%legacy success fee is not allowed%');
  perform pg_temp.chk('G3 旧の成功報酬のカード決済(Checkout)の開始を拒否', pg_temp.try(format($q$insert into public.stripe_checkout_records (organization_id, purpose, success_fee_id, expected_amount, amount_excl_tax, tax_rate, tax_amount, total_amount, livemode, created_by_user_id, expires_at) values ('00000000-0000-0000-0000-0000000b0a01','success_fee','%s',110,100,10,10,110,false,'00000000-0000-0000-0000-00000000b001', now()+interval '1 hour')$q$, fid)) like '%legacy success fee is not allowed%');
  perform pg_temp.chk('G4 新方式の会社では、月額の定期課金の開始も拒否', pg_temp.try($q$insert into public.stripe_checkout_records (organization_id, purpose, expected_amount, amount_excl_tax, tax_rate, tax_amount, total_amount, livemode, created_by_user_id, expires_at) values ('00000000-0000-0000-0000-0000000b0a01','monthly_subscription',110,100,10,10,110,false,'00000000-0000-0000-0000-00000000b001', now()+interval '1 hour')$q$) like '%monthly subscription is not billed%');
  perform pg_temp.chk('G5 取消(cancelled)は引き続き可能（過去の行を閉じる操作は止めない）', pg_temp.try(format($q$update public.hiring_success_fees set fee_status='cancelled', cancelled_at=now() where id='%s'$q$, fid)) = 'OK');
  perform pg_temp.chk('G6 旧方式の会社(Y)の旧成功報酬は従来どおり操作できる（免除）', pg_temp.try($q$update public.hiring_success_fees set fee_status='waived', waived_at=now() where hiring_process_id='00000000-0000-0000-0000-0000000b1001'$q$) = 'OK');
  perform pg_temp.chk('G7 新方式でない会社でもカード登録(payment_method_setup)等は止めない', pg_temp.try($q$insert into public.stripe_checkout_records (organization_id, purpose, livemode, created_by_user_id, expires_at) values ('00000000-0000-0000-0000-0000000b0a01','payment_method_setup',false,'00000000-0000-0000-0000-00000000b001', now()+interval '1 hour')$q$) = 'OK');
  ---- 既存の請求・決済履歴は変わっていない ----
  perform pg_temp.chk('H1 切替・案件判定を通しても、切替前の旧成功報酬の金額・状態は変わらない（確定済みの行）',
    (select count(*) from before_fees b join public.hiring_success_fees f on f.id = b.id where b.fee_status = 'confirmed' and f.fee_status = 'confirmed' and f.fee_amount = b.fee_amount and f.total_amount = b.total_amount) = 1);
  perform pg_temp.chk('H2 旧成功報酬の行は1件も削除されていない', (select count(*) from before_fees b where not exists (select 1 from public.hiring_success_fees f where f.id = b.id)) = 0);
  ---- 整合性チェック ----
  set local role authenticated; perform set_config('request.jwt.claims', adm, true);
  r := public.get_admin_billing_integrity_issues();
  perform pg_temp.chk('I1 新方式の案件(hiredで旧成功報酬なし)は「成功報酬の記録がない」異常として数えない', not (r::text like '%0000b3001%') and not (r::text like '%0000b2002%'), left(r::text, 300));
  reset role;

  ---- 0062との接続: 新方式の採用料と旧成功報酬の二重請求の防止（0062適用後のDBで実行） ----
  insert into auth.users (id, email) select ('00000000-0000-0000-0000-00000000b' || lpad(g::text,3,'0'))::uuid, 'b'||g||'@t' from generate_series(13,30) g on conflict do nothing;
  insert into public.admin_invoices (id, organization_id, created_by) values ('00000000-0000-0000-0000-0000000b4001', X, '00000000-0000-0000-0000-00000000b001'),('00000000-0000-0000-0000-0000000b4002', Y, '00000000-0000-0000-0000-00000000b001');
  insert into public.admin_visit_cases (id, stylist_user_id, store_id, status, visit_confirmed_at, stylist_intent, salon_intent, hiring_decision, hiring_process_id) values
    ('00000000-0000-0000-0000-0000000b5001','00000000-0000-0000-0000-00000000b012','00000000-0000-0000-0000-0000000b0b01','visit_confirmed',now(),'interested','interested','offered','00000000-0000-0000-0000-0000000b2002'),   -- X社・明示的に新の採用進行
    ('00000000-0000-0000-0000-0000000b5002','00000000-0000-0000-0000-00000000b010','00000000-0000-0000-0000-0000000b0b02','visit_confirmed',now(),'interested','interested','offered','00000000-0000-0000-0000-0000000b1001'),   -- Y社（旧方式の会社）
    ('00000000-0000-0000-0000-0000000b5003','00000000-0000-0000-0000-00000000b013','00000000-0000-0000-0000-0000000b0b01','visit_confirmed',now(),'interested','interested','offered','00000000-0000-0000-0000-0000000b2003'),   -- X社だが旧の採用進行（切替前から進行中）
    ('00000000-0000-0000-0000-0000000b5004','00000000-0000-0000-0000-00000000b013','00000000-0000-0000-0000-0000000b0b01','visit_confirmed',now(),'interested','interested','offered', null),                                 -- 採用進行に紐づかない
    ('00000000-0000-0000-0000-0000000b5006','00000000-0000-0000-0000-00000000b012','00000000-0000-0000-0000-0000000b0b01','visit_confirmed',now(),'interested','interested','offered','00000000-0000-0000-0000-0000000b2002');   -- 同じ採用進行の2件目の見学案件
  msg := pg_temp.try($q$insert into public.admin_invoice_lines (invoice_id, organization_id, store_id, visit_case_id, fee_kind, amount_excl_tax, tax_amount, total_amount)
      values ('00000000-0000-0000-0000-0000000b4001','00000000-0000-0000-0000-0000000b0a01','00000000-0000-0000-0000-0000000b0b01','00000000-0000-0000-0000-0000000b5001','hire_stylist',550000,55000,605000)$q$);
  perform pg_temp.chk('U1 効力が生じた新方式の会社・新方式の採用進行では、採用料の行を作れる（案件の採用進行が行に記録される）', msg = 'OK'
    and (select hiring_process_id from public.admin_invoice_lines where visit_case_id = '00000000-0000-0000-0000-0000000b5001') = '00000000-0000-0000-0000-0000000b2002', msg);
  perform pg_temp.chk('U2 新方式に切り替えていない会社(Y)では、採用料の行を作れない（旧の成功報酬が対象）', pg_temp.try($q$insert into public.admin_invoice_lines (invoice_id, organization_id, store_id, visit_case_id, fee_kind, amount_excl_tax, tax_amount, total_amount)
      values ('00000000-0000-0000-0000-0000000b4002','00000000-0000-0000-0000-0000000b0a02','00000000-0000-0000-0000-0000000b0b02','00000000-0000-0000-0000-0000000b5002','hire_stylist',550000,55000,605000)$q$) = 'organization is not on the new billing regime');
  perform pg_temp.chk('U3 新方式の会社でも、切替前から進行中で旧のままの採用進行には採用料を作れない', public._hiring_process_basis('00000000-0000-0000-0000-0000000b2003') = 'legacy'
    and pg_temp.try($q$insert into public.admin_invoice_lines (invoice_id, organization_id, store_id, visit_case_id, fee_kind, amount_excl_tax, tax_amount, total_amount)
      values ('00000000-0000-0000-0000-0000000b4001','00000000-0000-0000-0000-0000000b0a01','00000000-0000-0000-0000-0000000b0b01','00000000-0000-0000-0000-0000000b5003','hire_assistant',450000,45000,495000)$q$) = 'hiring process is on the legacy billing basis');
  perform pg_temp.chk('U4a 採用進行に紐づかない採用は、採用料にできない（個別確認）。店舗×美容師の一致では推測しない', pg_temp.try($q$insert into public.admin_invoice_lines (invoice_id, organization_id, store_id, visit_case_id, fee_kind, amount_excl_tax, tax_amount, total_amount)
      values ('00000000-0000-0000-0000-0000000b4001','00000000-0000-0000-0000-0000000b0a01','00000000-0000-0000-0000-0000000b0b01','00000000-0000-0000-0000-0000000b5004','hire_assistant',450000,45000,495000)$q$) = 'hiring process link required; needs individual review');
  perform pg_temp.chk('U4b 同じ採用進行の2件目の見学案件に、採用料を二重に作れない（同じ請求・別の請求とも）', pg_temp.try($q$insert into public.admin_invoice_lines (invoice_id, organization_id, store_id, visit_case_id, fee_kind, amount_excl_tax, tax_amount, total_amount)
      values ('00000000-0000-0000-0000-0000000b4001','00000000-0000-0000-0000-0000000b0a01','00000000-0000-0000-0000-0000000b0b01','00000000-0000-0000-0000-0000000b5006','hire_stylist',550000,55000,605000)$q$) like '%admin_invoice_lines_one_hire_per_process%');
  -- 旧成功報酬の自動作成は、新方式の採用料があれば抑止（防御。通常は上の拒否で到達しないため、ガードを一時的に外して重複の状態を作る）
  alter table public.admin_invoice_lines disable trigger trg_admin_invoice_lines_regime_guard;
  perform pg_temp.chk('U4c-0 （検証の準備）ガードを外した状態で、旧の採用進行に採用料の行を作る', pg_temp.try($q$insert into public.admin_invoice_lines (invoice_id, organization_id, store_id, visit_case_id, fee_kind, amount_excl_tax, tax_amount, total_amount)
      values ('00000000-0000-0000-0000-0000000b4001','00000000-0000-0000-0000-0000000b0a01','00000000-0000-0000-0000-0000000b0b01','00000000-0000-0000-0000-0000000b5003','hire_assistant',450000,45000,495000)$q$) = 'OK');
  alter table public.admin_invoice_lines enable trigger trg_admin_invoice_lines_regime_guard;
  update public.store_hiring_processes set status='hired', hired_at = now() where id = '00000000-0000-0000-0000-0000000b2003';
  perform pg_temp.chk('U4c 同じ採用進行に採用料の行があると、旧成功報酬は自動作成されない', (select count(*) from public.hiring_success_fees where hiring_process_id = '00000000-0000-0000-0000-0000000b2003') = 0);
  perform pg_temp.chk('U4d 抑止した重複の疑い(fee_overlap)が個別確認の一覧に残る', (select count(*) from public.admin_unresolved_billing_cases where reason = 'fee_overlap' and organization_id = X) = 1);
  -- 旧成功報酬が（取消・免除以外で）すでにある採用進行には、採用料の行を作れない
  insert into public.admin_visit_cases (id, stylist_user_id, store_id, status, visit_confirmed_at, stylist_intent, salon_intent, hiring_decision, hiring_process_id)
    select '00000000-0000-0000-0000-0000000b5005', f.stylist_user_id, f.store_id, 'visit_confirmed', now(), 'interested','interested','offered', f.hiring_process_id from public.hiring_success_fees f
     where f.organization_id = X and f.fee_status not in ('cancelled','waived') limit 1;
  perform pg_temp.chk('U5 旧成功報酬（取消・免除以外）がすでにある採用進行には、採用料の行を作れない（二重請求の防止）', (select count(*) from public.admin_visit_cases where id = '00000000-0000-0000-0000-0000000b5005') = 1
    and pg_temp.try($q$insert into public.admin_invoice_lines (invoice_id, organization_id, store_id, visit_case_id, fee_kind, amount_excl_tax, tax_amount, total_amount)
      select '00000000-0000-0000-0000-0000000b4001', '00000000-0000-0000-0000-0000000b0a01'::uuid, c.store_id, c.id, 'hire_stylist', 550000, 55000, 605000 from public.admin_visit_cases c where c.id = '00000000-0000-0000-0000-0000000b5005'$q$) like '%legacy%');
  perform pg_temp.chk('U6 見学料・登録手数料は旧成功報酬と無関係（新方式でない会社でも作れる）', pg_temp.try($q$insert into public.admin_invoice_lines (invoice_id, organization_id, fee_kind, amount_excl_tax, tax_amount, total_amount)
      values ('00000000-0000-0000-0000-0000000b4002','00000000-0000-0000-0000-0000000b0a02','registration',10000,1000,11000)$q$) = 'OK');

  ---- 会社所在地（0063） ----
  set local role authenticated; perform set_config('request.jwt.claims', adm, true);
  perform pg_temp.chk('C1 取得: 未設定は is_set=false で、店舗の住所（神奈川県）を使って埋めない', (public.admin_get_organization_location(X)->>'is_set')::boolean = false and public.admin_get_organization_location(X)->'prefecture' = 'null'::jsonb);
  perform pg_temp.chk('C2 47都道府県以外（市名など）は拒否', pg_temp.try(format($q$select public.admin_set_organization_location('%s','横浜','','')$q$, X)) = 'invalid prefecture');
  r := public.admin_set_organization_location(X, '東京都', '渋谷区', '○○1-2-3');
  perform pg_temp.chk('C3 運営者が会社所在地を設定できる', (r->>'changed')::boolean and public.admin_get_organization_location(X)->>'prefecture' = '東京都', r::text);
  perform pg_temp.chk('C4 同じ内容の再設定は変更なし（履歴を増やさない）', (public.admin_set_organization_location(X, '東京都', '渋谷区', '○○1-2-3')->>'changed')::boolean = false);
  reset role;
  perform pg_temp.chk('C5 店舗の所在地は会社所在地の設定で変わらない（別項目）', (select prefecture from public.salon_stores where id = '00000000-0000-0000-0000-0000000b0b01') = '神奈川県');
  perform pg_temp.chk('C6 変更履歴（変更者・前後の値）が1件残る', (select count(*) from public.organization_location_events where organization_id = X and actor_user_id = '00000000-0000-0000-0000-00000000b001' and before_value->>'prefecture' is null and after_value->>'prefecture' = '東京都') = 1);
  perform pg_temp.chk('C7 履歴表・記録表は一般利用者から直接読めない', (select count(*) from (select 1) q where has_table_privilege('authenticated','public.organization_location_events','select') or has_table_privilege('authenticated','public.organization_billing_regime','select') or has_table_privilege('authenticated','public.hiring_process_billing_basis','select')) = 0);
end $$;

select count(*) filter (where ok) as pass, count(*) filter (where not ok) as fail from t_log;
rollback;
