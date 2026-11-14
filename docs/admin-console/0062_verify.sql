-- 0062（草案 v4）の検証。0060→0061→0062 を適用済みのローカルDBで実行し、最後にROLLBACKする。0061自体の検証は 0061_verify.sql。
\set ON_ERROR_STOP on
begin;
create temp table t_log (n serial, name text, ok boolean, info text);
grant all on t_log to public; grant all on sequence t_log_n_seq to public;
create or replace function pg_temp.chk(p_name text, p_ok boolean, p_info text default '') returns void language plpgsql as
$$ begin insert into t_log(name, ok, info) values (p_name, coalesce(p_ok,false), p_info); if not coalesce(p_ok,false) then raise notice 'FAIL % : %', p_name, p_info; end if; end $$;
create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$ begin execute p_sql; return 'OK'; exception when others then return sqlerrm; end $$;
-- ログイン済みユーザー(uid)として SQL を実行。結果は文字列、失敗は 'ERR:' || メッセージ
create or replace function pg_temp.as_user(p_uid text, p_sql text) returns text language plpgsql as $$
declare res text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
  set local role authenticated;
  begin execute p_sql into res; exception when others then res := 'ERR:' || sqlerrm; end;
  reset role;
  return coalesce(res, 'OK');
end $$;
create or replace function pg_temp.as_anon(p_sql text) returns text language plpgsql as $$
declare res text;
begin
  set local role anon;
  begin execute p_sql into res; exception when others then res := 'ERR:' || sqlerrm; end;
  reset role;
  return coalesce(res, 'OK');
end $$;
grant execute on function pg_temp.chk(text,boolean,text), pg_temp.try(text), pg_temp.as_user(text,text), pg_temp.as_anon(text) to public;

-- ---- 固定データ ----
-- 1=運営 2=オーナーA 3=会社管理者A 4=採用管理者A 5=エリア担当A(A1にstore_manager行) 6=A1店長 7=A1採用担当 8=A1閲覧のみ 9=オーナーB 10=美容師 11=別の美容師
-- 12=A2店長 13=エリア担当A(A1にviewer行のみ) 14=エリア担当A(店舗行なし) 15=エリア担当A(A2にrecruiter行のみ)
-- 16=オーナーC 17=採用管理者C 18=会社管理者C 19=エリア担当C 20=C店舗の店長
insert into auth.users (id, email, raw_user_meta_data) select ('00000000-0000-0000-0000-00000000f' || lpad(g::text,3,'0'))::uuid, 'u'||g||'@t', json_build_object('display_name','ユーザー'||g)::jsonb from generate_series(1,20) g;
insert into public.user_roles (user_id, role) select ('00000000-0000-0000-0000-00000000f' || lpad(g::text,3,'0'))::uuid, 'salon' from generate_series(2,9) g on conflict do nothing;
insert into public.user_roles (user_id, role) select ('00000000-0000-0000-0000-00000000f' || lpad(g::text,3,'0'))::uuid, 'salon' from generate_series(12,20) g on conflict do nothing;
insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-00000000f010','stylist'),('00000000-0000-0000-0000-00000000f011','stylist') on conflict do nothing;
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-00000000f001');
insert into public.salon_organizations (id, name) values ('00000000-0000-0000-0000-0000000f0a01','A社'),('00000000-0000-0000-0000-0000000f0b01','B社'),('00000000-0000-0000-0000-0000000f0c01','C社(13店)');
insert into public.salon_stores (id, organization_id, store_name) values
 ('00000000-0000-0000-0000-0000000f0a11','00000000-0000-0000-0000-0000000f0a01','A1'),('00000000-0000-0000-0000-0000000f0a12','00000000-0000-0000-0000-0000000f0a01','A2'),
 ('00000000-0000-0000-0000-0000000f0b11','00000000-0000-0000-0000-0000000f0b01','B1');
insert into public.salon_stores (id, organization_id, store_name) select ('00000000-0000-0000-0000-0000000f0c' || lpad(g::text,2,'0'))::uuid, '00000000-0000-0000-0000-0000000f0c01', 'C'||g from generate_series(11,23) g;
insert into public.organization_members (organization_id, user_id, role) values
 ('00000000-0000-0000-0000-0000000f0a01','00000000-0000-0000-0000-00000000f002','company_owner'),('00000000-0000-0000-0000-0000000f0a01','00000000-0000-0000-0000-00000000f003','company_admin'),
 ('00000000-0000-0000-0000-0000000f0a01','00000000-0000-0000-0000-00000000f004','recruiting_admin'),('00000000-0000-0000-0000-0000000f0a01','00000000-0000-0000-0000-00000000f005','area_manager'),
 ('00000000-0000-0000-0000-0000000f0a01','00000000-0000-0000-0000-00000000f013','area_manager'),('00000000-0000-0000-0000-0000000f0a01','00000000-0000-0000-0000-00000000f014','area_manager'),
 ('00000000-0000-0000-0000-0000000f0a01','00000000-0000-0000-0000-00000000f015','area_manager'),
 ('00000000-0000-0000-0000-0000000f0b01','00000000-0000-0000-0000-00000000f009','company_owner'),
 ('00000000-0000-0000-0000-0000000f0c01','00000000-0000-0000-0000-00000000f016','company_owner'),('00000000-0000-0000-0000-0000000f0c01','00000000-0000-0000-0000-00000000f017','recruiting_admin'),
 ('00000000-0000-0000-0000-0000000f0c01','00000000-0000-0000-0000-00000000f018','company_admin'),('00000000-0000-0000-0000-0000000f0c01','00000000-0000-0000-0000-00000000f019','area_manager');
insert into public.store_members (store_id, user_id, role) values
 ('00000000-0000-0000-0000-0000000f0a11','00000000-0000-0000-0000-00000000f005','store_manager'),
 ('00000000-0000-0000-0000-0000000f0a11','00000000-0000-0000-0000-00000000f006','store_manager'),('00000000-0000-0000-0000-0000000f0a11','00000000-0000-0000-0000-00000000f007','recruiter'),
 ('00000000-0000-0000-0000-0000000f0a11','00000000-0000-0000-0000-00000000f008','viewer'),('00000000-0000-0000-0000-0000000f0a12','00000000-0000-0000-0000-00000000f012','store_manager'),
 ('00000000-0000-0000-0000-0000000f0a11','00000000-0000-0000-0000-00000000f013','viewer'),('00000000-0000-0000-0000-0000000f0a12','00000000-0000-0000-0000-00000000f015','recruiter'),
 ('00000000-0000-0000-0000-0000000f0c11','00000000-0000-0000-0000-00000000f019','store_manager'),('00000000-0000-0000-0000-0000000f0c11','00000000-0000-0000-0000-00000000f020','store_manager');
insert into public.store_hiring_processes (id, store_id, stylist_user_id, status, source) values
 ('00000000-0000-0000-0000-0000000f5001','00000000-0000-0000-0000-0000000f0a11','00000000-0000-0000-0000-00000000f010','offered','interest');
insert into public.admin_visit_cases (id, stylist_user_id, store_id, hiring_process_id) values
 ('00000000-0000-0000-0000-0000000f2001','00000000-0000-0000-0000-00000000f010','00000000-0000-0000-0000-0000000f0a11','00000000-0000-0000-0000-0000000f5001'),
 ('00000000-0000-0000-0000-0000000f2002','00000000-0000-0000-0000-00000000f010','00000000-0000-0000-0000-0000000f0b11',null);

do $$
declare
  u text := '00000000-0000-0000-0000-00000000f';
  A text := '00000000-0000-0000-0000-0000000f0a01'; A1 text := '00000000-0000-0000-0000-0000000f0a11'; A2 text := '00000000-0000-0000-0000-0000000f0a12';
  B text := '00000000-0000-0000-0000-0000000f0b01'; C text := '00000000-0000-0000-0000-0000000f0c01';
  c1 text := '00000000-0000-0000-0000-0000000f2001'; c2 text := '00000000-0000-0000-0000-0000000f2002';
  adm text := '00000000-0000-0000-0000-00000000f001';
  r text; q uuid; inv uuid; inv2 uuid; ln uuid; ln2 uuid; inv3 uuid; lh uuid; lv uuid; n int;
begin
  ---- 直接アクセス拒否・実行権限（0062の表・関数） ----
  for r in select unnest(array['admin_invoices','admin_invoice_lines','admin_invoice_checkouts','admin_invoice_webhook_events','admin_unresolved_billing_cases','admin_quotes']) loop
    perform pg_temp.chk('Q1 authenticated/anon は直接読めない: ' || r, pg_temp.as_user(u||'002', format('select count(*) from public.%I', r)) like 'ERR:permission denied%' and pg_temp.as_anon(format('select count(*) from public.%I', r)) like 'ERR:permission denied%');
  end loop;
  perform pg_temp.chk('Q2 公開RPC(14本)は authenticated のみ実行可（所有者を除く。anon/service_role/PUBLICは不可）', (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace
      and p.proname in ('admin_propose_quote','admin_withdraw_quote','admin_create_invoice','admin_add_fee_line','admin_add_registration_line','admin_void_line','admin_advance_invoice','company_list_quotes','company_respond_quote','billing_list_invoices','billing_begin_checkout','admin_correct_hire_line','admin_recalculate_registration_line','admin_flag_billing_case')
      and (select coalesce(string_agg(case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, ','), '') from aclexplode(p.proacl) a where a.privilege_type='EXECUTE' and a.grantee <> p.proowner) = 'authenticated') = 14);
  perform pg_temp.chk('Q3 内部関数(9本)は誰にも実行権限が無い（所有者以外）', (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace
      and p.proname in ('_admin_tax','_admin_org_billing_actor','_admin_invoice_payable_by','_admin_quotes_rules','_admin_invoice_line_rules','_admin_invoice_requires_amounts','registration_fee_for_store_count','_admin_visit_case_fee_guard','_admin_assert_invoice_correctable')
      and exists (select 1 from aclexplode(p.proacl) a where a.privilege_type='EXECUTE' and a.grantee <> p.proowner)) = 0);
  perform pg_temp.chk('Q4 一般ユーザーは内部関数を直接呼べない', pg_temp.as_user(u||'002', $q$select public._admin_org_billing_actor(gen_random_uuid(), gen_random_uuid())$q$) like 'ERR:permission denied%' and pg_temp.as_user(u||'002', $q$select public._admin_assert_invoice_correctable(gen_random_uuid())$q$) like 'ERR:permission denied%');
  perform pg_temp.chk('Q5 service_role は公開RPCを実行できない', not has_function_privilege('service_role','public.admin_correct_hire_line(uuid,text)','execute') and not has_function_privilege('service_role','public.billing_begin_checkout(uuid)','execute') and not has_function_privilege('service_role','public.admin_advance_invoice(uuid,text)','execute'));


  perform pg_temp.chk('S1 登録手数料の段階（税抜）', public.registration_fee_for_store_count(1)=10000 and public.registration_fee_for_store_count(3)=10000 and public.registration_fee_for_store_count(4)=20000 and public.registration_fee_for_store_count(6)=20000 and public.registration_fee_for_store_count(7)=30000 and public.registration_fee_for_store_count(9)=30000 and public.registration_fee_for_store_count(10)=40000 and public.registration_fee_for_store_count(12)=40000);
  perform pg_temp.chk('S2 13店舗以上・0・NULLは金額未確定(NULL)', public.registration_fee_for_store_count(13) is null and public.registration_fee_for_store_count(40) is null and public.registration_fee_for_store_count(0) is null and public.registration_fee_for_store_count(null) is null);
  -- 見積（13店舗以上）
  perform pg_temp.chk('S3 13店舗未満の会社に見積は作れない', pg_temp.as_user(adm, format($q$select public.admin_propose_quote('%s', 100000, 'x')$q$, A)) = 'ERR:quote not required (fewer than 13 stores)');
  perform pg_temp.chk('S4 運営者以外は見積を作れない', pg_temp.as_user(u||'016', format($q$select public.admin_propose_quote('%s', 100000, 'x')$q$, C)) = 'ERR:admin access required');
  r := pg_temp.as_user(adm, format($q$select public.admin_create_invoice('%s')$q$, C)); inv2 := r::uuid;
  perform pg_temp.chk('S5 見積の合意前は、13店舗以上の登録手数料の請求行を作れない（RPCも直接も）', pg_temp.as_user(adm, format($q$select public.admin_add_registration_line('%s')$q$, inv2)) = 'ERR:agreed quote required'
    and pg_temp.try(format($q$insert into public.admin_invoice_lines (invoice_id, organization_id, fee_kind, amount_excl_tax, tax_amount, total_amount) values ('%s','%s','registration',1200000,120000,1320000)$q$, inv2, C)) = 'agreed quote required');
  r := pg_temp.as_user(adm, format($q$select public.admin_propose_quote('%s', 1200000, '13店舗の個別見積')$q$, C)); q := r::uuid;
  perform pg_temp.chk('S6 運営が見積を提案できる（提案の段階では請求行を作れない）', r !~ '^ERR' and pg_temp.as_user(adm, format($q$select public.admin_add_registration_line('%s')$q$, inv2)) = 'ERR:agreed quote required', r);
  perform pg_temp.chk('S7 合意できるのは company_owner / company_admin のみ。採用管理者・エリア担当・店長・他社・美容師・運営者は not found', (select count(*) from unnest(array[17,19,20,9,10,1]) x where pg_temp.as_user(u||lpad(x::text,3,'0'), format($q$select public.company_respond_quote('%s', true)$q$, q)) = 'ERR:not found') = 6
    and (select status from public.admin_quotes where id = q) = 'proposed');
  perform pg_temp.chk('S8 見積の一覧も、支払い権限者以外は not found', (select count(*) from unnest(array[17,19,20,9,10,1]) x where pg_temp.as_user(u||lpad(x::text,3,'0'), format($q$select public.company_list_quotes('%s')$q$, C)) = 'ERR:not found') = 6
    and (pg_temp.as_user(u||'018', format($q$select public.company_list_quotes('%s')$q$, C))::jsonb)->0->>'amount_excl_tax' = '1200000');
  perform pg_temp.chk('S9 見積の金額・店舗数は後から変更できない／直接の合意（権限の無い人）もトリガーで拒否', pg_temp.try(format($q$update public.admin_quotes set amount_excl_tax = 1 where id = '%s'$q$, q)) = 'quote terms cannot be changed'
    and pg_temp.try(format($q$update public.admin_quotes set status='agreed', agreed_by='%s', agreed_at=now() where id='%s'$q$, u||'017', q)) = 'only company owner or admin can agree');
  insert into public.salon_stores (id, organization_id, store_name) values ('00000000-0000-0000-0000-0000000f0c99', C::uuid, 'C14');
  perform pg_temp.chk('S10 合意前に店舗数が変わると、合意できない', pg_temp.as_user(u||'016', format($q$select public.company_respond_quote('%s', true)$q$, q)) like 'ERR:%store count changed%');
  delete from public.salon_stores where id = '00000000-0000-0000-0000-0000000f0c99';
  r := pg_temp.as_user(u||'016', format($q$select public.company_respond_quote('%s', true)$q$, q));
  perform pg_temp.chk('S11 company_owner が合意できる', r !~ '^ERR' and (select status from public.admin_quotes where id = q) = 'agreed');
  perform pg_temp.chk('S12 合意済みの見積は再度応答できない／新しい見積は、合意済みがあると作れない', pg_temp.as_user(u||'016', format($q$select public.company_respond_quote('%s', false)$q$, q)) = 'ERR:quote is not open'
    and pg_temp.as_user(adm, format($q$select public.admin_propose_quote('%s', 999999, 'x')$q$, C)) = 'ERR:an agreed quote already exists');
  insert into public.salon_stores (id, organization_id, store_name) values ('00000000-0000-0000-0000-0000000f0c98', C::uuid, 'C14b');
  perform pg_temp.chk('S13 合意後に店舗数が変わると、請求行を作れない（個別確認）', pg_temp.as_user(adm, format($q$select public.admin_add_registration_line('%s')$q$, inv2)) like 'ERR:%store count changed%');
  delete from public.salon_stores where id = '00000000-0000-0000-0000-0000000f0c98';
  r := pg_temp.as_user(adm, format($q$select public.admin_add_registration_line('%s')$q$, inv2)); ln := r::uuid;
  perform pg_temp.chk('S14 合意後は、見積の金額で請求行ができる（税10%・合計）', r !~ '^ERR' and (select amount_excl_tax||'/'||tax_amount||'/'||total_amount from public.admin_invoice_lines where id = ln) = '1200000/120000/1320000', r);
  perform pg_temp.chk('S15 同じ見積・同じ会社の登録手数料は二重に請求できない（同じ請求への再試行は同じ行を返し、別の請求では拒否）', pg_temp.as_user(adm, format($q$select public.admin_add_registration_line('%s')$q$, inv2)) = ln::text
    and (select count(*) from public.admin_invoice_lines where invoice_id = inv2 and fee_kind='registration' and voided_at is null) = 1);
  perform pg_temp.chk('S16 違う金額の行は直接でも作れない（見積と不一致・税の不一致）', pg_temp.try(format($q$insert into public.admin_invoices (organization_id, created_by) values ('%s','%s')$q$, B, adm)) = 'OK'
    and pg_temp.try(format($q$insert into public.admin_invoice_lines (invoice_id, organization_id, fee_kind, amount_excl_tax, tax_amount, total_amount) select id,'%s','registration',10000,1000,11000 from public.admin_invoices where organization_id='%s' limit 1$q$, B, B)) = 'OK'
    and pg_temp.try(format($q$update public.admin_invoice_lines set total_amount = 1 where id = '%s'$q$, ln)) in ('invoice line cannot be modified') );
  -- 請求の進行と支払い権限
  perform pg_temp.chk('S17 下書き・運営確認中の請求は、会社側の一覧に出ず、支払いも開始できない', jsonb_array_length(pg_temp.as_user(u||'016', format($q$select public.billing_list_invoices('%s')$q$, C))::jsonb) = 0
    and pg_temp.as_user(u||'016', format($q$select public.billing_begin_checkout('%s')$q$, inv2)) = 'ERR:invoice is not payable');
  perform pg_temp.chk('S18 状態は 下書き→運営確認→確定→支払い待ち の順にだけ進む（飛ばせない）', pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','finalized')$q$, inv2)) = 'ERR:invalid invoice transition'
    and pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','admin_confirmed')$q$, inv2)) !~ '^ERR'
    and pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','payment_pending')$q$, inv2)) = 'ERR:invalid invoice transition');
  perform pg_temp.chk('S19 運営確認者が記録される／運営者以外は進められない', (select confirmed_by::text from public.admin_invoices where id = inv2) = adm and pg_temp.as_user(u||'016', format($q$select public.admin_advance_invoice('%s','finalized')$q$, inv2)) = 'ERR:admin access required');
  perform pg_temp.chk('S20 確定後は請求行の追加・取消ができない', pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','finalized')$q$, inv2)) !~ '^ERR'
    and pg_temp.as_user(adm, format($q$select public.admin_void_line('%s')$q$, ln)) like 'ERR:%not editable%'
    and pg_temp.try(format($q$insert into public.admin_invoice_lines (invoice_id, organization_id, fee_kind, amount_excl_tax, tax_amount, total_amount) values ('%s','%s','registration',1,0,1)$q$, inv2, C)) = 'invoice is not editable');
  perform pg_temp.chk('S21 確定済みでも「支払い待ち」にするまで、会社は決済を開始できない（請求の作成・確定だけでは課金しない）', pg_temp.as_user(u||'016', format($q$select public.billing_begin_checkout('%s')$q$, inv2)) = 'ERR:invoice is not payable'
    and (select count(*) from public.admin_invoice_checkouts where invoice_id = inv2) = 0);
  perform pg_temp.chk('S22 確定した請求は会社側の一覧に出る（会社・店舗・料金区分・税抜・税・合計）', (pg_temp.as_user(u||'018', format($q$select public.billing_list_invoices('%s')$q$, C))::jsonb)->0->'lines'->0 ?& array['fee_kind','amount_excl_tax','tax_amount','total_amount']);
  perform pg_temp.chk('S23 支払い待ちにする', pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','payment_pending')$q$, inv2)) !~ '^ERR');
  perform pg_temp.chk('S24 支払える権限者以外は not found（採用管理者・エリア担当・店長・他社・美容師・運営者）', (select count(*) from unnest(array[17,19,20,9,10,1]) x where pg_temp.as_user(u||lpad(x::text,3,'0'), format($q$select public.billing_begin_checkout('%s')$q$, inv2)) = 'ERR:not found') = 6
    and (select count(*) from public.admin_invoice_checkouts where invoice_id = inv2) = 0);
  perform pg_temp.chk('S25 company_admin は支払いを開始でき、金額はDBの請求から計算される', (pg_temp.as_user(u||'018', format($q$select public.billing_begin_checkout('%s')$q$, inv2))::jsonb->>'expected_amount') = '1320000');
  perform pg_temp.chk('S26 同じ請求に同時に進行中の決済は1つだけ（二重決済の防止）。再試行は同じ受付を返す', (pg_temp.as_user(u||'016', format($q$select public.billing_begin_checkout('%s')$q$, inv2))::jsonb->>'existing') = 'true'
    and (select count(*) from public.admin_invoice_checkouts where invoice_id = inv2) = 1);
  perform pg_temp.chk('S27 決済の進行中は、請求を取り消せない。支払い待ちへの再実行は何も変えない', pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','cancelled')$q$, inv2)) = 'ERR:checkout in progress'
    and pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','finalized')$q$, inv2)) = 'ERR:invalid invoice transition');
  -- 見学料・採用料
  r := pg_temp.as_user(adm, format($q$select public.admin_create_invoice('%s')$q$, A)); inv := r::uuid;
  perform pg_temp.chk('S28 実施確認前の案件に見学料は作れない', pg_temp.as_user(adm, format($q$select public.admin_add_fee_line('%s','visit','%s')$q$, inv, c1)) = 'ERR:visit is not confirmed');
  update public.admin_visit_cases set status='visit_confirmed', visit_confirmed_at = now() where id = c1::uuid;
  r := pg_temp.as_user(adm, format($q$select public.admin_add_fee_line('%s','visit','%s')$q$, inv, c1));
  perform pg_temp.chk('S29 実施確認済みなら見学料(5万・税抜)の行ができる。対象店舗が内訳に入る', r !~ '^ERR' and (select amount_excl_tax||'/'||tax_amount||'/'||total_amount||'/'||store_id from public.admin_invoice_lines where id = r::uuid) = '50000/5000/55000/'||A1, r);
  perform pg_temp.chk('S30 同じ案件×見学料の二重請求は作らない（同じ請求への再試行は同じ行を返す）', pg_temp.as_user(adm, format($q$select public.admin_add_fee_line('%s','visit','%s')$q$, inv, c1))::uuid = r::uuid
    and (select count(*) from public.admin_invoice_lines where invoice_id = inv and fee_kind='visit' and voided_at is null) = 1);
  perform pg_temp.chk('S31 採用が確定していない案件に採用料は作れない', pg_temp.as_user(adm, format($q$select public.admin_add_fee_line('%s','hire_stylist','%s')$q$, inv, c1)) = 'ERR:hire is not confirmed');
  perform pg_temp.chk('S31b 「採用成立(hired)」だけでは採用料にできない（両者の意向がない）', (select pg_temp.try(format($q$update public.admin_visit_cases set hiring_decision = 'hired' where id = '%s'$q$, c1)) = 'OK') and pg_temp.as_user(adm, format($q$select public.admin_add_fee_line('%s','hire_stylist','%s')$q$, inv, c1)) = 'ERR:hire is not confirmed');
  update public.admin_visit_cases set stylist_intent = 'interested', salon_intent = 'interested', hiring_decision = 'offered' where id = c1::uuid;   -- 運営が両者の意向を確認＋サロンのオファー意思
  r := pg_temp.as_user(adm, format($q$select public.admin_add_fee_line('%s','hire_stylist','%s')$q$, inv, c1));
  perform pg_temp.chk('S32 採用確定後、採用料(スタイリスト55万/アシスタント45万)が見学料と別の行で併存できる（差し引かない）', r !~ '^ERR'
    and (select sum(total_amount) from public.admin_invoice_lines where invoice_id = inv and voided_at is null) = 55000 + 605000);
  perform pg_temp.chk('S33 採用料は1案件に1行だけ（スタイリストとアシスタントの両方は請求できない）', pg_temp.as_user(adm, format($q$select public.admin_add_fee_line('%s','hire_assistant','%s')$q$, inv, c1)) like 'ERR:%admin_invoice_lines_one_hire_per_case%');
  perform pg_temp.chk('S34 他社の案件は請求行にできない', pg_temp.as_user(adm, format($q$select public.admin_add_fee_line('%s','visit','%s')$q$, inv, c2)) like 'ERR:%belong%');
  perform pg_temp.chk('S35 金額・税の不整合は拒否（直接）', pg_temp.try(format($q$insert into public.admin_invoice_lines (invoice_id, organization_id, fee_kind, amount_excl_tax, tax_amount, total_amount) values ('%s','%s','registration',10000,1000,99)$q$, inv, A)) like '%violates check%');
  perform pg_temp.chk('S36 金額が規則と違う行は拒否（見学料1円／採用料の別金額／税の不一致を直接作る）', pg_temp.try(format($q$insert into public.admin_invoice_lines (invoice_id, organization_id, visit_case_id, fee_kind, amount_excl_tax, tax_amount, total_amount) values ('%s','%s','%s','visit',1,0,1)$q$, inv, A, c1)) = 'amount does not match fee rule'
    and pg_temp.try(format($q$insert into public.admin_invoice_lines (invoice_id, organization_id, visit_case_id, fee_kind, amount_excl_tax, tax_amount, total_amount) values ('%s','%s','%s','hire_stylist',500000,50000,550000)$q$, inv, A, c1)) = 'amount does not match fee rule'
    and pg_temp.try(format($q$insert into public.admin_invoice_lines (invoice_id, organization_id, visit_case_id, fee_kind, amount_excl_tax, tax_amount, total_amount) values ('%s','%s','%s','visit',50000,1,50001)$q$, inv, A, c1)) = 'tax amount does not match tax rule');
  perform pg_temp.chk('S37 登録手数料は店舗数で決まる（A社2店→1万円）。違う金額は拒否', pg_temp.try(format($q$insert into public.admin_invoice_lines (invoice_id, organization_id, fee_kind, amount_excl_tax, tax_amount, total_amount) values ('%s','%s','registration',20000,2000,22000)$q$, inv, A)) = 'amount does not match fee rule'
    and pg_temp.as_user(adm, format($q$select public.admin_add_registration_line('%s')$q$, inv)) !~ '^ERR');
  insert into public.salon_organizations (id, name) values ('00000000-0000-0000-0000-0000000f0d01','D社');
  insert into public.salon_stores (organization_id, store_name) values ('00000000-0000-0000-0000-0000000f0d01','D1');
  insert into public.admin_invoices (id, organization_id, created_by) values ('00000000-0000-0000-0000-0000000f4001','00000000-0000-0000-0000-0000000f0d01',adm::uuid);
  insert into public.admin_invoice_lines (invoice_id, organization_id, fee_kind, quote_required) values ('00000000-0000-0000-0000-0000000f4001','00000000-0000-0000-0000-0000000f0d01','registration',true);
  perform pg_temp.chk('S38 個別見積の行（quote_required・金額未確定）を含む請求は確定に進めない', pg_temp.try($q$update public.admin_invoices set status='finalized', confirmed_by='00000000-0000-0000-0000-00000000f001' where id='00000000-0000-0000-0000-0000000f4001'$q$) = 'invoice has lines without a confirmed amount');
  perform pg_temp.chk('S39 決済失敗・取消・返金は支払い完了と別の状態', exists (select 1 from pg_constraint where conrelid='public.admin_invoices'::regclass and pg_get_constraintdef(oid) like '%payment_failed%refunded%'));
  insert into public.admin_invoice_webhook_events (stripe_event_id) values ('evt_abc123');
  perform pg_temp.chk('S40 同じ決済通知の重複処理は拒否', pg_temp.try($q$insert into public.admin_invoice_webhook_events (stripe_event_id) values ('evt_abc123')$q$) like '%duplicate key%');
  perform pg_temp.chk('S41 カード番号・セキュリティコードを持つ列が無い', not exists (select 1 from information_schema.columns where table_schema='public' and table_name like 'admin_%' and (column_name ~* 'card_?number|cvc|cvv|security_code|pan$')));

  ---- v3: 採用料の条件・請求後の案件変更・訂正（状態別）・取消による行の解放 ----
  -- 現在: inv は A社の下書き（見学料・採用料(スタイリスト)・登録手数料を含む）。case c1 は intents=interested/interested, hiring_decision=offered
  perform pg_temp.chk('T1 サロンのオファー意思だけ（美容師の意向なし）では採用料にできない', (
    select pg_temp.try(format($q$update public.admin_visit_cases set stylist_intent = 'undecided' where id = '%s'$q$, c1)) = 'OK') and
    (select count(*) from public.admin_invoice_lines where invoice_id = inv and voided_at is null and fee_kind = 'hire_stylist') = 1);   -- 下書きの間は案件の変更自体は可能
  r := pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','admin_confirmed')$q$, inv));
  perform pg_temp.chk('T2 下書きの間に条件が崩れた採用料は、運営確認へ進めない（再確認）', r = 'ERR:hire is not confirmed', r);
  update public.admin_visit_cases set stylist_intent = 'interested' where id = c1::uuid;
  update public.admin_visit_cases set hiring_decision = 'declined' where id = c1::uuid;
  perform pg_temp.chk('T3 オファーが取り下げられた採用料も、運営確認へ進めない', pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','admin_confirmed')$q$, inv)) = 'ERR:hire is not confirmed');
  update public.admin_visit_cases set hiring_decision = 'hired' where id = c1::uuid;
  perform pg_temp.chk('T4 hired（採用成立）になっていても両者の意向とオファーが揃っていれば進める／運営確認の記録', pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','admin_confirmed')$q$, inv)) !~ '^ERR');
  -- 運営確認後は、行が変わらない
  r := pg_temp.as_user(adm, format($q$select public.admin_add_fee_line('%s','visit','%s')$q$, inv, c1));
  perform pg_temp.chk('T5a 運営確認後は請求行が増えない（再試行は既存の行を返すだけ）', r !~ '^ERR' and (select count(*) from public.admin_invoice_lines where invoice_id = inv and voided_at is null) = 3, r);
  lv := (select id from public.admin_invoice_lines where invoice_id = inv and fee_kind = 'visit' and voided_at is null); lh := (select id from public.admin_invoice_lines where invoice_id = inv and fee_kind = 'hire_stylist' and voided_at is null);
  r := pg_temp.as_user(adm, format($q$select public.admin_void_line('%s')$q$, lv));
  perform pg_temp.chk('T5b 運営確認後は請求行を取り消せない', r like 'ERR:%not editable%', r);
  r := pg_temp.as_user(adm, format($q$select public.admin_correct_hire_line('%s', 'hire_assistant')$q$, lh));
  perform pg_temp.chk('T5c 運営確認後は採用料の役割を訂正できない（取消して作り直す案内）', r = 'ERR:invoice is confirmed; cancel it and create a new draft', r);
  perform pg_temp.chk('T6 請求済みの案件の、実施確認・意向・採用判断の変更は拒否。内部メモ等の変更は可', pg_temp.try(format($q$update public.admin_visit_cases set hiring_decision = 'declined' where id = '%s'$q$, c1)) like 'case has an invoiced fee%'
    and pg_temp.try(format($q$update public.admin_visit_cases set visit_confirmed_at = null, status = 'scheduled' where id = '%s'$q$, c1)) like '%invoiced fee%'
    and pg_temp.try(format($q$update public.admin_visit_cases set stylist_intent = 'not_interested' where id = '%s'$q$, c1)) like 'case has an invoiced fee%'
    and pg_temp.try(format($q$update public.admin_visit_cases set internal_note = 'メモ' where id = '%s'$q$, c1)) = 'OK');
  perform pg_temp.chk('T7 運営確認済みの請求を、そのまま確定→支払い待ちへ進めても、行は変わらない（3行・合計）', pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','finalized')$q$, inv)) !~ '^ERR'
    and (select count(*) from public.admin_invoice_lines where invoice_id = inv and voided_at is null) = 3);
  -- 確定後の訂正は「取消→新しい下書き」。取消で行が解放され、案件の変更もできるようになる
  perform pg_temp.chk('T8 確定後の訂正は請求の取消→作り直し（役割の訂正はそのままでは不可）', pg_temp.as_user(adm, format($q$select public.admin_correct_hire_line('%s', 'hire_assistant')$q$, lh)) = 'ERR:invoice is confirmed; cancel it and create a new draft');
  r := pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','cancelled')$q$, inv));
  perform pg_temp.chk('T9 請求を取消すと行が解放される（二重請求防止の対象外になる）', r !~ '^ERR'
    and (select count(*) from public.admin_invoice_lines where invoice_id = inv and voided_at is null) = 0 and (select status from public.admin_invoices where id = inv) = 'cancelled', r);
  perform pg_temp.chk('T10 取消済みの請求は変更・訂正できない', pg_temp.as_user(adm, format($q$select public.admin_add_fee_line('%s','visit','%s')$q$, inv, c1)) like 'ERR:%not editable%'
    and pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','draft')$q$, inv)) = 'ERR:invalid invoice transition');
  r := pg_temp.as_user(adm, format($q$select public.admin_create_invoice('%s')$q$, A)); inv3 := r::uuid;
  update public.admin_visit_cases set hiring_decision = 'offered' where id = c1::uuid;     -- 取消後は案件の変更も可
  perform pg_temp.chk('T11 取消後は、同じ案件・料金区分で新しい下書きに作り直せる（役割も変えられる）', pg_temp.as_user(adm, format($q$select public.admin_add_fee_line('%s','visit','%s')$q$, inv3, c1)) !~ '^ERR'
    and pg_temp.as_user(adm, format($q$select public.admin_add_fee_line('%s','hire_stylist','%s')$q$, inv3, c1)) !~ '^ERR');
  -- 下書きの訂正
  ln := (select id from public.admin_invoice_lines where invoice_id = inv3 and fee_kind = 'hire_stylist' and voided_at is null);
  r := pg_temp.as_user(adm, format($q$select public.admin_correct_hire_line('%s','hire_assistant')$q$, ln));
  perform pg_temp.chk('T12 下書きでは採用料の役割を訂正できる（スタイリスト55万→アシスタント45万。旧行は取消）', r !~ '^ERR'
    and (select voided_at is not null from public.admin_invoice_lines where id = ln)
    and (select amount_excl_tax from public.admin_invoice_lines where id = r::uuid) = 450000
    and (select count(*) from public.admin_invoice_lines where invoice_id = inv3 and voided_at is null and fee_kind like 'hire%') = 1, r);
  perform pg_temp.chk('T13 同じ役割への訂正・存在しない行・運営者以外は拒否', pg_temp.as_user(adm, format($q$select public.admin_correct_hire_line('%s','hire_assistant')$q$, r::uuid)) = 'ERR:no change'
    and pg_temp.as_user(adm, format($q$select public.admin_correct_hire_line('%s','hire_stylist')$q$, ln)) = 'ERR:line not found'
    and pg_temp.as_user(u||'016', format($q$select public.admin_correct_hire_line('%s','hire_stylist')$q$, r::uuid)) = 'ERR:admin access required'
    and pg_temp.as_user(adm, format($q$select public.admin_correct_hire_line('%s','visit')$q$, r::uuid)) = 'ERR:invalid fee kind');
  perform pg_temp.chk('T14 取消した行は元に戻せない（直接でも）', pg_temp.try(format($q$update public.admin_invoice_lines set voided_at = null where id = '%s'$q$, ln)) = 'voided line cannot be restored');
  -- 登録手数料の再計算（下書き）
  r := pg_temp.as_user(adm, format($q$select public.admin_add_registration_line('%s')$q$, inv3)); ln2 := r::uuid;
  insert into public.salon_stores (organization_id, store_name) select A::uuid, 'A'||g from generate_series(3,4) g;   -- 4店になる → 登録手数料は2万円の段階
  r := pg_temp.as_user(adm, format($q$select public.admin_recalculate_registration_line('%s')$q$, ln2));
  perform pg_temp.chk('T15 店舗数が変わった下書きの登録手数料は、取り消して作り直せる（4店→2万円）', r !~ '^ERR' and (select amount_excl_tax from public.admin_invoice_lines where id = r::uuid) = 20000
    and (select voided_at is not null from public.admin_invoice_lines where id = ln2), r);
  -- 決済の進行中
  perform pg_temp.chk('T16 下書きの請求は決済できない／運営確認→確定→支払い待ち', pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','admin_confirmed')$q$, inv3)) !~ '^ERR'
    and pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','finalized')$q$, inv3)) !~ '^ERR'
    and pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','payment_pending')$q$, inv3)) !~ '^ERR');
  r := pg_temp.as_user(u||'002', format($q$select public.billing_begin_checkout('%s')$q$, inv3));
  perform pg_temp.chk('T17 決済開始（受付のみ。課金はしない）', r !~ '^ERR' and (select count(*) from public.admin_invoice_checkouts where invoice_id = inv3 and status = 'pending') = 1, r);
  lh := (select id from public.admin_invoice_lines where invoice_id = inv3 and fee_kind like 'hire%' and voided_at is null);
  perform pg_temp.chk('T18 決済の進行中は、請求の取消・訂正ができない', pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','cancelled')$q$, inv3)) = 'ERR:checkout in progress'
    and pg_temp.as_user(adm, format($q$select public.admin_correct_hire_line('%s', 'hire_stylist')$q$, lh)) = 'ERR:checkout in progress'
    and (select count(*) from public.admin_invoice_lines where invoice_id = inv3 and voided_at is null) = 3);
  update public.admin_invoice_checkouts set status = 'needs_review' where invoice_id = inv3;
  perform pg_temp.chk('T19 決済が要確認の間も取消できない', pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','cancelled')$q$, inv3)) = 'ERR:checkout in progress');
  update public.admin_invoice_checkouts set status = 'expired' where invoice_id = inv3;
  r := pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','cancelled')$q$, inv3));
  perform pg_temp.chk('T20 決済が失効したら、取消できる（行が解放される）', r !~ '^ERR'
    and (select count(*) from public.admin_invoice_lines where invoice_id = inv3 and voided_at is null) = 0, r);
  -- 支払い済み: 訂正不可
  r := pg_temp.as_user(adm, format($q$select public.admin_create_invoice('%s')$q$, A)); inv3 := r::uuid;
  perform pg_temp.as_user(adm, format($q$select public.admin_add_fee_line('%s','visit','%s')$q$, inv3, c1));
  perform pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','admin_confirmed')$q$, inv3));
  perform pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','finalized')$q$, inv3));
  perform pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','payment_pending')$q$, inv3));
  update public.admin_invoices set status = 'paid', paid_at = now() where id = inv3;      -- 決済通知の処理（アプリ）が行う遷移を模す
  lh := (select id from public.admin_invoice_lines where invoice_id = inv3 and voided_at is null limit 1);
  r := pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','cancelled')$q$, inv3));
  perform pg_temp.chk('T21a 支払い済みの請求は取消できない', r = 'ERR:invalid invoice transition', r);
  r := pg_temp.as_user(adm, format($q$select public.admin_correct_hire_line('%s', 'hire_stylist')$q$, lh));
  perform pg_temp.chk('T21b 支払い済みの請求の行は訂正できない', r like 'ERR:%', r);
  r := pg_temp.try(format($q$update public.admin_invoice_lines set voided_at = now() where invoice_id = '%s'$q$, inv3));
  perform pg_temp.chk('T21c 支払い済みの請求の行は取り消せない（直接でも）', r = 'invoice is not editable', r);
  r := pg_temp.try(format($q$update public.admin_visit_cases set visit_confirmed_at = null, status='scheduled' where id = '%s'$q$, c1));
  perform pg_temp.chk('T21d 支払い済みの案件の実施確認は取り消せない', r like '%invoiced fee%', r);
  -- 見積の取下げ
  perform pg_temp.chk('T22 使用中の見積は取り下げられない／行を取り消した後は取り下げられる', pg_temp.as_user(adm, format($q$select public.admin_withdraw_quote('%s')$q$, q)) = 'ERR:quote is used by an invoice line'
    and pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','cancelled')$q$, inv2)) = 'ERR:checkout in progress');

  ---- v4: 通常進行・決済の二重防止・再試行・1採用1行・権限 ----
  declare
    c3 text := '00000000-0000-0000-0000-0000000f2003'; c4 text := '00000000-0000-0000-0000-0000000f2004'; c5 text := '00000000-0000-0000-0000-0000000f2005';
    p3 text := '00000000-0000-0000-0000-0000000f5003'; A2s text := '00000000-0000-0000-0000-0000000f0a12';
    v4inv uuid; v4inv2 uuid; vl uuid; vh uuid; ck jsonb; n1 int; n2 int; rid uuid := gen_random_uuid(); rr text;
  begin
  insert into public.store_hiring_processes (id, store_id, stylist_user_id, status, source) values (p3::uuid, A2s::uuid, (u||'011')::uuid, 'offered', 'interest');
  insert into public.admin_visit_cases (id, stylist_user_id, store_id, hiring_process_id, status, visit_confirmed_at, stylist_intent, salon_intent, hiring_decision) values
    (c3::uuid, (u||'011')::uuid, A2s::uuid, p3::uuid, 'visit_confirmed', now(), 'interested', 'interested', 'offered'),
    (c4::uuid, (u||'011')::uuid, A2s::uuid, p3::uuid, 'visit_confirmed', now(), 'interested', 'interested', 'offered'),   -- 同じ採用進行への2件目の見学案件
    (c5::uuid, (u||'010')::uuid, A2s::uuid, null, 'scheduled', null, 'interested', 'interested', 'offered');
  -- V1 請求後でも、内定→入社(採用成立)の通常進行は止まらない。根拠そのものの変更は止まる
  r := pg_temp.as_user(adm, format($q$select public.admin_create_invoice('%s')$q$, A)); v4inv := r::uuid;
  vl := pg_temp.as_user(adm, format($q$select public.admin_add_fee_line('%s','visit','%s')$q$, v4inv, c3))::uuid;
  vh := pg_temp.as_user(adm, format($q$select public.admin_add_fee_line('%s','hire_stylist','%s')$q$, v4inv, c3))::uuid;
  perform pg_temp.chk('V1a 採用料の行に、案件の採用進行(hiring_process_id)が記録される', (select hiring_process_id::text from public.admin_invoice_lines where id = vh) = p3);
  perform pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','admin_confirmed')$q$, v4inv));
  perform pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','finalized')$q$, v4inv));
  perform pg_temp.chk('V1b 請求(確定)後でも 内定(offered)→採用成立(hired) に進める', pg_temp.try(format($q$update public.admin_visit_cases set hiring_decision = 'hired' where id = '%s'$q$, c3)) = 'OK');
  perform pg_temp.chk('V1c 請求後の internal_note・実施メモ等の更新は可', pg_temp.try(format($q$update public.admin_visit_cases set internal_note = 'x' where id = '%s'$q$, c3)) = 'OK');
  perform pg_temp.chk('V1d 採用成立から内定への戻しは拒否（請求の訂正が必要）', pg_temp.try(format($q$update public.admin_visit_cases set hiring_decision = 'offered' where id = '%s'$q$, c3)) like 'case has an invoiced fee%');
  perform pg_temp.chk('V1e 辞退・不採用・保留への変更、意向の撤回は拒否', (select count(*) from unnest(array['declined','rejected','selection']) d where pg_temp.try(format($q$update public.admin_visit_cases set hiring_decision = '%s' where id = '%s'$q$, d, c3)) like 'case has an invoiced fee%') = 3
    and pg_temp.try(format($q$update public.admin_visit_cases set salon_intent = 'undecided' where id = '%s'$q$, c3)) like 'case has an invoiced fee%'
    and pg_temp.try(format($q$update public.admin_visit_cases set stylist_intent = 'not_interested' where id = '%s'$q$, c3)) like 'case has an invoiced fee%');
  perform pg_temp.chk('V1f 請求の根拠（店舗・美容師・採用進行）の付け替えと、案件の取消は拒否', pg_temp.try(format($q$update public.admin_visit_cases set store_id = '%s' where id = '%s'$q$, A1, c3)) like 'case has an invoiced fee%'
    and pg_temp.try(format($q$update public.admin_visit_cases set stylist_user_id = '%s' where id = '%s'$q$, u||'010', c3)) like 'case has an invoiced fee%'
    and pg_temp.try(format($q$update public.admin_visit_cases set hiring_process_id = null where id = '%s'$q$, c3)) like 'case has an invoiced fee%'
    and pg_temp.try(format($q$update public.admin_visit_cases set status = 'cancelled' where id = '%s'$q$, c3)) like 'case has an invoiced fee%'
    and pg_temp.try(format($q$update public.admin_visit_cases set visit_confirmed_at = null where id = '%s'$q$, c3)) like 'case has an invoiced fee%');
  perform pg_temp.chk('V1g 請求済みの採用の行は、案件がhiredになっても変わらない（行・金額）', (select count(*) from public.admin_invoice_lines where invoice_id = v4inv and voided_at is null) = 2 and (select amount_excl_tax from public.admin_invoice_lines where id = vh) = 550000);
  -- V4 1採用＝1つの採用進行(store_hiring_processes.id)。別の見学案件に紐づけても採用料は二重にならない
  r := pg_temp.as_user(adm, format($q$select public.admin_create_invoice('%s')$q$, A)); v4inv2 := r::uuid;
  rr := pg_temp.as_user(adm, format($q$select public.admin_add_fee_line('%s','hire_stylist','%s')$q$, v4inv2, c4));
  perform pg_temp.chk('V4a 同じ採用進行の2件目の見学案件には、採用料を作れない（別の請求・同じ請求とも）', rr like 'ERR:%admin_invoice_lines_one_hire_per_process%'
    and pg_temp.as_user(adm, format($q$select public.admin_add_fee_line('%s','hire_stylist','%s')$q$, v4inv, c4)) like 'ERR:%'
    and (select count(*) from public.admin_invoice_lines where fee_kind like 'hire%' and voided_at is null and hiring_process_id = p3::uuid) = 1, rr);
  perform pg_temp.chk('V4b 見学料は見学案件ごと（同じ採用進行でも案件が別なら別の行）', pg_temp.as_user(adm, format($q$select public.admin_add_fee_line('%s','visit','%s')$q$, v4inv2, c4)) !~ '^ERR');
  -- 取消すれば解放され、同じ採用進行の採用料を別の案件で作り直せる
  perform pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','cancelled')$q$, v4inv));
  perform pg_temp.chk('V4c 請求を取り消すと、その採用進行の採用料を（別案件でも）作り直せる', pg_temp.as_user(adm, format($q$select public.admin_add_fee_line('%s','hire_stylist','%s')$q$, v4inv2, c4)) !~ '^ERR');
  -- 見学未実施／採用進行に紐づかない採用は個別確認
  r := pg_temp.as_user(adm, format($q$select public.admin_create_invoice('%s')$q$, A)); v4inv := r::uuid;
  perform pg_temp.chk('V4d 見学未実施の採用は採用料にできない（個別確認）', pg_temp.as_user(adm, format($q$select public.admin_add_fee_line('%s','hire_stylist','%s')$q$, v4inv, c5)) = 'ERR:hire without a confirmed visit needs individual review');
  update public.admin_visit_cases set status='visit_confirmed', visit_confirmed_at = now() where id = c5::uuid;
  perform pg_temp.chk('V4e 採用進行に紐づかない採用も採用料にできない（個別確認）', pg_temp.as_user(adm, format($q$select public.admin_add_fee_line('%s','hire_stylist','%s')$q$, v4inv, c5)) like 'ERR:hiring process link required%');
  rr := pg_temp.as_user(adm, format($q$select public.admin_flag_billing_case('%s','hire_without_process_link','メモ')$q$, c5));
  perform pg_temp.chk('V4f 個別確認の一覧へ残せる。再試行は同じ行を返す。運営者以外は不可', rr !~ '^ERR' and pg_temp.as_user(adm, format($q$select public.admin_flag_billing_case('%s','hire_without_process_link')$q$, c5)) = rr
    and (select count(*) from public.admin_unresolved_billing_cases where visit_case_id = c5::uuid and reason='hire_without_process_link') = 1
    and pg_temp.as_user(u||'016', format($q$select public.admin_flag_billing_case('%s','hire_without_visit')$q$, c5)) = 'ERR:admin access required'
    and pg_temp.as_user(adm, format($q$select public.admin_flag_billing_case('%s','bogus')$q$, c5)) = 'ERR:invalid reason');
  -- V2 決済: 要確認・完了済み・通知の遅れ・失敗/失効
  perform pg_temp.as_user(adm, format($q$select public.admin_add_fee_line('%s','visit','%s')$q$, v4inv, c5));
  perform pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','admin_confirmed')$q$, v4inv));
  perform pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','finalized')$q$, v4inv));
  perform pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','payment_pending')$q$, v4inv));
  ck := pg_temp.as_user(u||'002', format($q$select public.billing_begin_checkout('%s')$q$, v4inv))::jsonb;
  perform pg_temp.chk('V2a 決済開始。再実行（通信切れ後の再試行）は同じ受付を返し、増やさない', (ck->>'existing') = 'false'
    and (pg_temp.as_user(u||'002', format($q$select public.billing_begin_checkout('%s')$q$, v4inv))::jsonb->>'checkout_id') = ck->>'checkout_id'
    and (select count(*) from public.admin_invoice_checkouts where invoice_id = v4inv) = 1);
  update public.admin_invoice_checkouts set status = 'needs_review' where invoice_id = v4inv;
  perform pg_temp.chk('V2b 決済が needs_review の間は、新しい決済開始も拒否', pg_temp.as_user(u||'002', format($q$select public.billing_begin_checkout('%s')$q$, v4inv)) = 'ERR:checkout needs review');
  update public.admin_invoice_checkouts set status = 'completed' where invoice_id = v4inv;
  perform pg_temp.chk('V2c 支払い完了の決済があれば（請求がまだ支払い待ち＝通知が遅れている間も）新しい決済開始は拒否。取消も不可', pg_temp.as_user(u||'002', format($q$select public.billing_begin_checkout('%s')$q$, v4inv)) = 'ERR:checkout already completed'
    and pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','cancelled')$q$, v4inv)) = 'ERR:checkout in progress'
    and (select status from public.admin_invoices where id = v4inv) = 'payment_pending');
  update public.admin_invoice_checkouts set status = 'expired' where invoice_id = v4inv;
  r := pg_temp.as_user(u||'002', format($q$select public.billing_begin_checkout('%s')$q$, v4inv));
  perform pg_temp.chk('V2d 失効・失敗した決済の後は、新しい決済を開始できる', (r::jsonb->>'existing') = 'false'
    and (select count(*) from public.admin_invoice_checkouts where invoice_id = v4inv and status in ('pending','open','needs_review','completed')) = 1, r);
  -- V3 再試行（応答が届かなかった・接続が切れた後の再実行）
  select count(*) into n1 from public.admin_audit_events where target_id = v4inv and action = 'invoice_status_changed';
  perform pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','payment_pending')$q$, v4inv));
  perform pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','payment_pending')$q$, v4inv));
  select count(*) into n2 from public.admin_audit_events where target_id = v4inv and action = 'invoice_status_changed';
  perform pg_temp.chk('V3a 進行の再試行は何も変えない（監査履歴も増えない）', n1 = n2);
  r := pg_temp.as_user(adm, format($q$select public.admin_create_invoice('%s','%s')$q$, B, rid));
  perform pg_temp.chk('V3b 請求作成の再試行（同じ request_id）は同じ請求を返す。別の会社での再利用は拒否', pg_temp.as_user(adm, format($q$select public.admin_create_invoice('%s','%s')$q$, B, rid)) = r
    and pg_temp.as_user(adm, format($q$select public.admin_create_invoice('%s','%s')$q$, A, rid)) = 'ERR:request id content mismatch'
    and (select count(*) from public.admin_invoices where created_by = adm::uuid and request_id = rid) = 1);
  -- 取引が途中で中断（デッドロック等）された後の再試行: 中断した分は残らず、再試行で1件だけできる
  rid := gen_random_uuid();
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', adm)::text, true);   -- 運営者として呼ぶ
    perform public.admin_create_invoice(B::uuid, rid);
    if (select count(*) from public.admin_invoices where request_id = rid) <> 1 then raise exception 'setup failed'; end if;   -- 中断の直前には1件ある
    raise exception 'simulated deadlock';
  exception when others then null; end;
  perform pg_temp.chk('V3c 中断した取引の請求は残らない', (select count(*) from public.admin_invoices where request_id = rid) = 0);
  r := pg_temp.as_user(adm, format($q$select public.admin_create_invoice('%s','%s')$q$, B, rid));
  rr := pg_temp.as_user(adm, format($q$select public.admin_create_invoice('%s','%s')$q$, B, rid));
  perform pg_temp.chk('V3d 中断後の再試行で1件だけできる。さらに再試行しても増えない（同じ請求）', r !~ '^ERR' and rr = r and (select count(*) from public.admin_invoices where request_id = rid) = 1, r);
  select id into q from public.admin_quotes where organization_id = C::uuid and status = 'agreed';
  select count(*) into n1 from public.admin_audit_events where action in ('quote_agreed','quote_declined') and (after_value->>'quote_id') = q::text;
  perform pg_temp.as_user(u||'016', format($q$select public.company_respond_quote('%s', true)$q$, q));
  select count(*) into n2 from public.admin_audit_events where action in ('quote_agreed','quote_declined') and (after_value->>'quote_id') = q::text;
  perform pg_temp.chk('V3e 見積への同じ応答の再試行は何もせず成功（履歴も増えない）。逆の応答は拒否', n1 = n2 and pg_temp.as_user(u||'016', format($q$select public.company_respond_quote('%s', false)$q$, q)) = 'ERR:quote is not open');
  insert into public.salon_organizations (id, name) values ('00000000-0000-0000-0000-0000000f0e01','E社(13店)');
  insert into public.salon_stores (organization_id, store_name) select '00000000-0000-0000-0000-0000000f0e01', 'E'||g from generate_series(1,13) g;
  r := pg_temp.as_user(adm, $q$select public.admin_propose_quote('00000000-0000-0000-0000-0000000f0e01', 123000, 'x')$q$);
  rr := pg_temp.as_user(adm, $q$select public.admin_propose_quote('00000000-0000-0000-0000-0000000f0e01', 123000, 'x')$q$);
  perform pg_temp.chk('V3f 見積提示の再試行は同じ見積を返す（二重に作らない）。', r !~ '^ERR' and rr = r
    and (select count(*) from public.admin_quotes where organization_id = '00000000-0000-0000-0000-0000000f0e01' and status = 'proposed') = 1, r||' / '||rr);
  -- V5 権限（新設表・関数。service_roleを含む）
  perform pg_temp.chk('V5a 新設6表は PUBLIC/anon/authenticated/service_role のいずれも、どの権限も持たない', not exists (
    select 1 from unnest(array['admin_quotes','admin_invoices','admin_invoice_lines','admin_invoice_checkouts','admin_invoice_webhook_events','admin_unresolved_billing_cases']) t
      cross join unnest(array['anon','authenticated','service_role']) ro cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) pv
     where has_table_privilege(ro, 'public.'||t, pv)) and not exists (select 1 from pg_class c, aclexplode(c.relacl) a where c.oid in ('public.admin_quotes'::regclass,'public.admin_invoices'::regclass,'public.admin_invoice_lines'::regclass,'public.admin_invoice_checkouts'::regclass,'public.admin_invoice_webhook_events'::regclass,'public.admin_unresolved_billing_cases'::regclass) and a.grantee = 0));
  perform pg_temp.chk('V5b 新設の関数（公開14＋内部9）の実行権限: 公開は authenticated のみ、内部は誰にも無い（anon/service_role/PUBLICは全て不可）', (
    select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('admin_propose_quote','admin_withdraw_quote','admin_create_invoice','admin_add_fee_line','admin_add_registration_line','admin_void_line','admin_advance_invoice','company_list_quotes','company_respond_quote','billing_list_invoices','billing_begin_checkout','admin_correct_hire_line','admin_recalculate_registration_line','admin_flag_billing_case')
      and has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE') and not has_function_privilege('service_role', p.oid, 'EXECUTE') and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)) = 14
    and (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('_admin_tax','_admin_org_billing_actor','_admin_invoice_payable_by','_admin_quotes_rules','_admin_invoice_line_rules','_admin_invoice_requires_amounts','registration_fee_for_store_count','_admin_visit_case_fee_guard','_admin_assert_invoice_correctable')
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('service_role', p.oid, 'EXECUTE') or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0))) = 0);
  end;

  -- V6 請求の根拠の保護（NULL化・採用料だけの請求での実施確認）。通常の 内定→採用成立 は通る
  declare c6 text := '00000000-0000-0000-0000-0000000f2006'; p6 text := '00000000-0000-0000-0000-0000000f5006'; v6inv uuid; v6l uuid;
  begin
  insert into public.store_hiring_processes (id, store_id, stylist_user_id, status, source) values (p6::uuid, A1::uuid, (u||'012')::uuid, 'offered', 'interest');
  insert into public.admin_visit_cases (id, stylist_user_id, store_id, hiring_process_id, status, visit_confirmed_at, stylist_intent, salon_intent, hiring_decision)
    values (c6::uuid, (u||'012')::uuid, A1::uuid, p6::uuid, 'visit_confirmed', now(), 'interested', 'interested', 'offered');
  r := pg_temp.as_user(adm, format($q$select public.admin_create_invoice('%s')$q$, A)); v6inv := r::uuid;
  v6l := pg_temp.as_user(adm, format($q$select public.admin_add_fee_line('%s','hire_stylist','%s')$q$, v6inv, c6))::uuid;   -- 採用料だけ（見学料の行は無い）
  perform pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','admin_confirmed')$q$, v6inv));
  perform pg_temp.chk('V6a 請求後に hiring_decision を NULL にして内定状態を消すことは拒否', pg_temp.try(format($q$update public.admin_visit_cases set hiring_decision = null where id = '%s'$q$, c6)) like 'case has an invoiced fee%');
  perform pg_temp.chk('V6b 請求後に hiring_decision を undecided にすることも拒否（NULL以外の後退）', pg_temp.try(format($q$update public.admin_visit_cases set hiring_decision = 'undecided' where id = '%s'$q$, c6)) like 'case has an invoiced fee%');
  perform pg_temp.chk('V6c 請求後に意向をNULLにすることも拒否', pg_temp.try(format($q$update public.admin_visit_cases set salon_intent = null where id = '%s'$q$, c6)) like 'case has an invoiced fee%'
    and pg_temp.try(format($q$update public.admin_visit_cases set stylist_intent = null where id = '%s'$q$, c6)) like 'case has an invoiced fee%');
  perform pg_temp.chk('V6d 採用料だけの請求でも、実施確認日時の変更・削除は拒否', pg_temp.try(format($q$update public.admin_visit_cases set visit_confirmed_at = now() + interval '1 day' where id = '%s'$q$, c6)) like 'case has an invoiced fee%'
    and pg_temp.try(format($q$update public.admin_visit_cases set visit_confirmed_at = null where id = '%s'$q$, c6)) like 'case has an invoiced fee%');
  perform pg_temp.chk('V6e 採用料だけの請求でも、実施確認済みのステータスから戻す（scheduled等）ことは拒否', pg_temp.try(format($q$update public.admin_visit_cases set status = 'scheduled' where id = '%s'$q$, c6)) like 'case has an invoiced fee%'
    and pg_temp.try(format($q$update public.admin_visit_cases set status = 'scheduled', visit_confirmed_at = null where id = '%s'$q$, c6)) like 'case has an invoiced fee%');
  perform pg_temp.chk('V6f 通常の 内定→採用成立 は、請求後（運営確認済み）も通る。その後の internal_note 更新も可', pg_temp.try(format($q$update public.admin_visit_cases set hiring_decision = 'hired' where id = '%s'$q$, c6)) = 'OK'
    and pg_temp.try(format($q$update public.admin_visit_cases set internal_note = 'ok' where id = '%s'$q$, c6)) = 'OK');
  perform pg_temp.chk('V6g 状態は変わらず、採用料の行も1行のまま', (select hiring_decision from public.admin_visit_cases where id = c6::uuid) = 'hired' and (select count(*) from public.admin_invoice_lines where invoice_id = v6inv and voided_at is null) = 1);
  end;
end $$;

select n, case when ok then 'PASS' else 'FAIL' end as r, name, info from t_log where not ok order by n;
select count(*) filter (where ok) as pass, count(*) filter (where not ok) as fail from t_log;
rollback;
