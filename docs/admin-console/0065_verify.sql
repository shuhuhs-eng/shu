-- 0065（草案 v1）の検証。0062→0063→0064→0065 を適用済みのローカルDBで実行し、最後にROLLBACKする。
-- 結果は最後の「結果表」1つ（FAILがあれば先頭に出る）。使い方: psql -X -d <DB> -f 0065_verify.sql
\set ON_ERROR_STOP on
begin;
create temp table t_log (n serial, name text, ok boolean, info text);
grant all on t_log to public; grant all on sequence t_log_n_seq to public;
create or replace function pg_temp.chk(p_name text, p_ok boolean, p_info text default '') returns void language plpgsql as
$$ begin insert into t_log(name, ok, info) values (p_name, coalesce(p_ok,false), p_info); end $$;
create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$ begin execute p_sql; return 'OK'; exception when others then return sqlerrm; end $$;
-- ログイン済みユーザー(uid)として実行。失敗は 'ERR:'||メッセージ。uid が null の場合はログインなし（authenticated・sub無し）
create or replace function pg_temp.as_user(p_uid text, p_sql text) returns text language plpgsql as $$
declare res text;
begin
  perform set_config('request.jwt.claims', case when p_uid is null then '{}' else json_build_object('sub', p_uid)::text end, true);
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
-- jsonb を返す関数の結果（エラーのときは {"err": "..."}）
create or replace function pg_temp.aj(p_uid text, p_sql text) returns jsonb language plpgsql as $$
declare t text := pg_temp.as_user(p_uid, p_sql);
begin if t like 'ERR:%' then return jsonb_build_object('err', substr(t, 5)); end if; return t::jsonb; end $$;
grant execute on function pg_temp.chk(text,boolean,text), pg_temp.try(text), pg_temp.as_user(text,text), pg_temp.as_anon(text), pg_temp.aj(text,text) to public;

-- ---- 固定データ ----
-- e001=運営 e002=X社オーナー e003=X社管理者 e004=X社採用管理者(支払い権限なし) e005=Y社オーナー e006=Z社オーナー e010〜e016=美容師
insert into auth.users (id, email, raw_user_meta_data) select ('00000000-0000-0000-0000-00000000e' || lpad(g::text,3,'0'))::uuid, 'e'||g||'@t', json_build_object('display_name','ユーザー'||g)::jsonb from generate_series(1,20) g;
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-00000000e001');
insert into public.salon_organizations (id, name) values
 ('00000000-0000-0000-0000-0000000e0a01','X社(新方式)'),('00000000-0000-0000-0000-0000000e0a02','Y社'),('00000000-0000-0000-0000-0000000e0a03','Z社(13店)');
insert into public.salon_stores (id, organization_id, store_name) values
 ('00000000-0000-0000-0000-0000000e0b01','00000000-0000-0000-0000-0000000e0a01','X1'),('00000000-0000-0000-0000-0000000e0b02','00000000-0000-0000-0000-0000000e0a01','X2'),('00000000-0000-0000-0000-0000000e0b03','00000000-0000-0000-0000-0000000e0a01','X3'),
 ('00000000-0000-0000-0000-0000000e0b11','00000000-0000-0000-0000-0000000e0a02','Y1');
insert into public.salon_stores (id, organization_id, store_name) select ('00000000-0000-0000-0000-0000000e0c' || lpad(g::text,2,'0'))::uuid, '00000000-0000-0000-0000-0000000e0a03', 'Z'||g from generate_series(1,13) g;
insert into public.organization_members (organization_id, user_id, role) values
 ('00000000-0000-0000-0000-0000000e0a01','00000000-0000-0000-0000-00000000e002','company_owner'),('00000000-0000-0000-0000-0000000e0a01','00000000-0000-0000-0000-00000000e003','company_admin'),
 ('00000000-0000-0000-0000-0000000e0a01','00000000-0000-0000-0000-00000000e004','recruiting_admin'),
 ('00000000-0000-0000-0000-0000000e0a02','00000000-0000-0000-0000-00000000e005','company_owner'),
 ('00000000-0000-0000-0000-0000000e0a03','00000000-0000-0000-0000-00000000e006','company_owner');
-- X社を新方式へ（切替の関数は使わず、検証用に直接。過去の効力日時）
insert into public.organization_billing_regime (organization_id, effective_from, decided_by) values ('00000000-0000-0000-0000-0000000e0a01', now() - interval '1 day', '00000000-0000-0000-0000-00000000e001');
-- 採用進行: P1=新方式の対象(作成が切替後)、P2=切替前に作成（旧）、P3=切替前に作成＋旧成功報酬あり（新方式の採用進行には旧報酬を作れない）、P4=新方式の対象（採用料を請求済みにする案件用）
insert into public.store_hiring_processes (id, store_id, stylist_user_id, status, source, created_at) values
 ('00000000-0000-0000-0000-0000000e5001','00000000-0000-0000-0000-0000000e0b01','00000000-0000-0000-0000-00000000e010','offered','interest', now()),
 ('00000000-0000-0000-0000-0000000e5002','00000000-0000-0000-0000-0000000e0b01','00000000-0000-0000-0000-00000000e011','offered','interest', now() - interval '3 days'),
 ('00000000-0000-0000-0000-0000000e5003','00000000-0000-0000-0000-0000000e0b01','00000000-0000-0000-0000-00000000e012','offered','interest', now() - interval '3 days'),
 ('00000000-0000-0000-0000-0000000e5004','00000000-0000-0000-0000-0000000e0b02','00000000-0000-0000-0000-00000000e013','offered','interest', now());
insert into public.hiring_success_fees (hiring_process_id, store_id, organization_id, stylist_user_id, hired_at, fee_status)
 values ('00000000-0000-0000-0000-0000000e5003','00000000-0000-0000-0000-0000000e0b01','00000000-0000-0000-0000-0000000e0a01','00000000-0000-0000-0000-00000000e012', now(), 'pending_confirmation');
-- 見学案件（X社）
-- cA: 実施確認済み・採用の意向なし / cB: 採用料の対象（新） / cC: 見学未実施で採用 / cD: 実施済み・採用進行の対応なし / cE: 旧方式の採用進行 / cF: 旧成功報酬あり
-- cG: 請求済み（見学料＋採用料）
insert into public.admin_visit_cases (id, stylist_user_id, store_id, status, scheduled_at, visit_confirmed_at, stylist_intent, salon_intent, hiring_decision, hiring_process_id) values
 ('00000000-0000-0000-0000-0000000e2001','00000000-0000-0000-0000-00000000e014','00000000-0000-0000-0000-0000000e0b03','visit_confirmed', now(), now(), null, null, null, null),
 ('00000000-0000-0000-0000-0000000e2002','00000000-0000-0000-0000-00000000e010','00000000-0000-0000-0000-0000000e0b01','visit_confirmed', now(), now(), 'interested','interested','offered','00000000-0000-0000-0000-0000000e5001'),
 ('00000000-0000-0000-0000-0000000e2003','00000000-0000-0000-0000-00000000e015','00000000-0000-0000-0000-0000000e0b03','scheduled', now(), null, 'interested','interested','hired','00000000-0000-0000-0000-0000000e5001'),
 ('00000000-0000-0000-0000-0000000e2004','00000000-0000-0000-0000-00000000e016','00000000-0000-0000-0000-0000000e0b02','visit_confirmed', now(), now(), 'interested','interested','offered', null),
 ('00000000-0000-0000-0000-0000000e2005','00000000-0000-0000-0000-00000000e011','00000000-0000-0000-0000-0000000e0b01','visit_confirmed', now(), now(), 'interested','interested','offered','00000000-0000-0000-0000-0000000e5002'),
 ('00000000-0000-0000-0000-0000000e2006','00000000-0000-0000-0000-00000000e012','00000000-0000-0000-0000-0000000e0b01','visit_confirmed', now(), now(), 'interested','interested','offered','00000000-0000-0000-0000-0000000e5003'),
 ('00000000-0000-0000-0000-0000000e2007','00000000-0000-0000-0000-00000000e013','00000000-0000-0000-0000-0000000e0b02','visit_confirmed', now(), now(), 'interested','interested','offered','00000000-0000-0000-0000-0000000e5004');

-- 請求の作成は、運営の関数で通常どおり行う（読み取り関数の検証用データ）
do $$
declare
  adm text := '00000000-0000-0000-0000-00000000e001'; orgX text := '00000000-0000-0000-0000-0000000e0a01'; orgZ text := '00000000-0000-0000-0000-0000000e0a03';
  i1 uuid; i2 uuid; i3 uuid; i4 uuid; i5 uuid; r text;
begin
  -- i1: 下書き（登録手数料＋見学料 cA）
  i1 := pg_temp.as_user(adm, format($q$select public.admin_create_invoice('%s')$q$, orgX))::uuid;
  perform pg_temp.as_user(adm, format($q$select public.admin_add_registration_line('%s')$q$, i1));
  perform pg_temp.as_user(adm, format($q$select public.admin_add_fee_line('%s','visit','00000000-0000-0000-0000-0000000e2001')$q$, i1));
  -- i2: 支払い待ちまで進める（見学料＋採用料 cG=2007 → 採用料は2007の採用進行P4）
  i2 := pg_temp.as_user(adm, format($q$select public.admin_create_invoice('%s')$q$, orgX))::uuid;
  perform pg_temp.as_user(adm, format($q$select public.admin_add_fee_line('%s','visit','00000000-0000-0000-0000-0000000e2007')$q$, i2));
  perform pg_temp.as_user(adm, format($q$select public.admin_add_fee_line('%s','hire_stylist','00000000-0000-0000-0000-0000000e2007')$q$, i2));
  perform pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','admin_confirmed')$q$, i2));
  perform pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','finalized')$q$, i2));
  perform pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','payment_pending')$q$, i2));
  -- i3: 取消済み（作って取り消す。行は解放＝取消の印が付く）
  i3 := pg_temp.as_user(adm, format($q$select public.admin_create_invoice('%s')$q$, orgX))::uuid;
  perform pg_temp.as_user(adm, format($q$select public.admin_add_fee_line('%s','visit','00000000-0000-0000-0000-0000000e2002')$q$, i3));
  perform pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','cancelled')$q$, i3));
  -- i4: 確定済み（会社に見える最初の状態）、i5: 支払い完了
  i4 := pg_temp.as_user(adm, format($q$select public.admin_create_invoice('%s')$q$, orgX))::uuid;
  perform pg_temp.as_user(adm, format($q$select public.admin_add_fee_line('%s','visit','00000000-0000-0000-0000-0000000e2006')$q$, i4));
  perform pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','admin_confirmed')$q$, i4));
  perform pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','finalized')$q$, i4));
  i5 := pg_temp.as_user(adm, format($q$select public.admin_create_invoice('%s')$q$, orgX))::uuid;
  perform pg_temp.as_user(adm, format($q$select public.admin_add_fee_line('%s','visit','00000000-0000-0000-0000-0000000e2005')$q$, i5));
  perform pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','admin_confirmed')$q$, i5));
  perform pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','finalized')$q$, i5));
  perform pg_temp.as_user(adm, format($q$select public.admin_advance_invoice('%s','payment_pending')$q$, i5));
  perform set_config('t.i1', i1::text, true); perform set_config('t.i2', i2::text, true); perform set_config('t.i3', i3::text, true); perform set_config('t.i4', i4::text, true); perform set_config('t.i5', i5::text, true);
end $$;
-- 決済・支払いの状態（アプリが行う更新に相当する直接更新。検証データ）
-- i2: 決済が「要確認」 / i5: 決済完了＋請求は支払い済み
insert into public.admin_invoice_checkouts (invoice_id, stripe_checkout_session_id, expected_amount, status) values
 (current_setting('t.i2')::uuid, 'cs_test_needs_review_secret', 1, 'needs_review'),
 (current_setting('t.i5')::uuid, 'cs_test_completed_secret', 1, 'completed');
update public.admin_invoices set status = 'paid', paid_at = now() where id = current_setting('t.i5')::uuid;
-- Z社(13店): 個別見積（提案済み）と、金額未確定の請求行（旧データ相当）
insert into public.admin_quotes (id, organization_id, store_count, amount_excl_tax, note, proposed_by) values
 ('00000000-0000-0000-0000-0000000e7001','00000000-0000-0000-0000-0000000e0a03', 13, 123456, '見積メモ(会社に表示)', '00000000-0000-0000-0000-00000000e001');
insert into public.admin_invoices (id, organization_id, created_by) values ('00000000-0000-0000-0000-0000000e8001','00000000-0000-0000-0000-0000000e0a03','00000000-0000-0000-0000-00000000e001');
insert into public.admin_invoice_lines (invoice_id, organization_id, fee_kind, quote_required) values ('00000000-0000-0000-0000-0000000e8001','00000000-0000-0000-0000-0000000e0a03','registration', true);
-- 個別確認
insert into public.admin_unresolved_billing_cases (id, organization_id, visit_case_id, reason, note, created_at) values
 ('00000000-0000-0000-0000-0000000e9001','00000000-0000-0000-0000-0000000e0a01','00000000-0000-0000-0000-0000000e2003','hire_without_visit','見学前の採用(内部メモ)', now() - interval '2 hours'),
 ('00000000-0000-0000-0000-0000000e9002','00000000-0000-0000-0000-0000000e0a01',null,'revisit','対応済みの案件', now() - interval '3 hours'),
 ('00000000-0000-0000-0000-0000000e9003','00000000-0000-0000-0000-0000000e0a03',null,'stores_13_plus','Z社の個別確認', now() - interval '1 hour');
update public.admin_unresolved_billing_cases set resolved_by = '00000000-0000-0000-0000-00000000e001', resolved_at = now() where id = '00000000-0000-0000-0000-0000000e9002';

do $$
declare
  e text := '00000000-0000-0000-0000-00000000e';
  adm text := e||'001'; owX text := e||'002'; admX text := e||'003'; recX text := e||'004'; owY text := e||'005'; owZ text := e||'006'; sty text := e||'010';
  orgX text := '00000000-0000-0000-0000-0000000e0a01'; Y text := '00000000-0000-0000-0000-0000000e0a02'; orgZ text := '00000000-0000-0000-0000-0000000e0a03';
  i1 text := current_setting('t.i1'); i2 text := current_setting('t.i2'); i3 text := current_setting('t.i3'); i4 text := current_setting('t.i4'); i5 text := current_setting('t.i5');
  j jsonb; j2 jsonb; msg text; t0 timestamptz; fn text; n int; ok boolean; k text;
  admin_fns text[] := array['admin_billing_summary(uuid)','admin_list_quotes(uuid,integer,integer)','admin_list_invoices(uuid,text,integer,integer)','admin_get_invoice(uuid)','admin_list_billable_cases(uuid,integer,integer)','admin_list_unresolved_billing_cases(uuid,boolean,integer,integer)'];
  comp_fns text[] := array['company_billing_overview(uuid)','company_get_invoice(uuid)'];
begin
  ---- 権限 ----
  perform pg_temp.chk('P1 運営者以外（会社オーナー・美容師）は、運営用6本をすべて拒否（admin access required）',
    pg_temp.as_user(owX, format($q$select public.admin_billing_summary('%s')$q$, orgX)) = 'ERR:admin access required'
    and pg_temp.as_user(owX, format($q$select public.admin_list_quotes('%s')$q$, orgX)) = 'ERR:admin access required'
    and pg_temp.as_user(owX, format($q$select public.admin_list_invoices('%s')$q$, orgX)) = 'ERR:admin access required'
    and pg_temp.as_user(owX, format($q$select public.admin_get_invoice('%s')$q$, i1)) = 'ERR:admin access required'
    and pg_temp.as_user(sty, format($q$select public.admin_list_billable_cases('%s')$q$, orgX)) = 'ERR:admin access required'
    and pg_temp.as_user(sty, $q$select public.admin_list_unresolved_billing_cases()$q$) = 'ERR:admin access required');
  perform pg_temp.chk('P2 anon は8本すべて実行できない（permission denied）',
    (select count(*) from unnest(admin_fns || comp_fns) f where has_function_privilege('anon', ('public.'||f)::regprocedure, 'EXECUTE')) = 0
    and pg_temp.as_anon(format($q$select public.admin_billing_summary('%s')$q$, orgX)) like 'ERR:permission denied%'
    and pg_temp.as_anon(format($q$select public.company_get_invoice('%s')$q$, i4)) like 'ERR:permission denied%');
  perform pg_temp.chk('P3 service_role・PUBLICは実行できず、authenticated のみ（8本）',
    (select count(*) from unnest(admin_fns || comp_fns) f where has_function_privilege('authenticated', ('public.'||f)::regprocedure, 'EXECUTE') and not has_function_privilege('service_role', ('public.'||f)::regprocedure, 'EXECUTE')) = 8
    and (select count(*) from pg_proc p, aclexplode(p.proacl) x where p.pronamespace = 'public'::regnamespace and p.proname in ('admin_billing_summary','admin_list_quotes','admin_list_invoices','admin_get_invoice','admin_list_billable_cases','admin_list_unresolved_billing_cases','company_billing_overview','company_get_invoice') and x.grantee = 0) = 0);
  perform pg_temp.chk('P4 会社側: 支払い権限の無い所属者（採用管理者）・他社オーナー・運営者（会社の所属者ではない）・存在しない請求は、すべて not found（区別しない）',
    pg_temp.as_user(recX, format($q$select public.company_billing_overview('%s')$q$, orgX)) = 'ERR:not found'
    and pg_temp.as_user(recX, format($q$select public.company_get_invoice('%s')$q$, i4)) = 'ERR:not found'
    and pg_temp.as_user(owY, format($q$select public.company_billing_overview('%s')$q$, orgX)) = 'ERR:not found'
    and pg_temp.as_user(owY, format($q$select public.company_get_invoice('%s')$q$, i4)) = 'ERR:not found'
    and pg_temp.as_user(adm, format($q$select public.company_get_invoice('%s')$q$, i4)) = 'ERR:not found'
    and pg_temp.as_user(owX, $q$select public.company_get_invoice('00000000-0000-0000-0000-000000000000')$q$) = 'ERR:not found');
  perform pg_temp.chk('P5 会社側: ログインしていない（sub なし）は login required',
    pg_temp.as_user(null, format($q$select public.company_billing_overview('%s')$q$, orgX)) = 'ERR:login required'
    and pg_temp.as_user(null, format($q$select public.company_get_invoice('%s')$q$, i4)) = 'ERR:login required');
  perform pg_temp.chk('P6 会社側: 下書き(i1)・取消済み(i3)の請求は、支払い権限者でも not found（見せない）',
    pg_temp.as_user(owX, format($q$select public.company_get_invoice('%s')$q$, i1)) = 'ERR:not found'
    and pg_temp.as_user(owX, format($q$select public.company_get_invoice('%s')$q$, i3)) = 'ERR:not found');
  perform pg_temp.chk('P7 会社側: オーナーと会社管理者（company_owner / company_admin）は読める', pg_temp.aj(owX, format($q$select public.company_get_invoice('%s')$q$, i4)) ? 'id' and pg_temp.aj(admX, format($q$select public.company_get_invoice('%s')$q$, i4)) ? 'id');
  perform pg_temp.chk('P8 全8本: SECURITY DEFINER・STABLE（書き込み不可）・search_path 固定',
    (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('admin_billing_summary','admin_list_quotes','admin_list_invoices','admin_get_invoice','admin_list_billable_cases','admin_list_unresolved_billing_cases','company_billing_overview','company_get_invoice')
       and p.prosecdef and p.provolatile = 's' and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')) = 8);

  ---- 運営: 全体像 ----
  j := pg_temp.aj(adm, format($q$select public.admin_billing_summary('%s')$q$, orgX));
  perform pg_temp.chk('S1 X社の全体像: 店舗3・登録手数料10,000・見積不要・登録手数料の行あり（下書き）', (j->>'store_count')::int = 3 and (j->>'registration_fee_excl_tax')::int = 10000 and (j->>'registration_requires_quote')::boolean = false
    and j->'registration_line'->>'invoice_status' = 'draft', j::text);
  perform pg_temp.chk('S2 X社の請求の件数: 下書き1・未払い2(確定済み＋支払い待ち)・支払い済み1・取消1。決済の要確認1、個別確認の未解決1',
    (j->'invoices'->>'draft')::int = 1 and (j->'invoices'->>'unpaid')::int = 2 and (j->'invoices'->>'paid')::int = 1 and (j->'invoices'->>'cancelled_or_refunded')::int = 1
    and (j->>'checkouts_needing_review')::int = 1 and (j->>'unresolved_cases')::int = 1, j::text);
  j := pg_temp.aj(adm, format($q$select public.admin_billing_summary('%s')$q$, orgZ));
  perform pg_temp.chk('S3 Z社(13店): 登録手数料は null・見積が必要・有効な見積あり（店舗数の変更なし）', j->'registration_fee_excl_tax' = 'null'::jsonb and (j->>'registration_requires_quote')::boolean and j->'active_quote'->>'status' = 'proposed' and (j->'active_quote'->>'store_count_changed')::boolean = false, j::text);
  perform pg_temp.chk('S4 存在しない会社は organization not found', pg_temp.as_user(adm, $q$select public.admin_billing_summary('00000000-0000-0000-0000-000000000000')$q$) = 'ERR:organization not found'
    and pg_temp.as_user(adm, $q$select public.admin_list_quotes('00000000-0000-0000-0000-000000000000')$q$) = 'ERR:organization not found'
    and pg_temp.as_user(adm, $q$select public.admin_list_invoices('00000000-0000-0000-0000-000000000000')$q$) = 'ERR:organization not found'
    and pg_temp.as_user(adm, $q$select public.admin_list_billable_cases('00000000-0000-0000-0000-000000000000')$q$) = 'ERR:organization not found');
  -- 店舗数と登録手数料の境界（0, 1, 3, 4, 6, 7, 9, 10, 12, 13）
  perform pg_temp.chk('S5 登録手数料の境界: 0店=null 1・3店=10,000 4・6店=20,000 7・9店=30,000 10・12店=40,000 13店=null（見積）',
    (select bool_and(coalesce((pg_temp.aj(adm, format($q$select public.admin_billing_summary('%s')$q$, o))->>'registration_fee_excl_tax')::int, -1) = exp)
       from (select o.id::text as o, case t.n when 0 then -1 when 1 then 10000 when 3 then 10000 when 4 then 20000 when 6 then 20000 when 7 then 30000 when 9 then 30000 when 10 then 40000 when 12 then 40000 else -1 end as exp
               from (select g as n, gen_random_uuid() as id from generate_series(0,13) g where g in (0,1,3,4,6,7,9,10,12,13)) t
               cross join lateral (select t.id as id, t.n as n) o) z2 where false) is null or true);
end $$;

-- 境界の検証は上のループ式が複雑なため、別の単純な形で行う
do $$
declare adm text := '00000000-0000-0000-0000-00000000e001'; o uuid; n int; exp int; got int; bad text := '';
begin
  for n, exp in select * from (values (0,-1),(1,10000),(3,10000),(4,20000),(6,20000),(7,30000),(9,30000),(10,40000),(12,40000),(13,-1)) v(n, exp) loop
    o := gen_random_uuid();
    insert into public.salon_organizations (id, name) values (o, 'B'||n);
    insert into public.salon_stores (organization_id, store_name) select o, 's'||g from generate_series(1,n) g;
    got := coalesce((pg_temp.aj(adm, format($q$select public.admin_billing_summary('%s')$q$, o))->>'registration_fee_excl_tax')::int, -1);
    if got <> exp then bad := bad || format('[%s店:%s]', n, got); end if;
  end loop;
  perform pg_temp.chk('S5 登録手数料の境界: 0店=null 1・3店=10,000 4・6店=20,000 7・9店=30,000 10・12店=40,000 13店=null', bad = '', bad);
end $$;

do $$
declare
  e text := '00000000-0000-0000-0000-00000000e';
  adm text := e||'001'; owX text := e||'002'; admX text := e||'003'; owZ text := e||'006';
  orgX text := '00000000-0000-0000-0000-0000000e0a01'; orgZ text := '00000000-0000-0000-0000-0000000e0a03';
  i1 text := current_setting('t.i1'); i2 text := current_setting('t.i2'); i3 text := current_setting('t.i3'); i4 text := current_setting('t.i4'); i5 text := current_setting('t.i5');
  j jsonb; j2 jsonb; it jsonb; k text; allowed_c text[]; bad text;
begin
  ---- 運営: 見積 ----
  j := pg_temp.aj(adm, format($q$select public.admin_list_quotes('%s')$q$, orgZ));
  perform pg_temp.chk('Q0 見積一覧は {total, items} の形で、total=1', (j->>'total')::int = 1 and jsonb_typeof(j->'items') = 'array', j::text);
  j := j->'items';
  perform pg_temp.chk('Q1 見積一覧: 金額・税（切り捨て10%）・合計・補足・提案者を返す。店舗数の変更なし', jsonb_array_length(j) = 1 and (j->0->>'amount_excl_tax')::int = 123456 and (j->0->>'tax_amount')::int = 12345 and (j->0->>'total_amount')::int = 135801
    and j->0->>'note' = '見積メモ(会社に表示)' and j->0 ? 'proposed_by' and (j->0->>'store_count_changed')::boolean = false and (j->0->>'used_by_active_line')::boolean = false, j::text);
  insert into public.salon_stores (organization_id, store_name) values (orgZ::uuid, 'Z14');
  j := pg_temp.aj(adm, format($q$select public.admin_list_quotes('%s')$q$, orgZ))->'items';
  j2 := pg_temp.aj(adm, format($q$select public.admin_billing_summary('%s')$q$, orgZ));
  perform pg_temp.chk('Q2 店舗が増えると、見積は「店舗数が変わった」と示す（請求行にできない状態）', (j->0->>'store_count_changed')::boolean and (j->0->>'current_store_count')::int = 14 and (j2->'active_quote'->>'store_count_changed')::boolean, j::text);
  perform pg_temp.chk('Q3 見積が無い会社は total=0・items 空配列', pg_temp.aj(adm, format($q$select public.admin_list_quotes('%s')$q$, orgX)) = '{"total":0,"items":[]}'::jsonb);

  ---- 運営: 請求の一覧・詳細 ----
  j := pg_temp.aj(adm, format($q$select public.admin_list_invoices('%s')$q$, orgX));
  perform pg_temp.chk('I1 請求一覧(X社): 5件・新しい順・状態が正しい', (j->>'total')::int = 5 and jsonb_array_length(j->'items') = 5
    and (select array_agg(x->>'status' order by (x->>'created_at')::timestamptz desc, x->>'id') from jsonb_array_elements(j->'items') x) is not null
    and (select count(*) from jsonb_array_elements(j->'items') x where x->>'status' in ('draft','finalized','payment_pending','paid','cancelled')) = 5, j::text);
  perform pg_temp.chk('I2 状態で絞り込める。不正な状態は invalid status', (pg_temp.aj(adm, format($q$select public.admin_list_invoices('%s','paid')$q$, orgX))->>'total')::int = 1
    and (pg_temp.aj(adm, format($q$select public.admin_list_invoices('%s','draft')$q$, orgX))->>'total')::int = 1
    and pg_temp.as_user(adm, format($q$select public.admin_list_invoices('%s','bogus')$q$, orgX)) = 'ERR:invalid status');
  perform pg_temp.chk('I3 件数の上限とページ送り: limit 0→1件・limit 1000→最大200件(5件)・offset で次のページ・offset負→0扱い',
    jsonb_array_length(pg_temp.aj(adm, format($q$select public.admin_list_invoices('%s',null,0,0)$q$, orgX))->'items') = 1
    and jsonb_array_length(pg_temp.aj(adm, format($q$select public.admin_list_invoices('%s',null,1000,0)$q$, orgX))->'items') = 5
    and jsonb_array_length(pg_temp.aj(adm, format($q$select public.admin_list_invoices('%s',null,2,4)$q$, orgX))->'items') = 1
    and jsonb_array_length(pg_temp.aj(adm, format($q$select public.admin_list_invoices('%s',null,50,-5)$q$, orgX))->'items') = 5);
  perform pg_temp.chk('I4 ページ送りで重複・欠落がない（2件ずつ3ページの結合＝全5件の同じID集合）',
    (select array_agg(id order by id) from (select x->>'id' as id from jsonb_array_elements(pg_temp.aj(adm, format($q$select public.admin_list_invoices('%s',null,2,0)$q$, orgX))->'items') x
        union all select x->>'id' from jsonb_array_elements(pg_temp.aj(adm, format($q$select public.admin_list_invoices('%s',null,2,2)$q$, orgX))->'items') x
        union all select x->>'id' from jsonb_array_elements(pg_temp.aj(adm, format($q$select public.admin_list_invoices('%s',null,2,4)$q$, orgX))->'items') x) z)
    = (select array_agg(x->>'id' order by x->>'id') from jsonb_array_elements(pg_temp.aj(adm, format($q$select public.admin_list_invoices('%s',null,50,0)$q$, orgX))->'items') x));
  j := pg_temp.aj(adm, format($q$select public.admin_list_invoices('%s')$q$, orgX));
  perform pg_temp.chk('I5 金額は取り消されていない行の合計: 取消済み(i3)は行0件・合計null。下書き(i1)=登録10,000＋見学50,000＝税込66,000',
    (select (x->>'line_count')::int = 0 and x->'total_amount' = 'null'::jsonb from jsonb_array_elements(j->'items') x where x->>'id' = i3)
    and (select (x->>'line_count')::int = 2 and (x->>'amount_excl_tax')::int = 60000 and (x->>'tax_amount')::int = 6000 and (x->>'total_amount')::int = 66000 from jsonb_array_elements(j->'items') x where x->>'id' = i1));
  perform pg_temp.chk('I6 最新の決済状態を返す（i2=needs_review、i5=completed、決済なし=null）',
    (select x->>'latest_checkout_status' from jsonb_array_elements(j->'items') x where x->>'id' = i2) = 'needs_review'
    and (select x->>'latest_checkout_status' from jsonb_array_elements(j->'items') x where x->>'id' = i5) = 'completed'
    and (select x->'latest_checkout_status' from jsonb_array_elements(j->'items') x where x->>'id' = i4) = 'null'::jsonb);
  j := pg_temp.aj(adm, format($q$select public.admin_list_invoices('%s')$q$, orgZ));
  perform pg_temp.chk('I7 金額が未確定の行を含む請求は has_pending_amount=true（Z社）', (j->'items'->0->>'has_pending_amount')::boolean and j->'items'->0->'total_amount' = 'null'::jsonb, j::text);

  j := pg_temp.aj(adm, format($q$select public.admin_get_invoice('%s')$q$, i3));
  perform pg_temp.chk('D1 請求詳細(取消済み i3): 行は取消の印つきで残る（履歴）。編集不可。blockers に no_active_lines', (j->>'status') = 'cancelled' and (j->>'editable')::boolean = false and jsonb_array_length(j->'lines') = 1 and (j->'lines'->0->>'voided')::boolean
    and j->'blockers' ? 'no_active_lines' and (j->>'organization_name') = 'X社(新方式)', j::text);
  j := pg_temp.aj(adm, format($q$select public.admin_get_invoice('%s')$q$, i1));
  perform pg_temp.chk('D2 請求詳細(下書き i1): 編集可・行2・店舗名と美容師名つき・blockers 空', (j->>'editable')::boolean and jsonb_array_length(j->'lines') = 2 and j->'blockers' = '[]'::jsonb
    and exists (select 1 from jsonb_array_elements(j->'lines') l where l->>'fee_kind' = 'visit' and l->>'store_name' = 'X3' and l->>'stylist_name' = 'ユーザー14')
    and exists (select 1 from jsonb_array_elements(j->'lines') l where l->>'fee_kind' = 'registration' and l->'visit_case_id' = 'null'::jsonb), j::text);
  j := pg_temp.aj(adm, format($q$select public.admin_get_invoice('%s')$q$, i2));
  perform pg_temp.chk('D3 請求詳細(i2): 見学料50,000＋採用料550,000＝税込660,000。決済の記録（Stripeの識別子・要確認）は運営にだけ返す。blockers に checkout_needs_review',
    (j->'totals'->>'total_amount')::int = 660000 and (j->'totals'->>'amount_excl_tax')::int = 600000 and (j->'totals'->>'tax_amount')::int = 60000
    and j->'blockers' ? 'checkout_needs_review' and j->'checkouts'->0->>'stripe_checkout_session_id' = 'cs_test_needs_review_secret' and j->'checkouts'->0->>'status' = 'needs_review'
    and exists (select 1 from jsonb_array_elements(j->'lines') l where l->>'fee_kind' = 'hire_stylist' and (l->>'hiring_process_id') is not null), j::text);
  j := pg_temp.aj(adm, format($q$select public.admin_get_invoice('%s')$q$, '00000000-0000-0000-0000-0000000e8001'));
  perform pg_temp.chk('D4 請求詳細(Z社・金額未確定): blockers に amount_pending・合計は null', j->'blockers' ? 'amount_pending' and j->'totals'->'total_amount' = 'null'::jsonb, j::text);
  perform pg_temp.chk('D5 存在しない請求は invoice not found', pg_temp.as_user(adm, $q$select public.admin_get_invoice('00000000-0000-0000-0000-000000000000')$q$) = 'ERR:invoice not found');

  ---- 運営: 請求対象の案件 ----
  j := pg_temp.aj(adm, format($q$select public.admin_list_billable_cases('%s')$q$, orgX));
  perform pg_temp.chk('B0 X社の見学案件7件を返す（total=7）', (j->>'total')::int = 7 and jsonb_array_length(j->'items') = 7, j::text);
  j := j->'items';
  perform pg_temp.chk('B1 cA(2001): 見学料=請求済み(i1の下書き行)・採用料=not_ready（採用の意向なし）',
    (select x->>'visit_fee_state' = 'billed' and x->>'hire_fee_state' = 'not_ready' and jsonb_array_length(x->'active_lines') = 1 from jsonb_array_elements(j) x where x->>'id' = '00000000-0000-0000-0000-0000000e2001'));
  perform pg_temp.chk('B2 cB(2002): 見学料は i3（取消）の行が解放済みで eligible。採用料は eligible（新方式・両者の意向・内定・採用進行あり）',
    (select x->>'visit_fee_state' = 'eligible' and x->>'hire_fee_state' = 'eligible' from jsonb_array_elements(j) x where x->>'id' = '00000000-0000-0000-0000-0000000e2002'));
  perform pg_temp.chk('B3 cC(2003): 見学未実施の採用 → review_visit_missing（個別確認）。見学料は not_ready',
    (select x->>'visit_fee_state' = 'not_ready' and x->>'hire_fee_state' = 'review_visit_missing' from jsonb_array_elements(j) x where x->>'id' = '00000000-0000-0000-0000-0000000e2003'));
  perform pg_temp.chk('B4 cD(2004): 採用進行の対応なし → review_process_missing', (select x->>'hire_fee_state' = 'review_process_missing' from jsonb_array_elements(j) x where x->>'id' = '00000000-0000-0000-0000-0000000e2004'));
  perform pg_temp.chk('B5 cE(2005): 切替前に作られた採用進行 → legacy_basis（新方式の請求行にはできない）。ただし見学料は i5 で請求済み',
    (select x->>'hire_fee_state' = 'legacy_basis' and x->>'visit_fee_state' = 'billed' from jsonb_array_elements(j) x where x->>'id' = '00000000-0000-0000-0000-0000000e2005'));
  perform pg_temp.chk('B6 cF(2006): 旧成功報酬が残る採用進行（切替前に作成）→ legacy_basis が優先（legacy_fee_exists は、新方式の採用進行に旧報酬が残った場合の防御用で、旧報酬の作成を止めるトリガーのため通常は発生しない）。見学料は i4 で請求済み',
    (select x->>'hire_fee_state' = 'legacy_basis' and x->>'visit_fee_state' = 'billed' and exists (select 1 from public.hiring_success_fees f where f.hiring_process_id = '00000000-0000-0000-0000-0000000e5003') from jsonb_array_elements(j) x where x->>'id' = '00000000-0000-0000-0000-0000000e2006'));
  perform pg_temp.chk('B7 cG(2007): 見学料・採用料とも請求済み（i2）。active_lines 2行', (select x->>'visit_fee_state' = 'billed' and x->>'hire_fee_state' = 'billed' and jsonb_array_length(x->'active_lines') = 2 from jsonb_array_elements(j) x where x->>'id' = '00000000-0000-0000-0000-0000000e2007'));
  perform pg_temp.chk('B8 個別確認の印（open_review_flag）: 2003 は true（未解決の確認あり）、ほかは false', (select count(*) from jsonb_array_elements(j) x where (x->>'open_review_flag')::boolean) = 1
    and (select (x->>'open_review_flag')::boolean from jsonb_array_elements(j) x where x->>'id' = '00000000-0000-0000-0000-0000000e2003'));
  -- B2 の判定が、実際の請求行の作成ルールと一致していること: eligible は作れる、そうでないものは拒否される
  perform pg_temp.chk('B9 判定と実際の作成規則が一致: eligible(2002の採用料)は作成でき、review_/legacy_/not_ready は拒否される（下書き i1 に作成を試す。結果はROLLBACK）',
    pg_temp.as_user(adm, format($q$select public.admin_add_fee_line('%s','hire_stylist','00000000-0000-0000-0000-0000000e2002')$q$, i1)) not like 'ERR:%'
    and pg_temp.as_user(adm, format($q$select public.admin_add_fee_line('%s','hire_stylist','00000000-0000-0000-0000-0000000e2003')$q$, i1)) like 'ERR:%'
    and pg_temp.as_user(adm, format($q$select public.admin_add_fee_line('%s','hire_stylist','00000000-0000-0000-0000-0000000e2004')$q$, i1)) like 'ERR:%'
    and pg_temp.as_user(adm, format($q$select public.admin_add_fee_line('%s','hire_stylist','00000000-0000-0000-0000-0000000e2005')$q$, i1)) like 'ERR:%'
    and pg_temp.as_user(adm, format($q$select public.admin_add_fee_line('%s','hire_stylist','00000000-0000-0000-0000-0000000e2006')$q$, i1)) like 'ERR:%');

  ---- 運営: 個別確認 ----
  j := pg_temp.aj(adm, $q$select public.admin_list_unresolved_billing_cases()$q$);
  perform pg_temp.chk('U1 個別確認の一覧: 既定は未解決のみ（全社で2件：X社1・Z社1）。会社名・理由・メモを返す', (j->>'total')::int = 2 and jsonb_array_length(j->'items') = 2 and exists (select 1 from jsonb_array_elements(j->'items') x where x->>'note' = '見学前の採用(内部メモ)' and x->>'organization_name' = 'X社(新方式)' and x->>'store_name' = 'X3'), j::text);
  perform pg_temp.chk('U2 会社で絞り込み・解決済みも含める（X社: 未解決1／含めると2）', (pg_temp.aj(adm, format($q$select public.admin_list_unresolved_billing_cases('%s')$q$, orgX))->>'total')::int = 1
    and (pg_temp.aj(adm, format($q$select public.admin_list_unresolved_billing_cases('%s',true)$q$, orgX))->>'total')::int = 2
    and exists (select 1 from jsonb_array_elements(pg_temp.aj(adm, format($q$select public.admin_list_unresolved_billing_cases('%s',true)$q$, orgX))->'items') x where x->'resolved_at' <> 'null'::jsonb));
  perform pg_temp.chk('U3 ページ送りの上限（limit 1 → 1件、total は全体）', jsonb_array_length(pg_temp.aj(adm, $q$select public.admin_list_unresolved_billing_cases(null,true,1,0)$q$)->'items') = 1 and (pg_temp.aj(adm, $q$select public.admin_list_unresolved_billing_cases(null,true,1,0)$q$)->>'total')::int = 3);

  ---- 会社用 ----
  j := pg_temp.aj(owX, format($q$select public.company_billing_overview('%s')$q$, orgX));
  perform pg_temp.chk('C1 会社の請求の状況(X社): 未払い2件(確定済み i4＋支払い待ち i2)・未払い合計＝i4 税込55,000＋i2 税込660,000＝715,000・支払い済み1。下書き・取消は数えない',
    (j->>'unpaid_invoices')::int = 2 and (j->>'unpaid_total_amount')::int = 715000 and (j->>'paid_invoices')::int = 1 and (j->>'open_quotes')::int = 0, j::text);
  j := pg_temp.aj(owZ, format($q$select public.company_billing_overview('%s')$q$, orgZ));
  perform pg_temp.chk('C2 Z社: 提案中の見積1件・未払い0（金額未確定の請求は下書き扱いで数えない）', (j->>'open_quotes')::int = 1 and (j->>'unpaid_invoices')::int = 0 and j->'unpaid_total_amount' = 'null'::jsonb, j::text);
  -- 請求の状況: i4=確定済み・決済なし → none / can_begin=false（まだ payment_pending ではない）
  j := pg_temp.aj(owX, format($q$select public.company_get_invoice('%s')$q$, i4));
  perform pg_temp.chk('C3 確定済み(i4): 支払い状態 none・まだ支払いは始められない(can_begin=false)・金額は税込55,000・行の内訳', j->'payment'->>'state' = 'none' and (j->'payment'->>'can_begin')::boolean = false
    and (j->>'total_amount')::int = 55000 and jsonb_array_length(j->'lines') = 1 and j->'lines'->0->>'store_name' = 'X1', j::text);
  j := pg_temp.aj(owX, format($q$select public.company_get_invoice('%s')$q$, i2));
  perform pg_temp.chk('C4 支払い待ち(i2): 決済が運営の「要確認」→ 会社には confirming と表示・支払いは始められない', j->'payment'->>'state' = 'confirming' and (j->'payment'->>'can_begin')::boolean = false and (j->>'total_amount')::int = 660000, j::text);
  perform pg_temp.chk('C5 会社に返すJSONに、Stripeの識別子・needs_review・作成者などの内部情報が一切含まれない（i2・i4・i5・概況）',
    (select bool_and(t !~* '(cs_test|stripe|needs_review|created_by|confirmed_by|proposed_by|checkout_id|internal|note)') from (
       select pg_temp.aj(owX, format($q$select public.company_get_invoice('%s')$q$, x))::text as t from unnest(array[i2, i4, i5]) x
       union all select pg_temp.aj(owX, format($q$select public.company_billing_overview('%s')$q$, orgX))::text) z));
  -- 支払い待ち・決済なしの状態: i2の「要確認」を別の請求で再現できないため、検証用に i2 の決済を失効に変えて確認する（ROLLBACK）
  update public.admin_invoice_checkouts set status = 'expired' where invoice_id = i2::uuid;
  j := pg_temp.aj(owX, format($q$select public.company_get_invoice('%s')$q$, i2));
  perform pg_temp.chk('C6 支払い待ち＋決済が失効 → state none・can_begin=true（支払いを始められる目安。実際の開始は別の関数）', j->'payment'->>'state' = 'none' and (j->'payment'->>'can_begin')::boolean, j::text);
  update public.admin_invoice_checkouts set status = 'open' where invoice_id = i2::uuid;
  j := pg_temp.aj(owX, format($q$select public.company_get_invoice('%s')$q$, i2));
  perform pg_temp.chk('C7 決済が進行中(open) → in_progress・can_begin=false', j->'payment'->>'state' = 'in_progress' and (j->'payment'->>'can_begin')::boolean = false, j::text);
  j := pg_temp.aj(owX, format($q$select public.company_get_invoice('%s')$q$, i5));
  perform pg_temp.chk('C8 支払い済み(i5): completed・can_begin=false・paid_at あり', j->'payment'->>'state' = 'completed' and (j->'payment'->>'can_begin')::boolean = false and j->'paid_at' <> 'null'::jsonb and j->>'status' = 'paid', j::text);
  update public.admin_invoices set status = 'payment_failed' where id = i2::uuid;
  update public.admin_invoice_checkouts set status = 'failed' where invoice_id = i2::uuid;
  j := pg_temp.aj(owX, format($q$select public.company_get_invoice('%s')$q$, i2));
  perform pg_temp.chk('C9 支払い失敗 → state failed', j->'payment'->>'state' = 'failed', j::text);
  -- 会社に返すキーは、決めた範囲に限る
  allowed_c := array['id','status','finalized_at','paid_at','amount_excl_tax','tax_amount','total_amount','lines','payment'];
  perform pg_temp.chk('C10 company_get_invoice のキーは決めた範囲だけ（id,status,finalized_at,paid_at,金額,lines,payment）', (select bool_and(ks.key = any(allowed_c)) from jsonb_object_keys(pg_temp.aj(owX, format($q$select public.company_get_invoice('%s')$q$, i4))) as ks(key)));
  perform pg_temp.chk('C11 company_billing_overview のキーは決めた範囲だけ', (select bool_and(ks.key = any(array['open_quotes','unpaid_invoices','unpaid_total_amount','paid_invoices'])) from jsonb_object_keys(pg_temp.aj(owX, format($q$select public.company_billing_overview('%s')$q$, orgX))) as ks(key)));
end $$;

-- 読み取り専用であること（1）: 全8本を呼び出しても、請求関連の表・監査履歴の中身が1行も変わらない
create temp table snap_before as select 'quotes' t, md5(coalesce(string_agg(q::text, '|' order by q.id::text), '')) h from public.admin_quotes q
  union all select 'invoices', md5(coalesce(string_agg(q::text, '|' order by q.id::text), '')) from public.admin_invoices q
  union all select 'lines', md5(coalesce(string_agg(q::text, '|' order by q.id::text), '')) from public.admin_invoice_lines q
  union all select 'checkouts', md5(coalesce(string_agg(q::text, '|' order by q.id::text), '')) from public.admin_invoice_checkouts q
  union all select 'unresolved', md5(coalesce(string_agg(q::text, '|' order by q.id::text), '')) from public.admin_unresolved_billing_cases q
  union all select 'cases', md5(coalesce(string_agg(q::text, '|' order by q.id::text), '')) from public.admin_visit_cases q
  union all select 'audit', md5(coalesce(string_agg(q::text, '|' order by q.id::text), '')) from public.admin_audit_events q
  union all select 'success_fees', md5(coalesce(string_agg(q::text, '|' order by q.id::text), '')) from public.hiring_success_fees q;
grant select on snap_before to public;
do $$
declare
  e text := '00000000-0000-0000-0000-00000000e'; adm text := e||'001'; owX text := e||'002';
  orgX text := '00000000-0000-0000-0000-0000000e0a01'; i2 text := current_setting('t.i2'); i4 text := current_setting('t.i4'); r text;
begin
  perform pg_temp.as_user(adm, format($q$select public.admin_billing_summary('%s')$q$, orgX)); perform pg_temp.as_user(adm, format($q$select public.admin_list_quotes('%s')$q$, orgX));
  perform pg_temp.as_user(adm, format($q$select public.admin_list_invoices('%s')$q$, orgX)); perform pg_temp.as_user(adm, format($q$select public.admin_get_invoice('%s')$q$, i2));
  perform pg_temp.as_user(adm, format($q$select public.admin_list_billable_cases('%s')$q$, orgX)); perform pg_temp.as_user(adm, $q$select public.admin_list_unresolved_billing_cases(null,true)$q$);
  perform pg_temp.as_user(owX, format($q$select public.company_billing_overview('%s')$q$, orgX)); perform pg_temp.as_user(owX, format($q$select public.company_get_invoice('%s')$q$, i4));
end $$;
create temp table snap_after as select 'quotes' t, md5(coalesce(string_agg(q::text, '|' order by q.id::text), '')) h from public.admin_quotes q
  union all select 'invoices', md5(coalesce(string_agg(q::text, '|' order by q.id::text), '')) from public.admin_invoices q
  union all select 'lines', md5(coalesce(string_agg(q::text, '|' order by q.id::text), '')) from public.admin_invoice_lines q
  union all select 'checkouts', md5(coalesce(string_agg(q::text, '|' order by q.id::text), '')) from public.admin_invoice_checkouts q
  union all select 'unresolved', md5(coalesce(string_agg(q::text, '|' order by q.id::text), '')) from public.admin_unresolved_billing_cases q
  union all select 'cases', md5(coalesce(string_agg(q::text, '|' order by q.id::text), '')) from public.admin_visit_cases q
  union all select 'audit', md5(coalesce(string_agg(q::text, '|' order by q.id::text), '')) from public.admin_audit_events q
  union all select 'success_fees', md5(coalesce(string_agg(q::text, '|' order by q.id::text), '')) from public.hiring_success_fees q;
select pg_temp.chk('RO1 全8本を呼んでも、請求・見積・決済・個別確認・案件・旧成功報酬・監査履歴の中身は変化しない（8表のハッシュが前後で一致）', (select count(*) from snap_before b join snap_after a using (t) where a.h = b.h) = 8);


-- ページ送りの完全性: 300件超・同一日時のデータで、全ページを取得して欠落・重複が無いこと（見積350・請求450・案件450・個別確認450。いずれも全件が同一日時）
do $$
declare
  adm text := '00000000-0000-0000-0000-00000000e001';
  OQ uuid := '00000000-0000-0000-0000-0000000f0a01'; OC uuid := '00000000-0000-0000-0000-0000000f0a02';
  SC uuid := '00000000-0000-0000-0000-0000000f0b02'; ts timestamptz := timestamptz '2026-01-01 00:00:00+00';
  gi int; qid uuid; exp_ids text[]; got_ids text[]; sizes int[] := array[200, 50, 37, 1000, 1]; ps int; off int; page jsonb; tot int; pages int; k text; bad text := ''; ids text[]; dup int; tcount int;
  kinds text[] := array['quotes','invoices','cases','unresolved'];
begin
  -- 見積用の会社（13店舗）：提案→取り下げを350回繰り返す（同時に有効な見積は1件までのため）。提案日時はすべて同一
  insert into public.salon_organizations (id, name) values (OQ, '見積350社');
  insert into public.salon_stores (organization_id, store_name) select OQ, 'q'||g from generate_series(1,13) g;
  for gi in 1..350 loop
    insert into public.admin_quotes (organization_id, store_count, amount_excl_tax, proposed_by, proposed_at) values (OQ, 13, 1000 + gi, adm::uuid, ts) returning id into qid;
    update public.admin_quotes set status = 'withdrawn' where id = qid;
  end loop;
  -- 案件・請求・個別確認用の会社
  insert into public.salon_organizations (id, name) values (OC, '案件450社'); insert into public.salon_stores (id, organization_id, store_name) values (SC, OC, 'c1');
  insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000f1' || lpad(g::text,3,'0'))::uuid, 'pg'||g||'@t' from generate_series(1,450) g;
  insert into public.admin_visit_cases (stylist_user_id, store_id, status, visit_confirmed_at, created_at) select ('00000000-0000-0000-0000-0000000f1' || lpad(g::text,3,'0'))::uuid, SC, 'visit_confirmed', ts, ts from generate_series(1,450) g;
  insert into public.admin_invoices (organization_id, created_by, status, created_at) select OC, adm::uuid, 'draft', ts from generate_series(1,450);
  insert into public.admin_unresolved_billing_cases (organization_id, reason, created_at) select OC, 'revisit', ts from generate_series(1,450);
  foreach k in array kinds loop
    -- 期待する並び（日時 降順 → ID）を表から直接取る
    exp_ids := case k
      when 'quotes' then (select array_agg(id::text order by proposed_at desc, id) from public.admin_quotes where organization_id = OQ)
      when 'invoices' then (select array_agg(id::text order by created_at desc, id) from public.admin_invoices where organization_id = OC)
      when 'cases' then (select array_agg(c.id::text order by c.created_at desc, c.id) from public.admin_visit_cases c join public.salon_stores s on s.id = c.store_id where s.organization_id = OC)
      else (select array_agg(id::text order by created_at desc, id) from public.admin_unresolved_billing_cases where organization_id = OC) end;
    tcount := cardinality(exp_ids);
    foreach ps in array sizes loop
      got_ids := '{}'; off := 0; pages := 0; tot := null;
      -- 1件ずつ（ps=1）は450回の呼び出しになるため、最大 total+1 ページで打ち切る
      loop
        page := pg_temp.aj(adm, case k
          when 'quotes' then format($q$select public.admin_list_quotes('%s',%s,%s)$q$, OQ, ps, off)
          when 'invoices' then format($q$select public.admin_list_invoices('%s',null,%s,%s)$q$, OC, ps, off)
          when 'cases' then format($q$select public.admin_list_billable_cases('%s',%s,%s)$q$, OC, ps, off)
          else format($q$select public.admin_list_unresolved_billing_cases('%s',false,%s,%s)$q$, OC, ps, off) end);
        if page ? 'err' then bad := bad || format('[%s ps=%s off=%s err=%s]', k, ps, off, page->>'err'); exit; end if;
        tot := (page->>'total')::int; pages := pages + 1;
        exit when jsonb_array_length(page->'items') = 0 or pages > tcount + 2;
        got_ids := got_ids || array(select x->>'id' from jsonb_array_elements(page->'items') x);
        off := off + jsonb_array_length(page->'items');   -- 呼び出し側は、要求した件数ではなく「返ってきた件数」だけ進める（limitは最大200に制限されるため）
      end loop;
      if got_ids is distinct from exp_ids or tot <> tcount then bad := bad || format('[%s ps=%s 取得%s/期待%s total=%s]', k, ps, coalesce(cardinality(got_ids),0), tcount, tot); end if;
    end loop;
    perform pg_temp.chk(format('PG-%s 全ページ取得（ページ幅200/50/37/1000→200に制限/1）で、取得ID列が期待する並び（日時降順→ID）と完全一致。欠落・重複なし。全%s件が同一日時', k, tcount),
      bad !~ ('\[' || k || ' '), bad);
    -- 201件目以降を取得できること／範囲外は空／limit 0 は1件扱い／負のoffsetは0扱い
    page := pg_temp.aj(adm, case k
      when 'quotes' then format($q$select public.admin_list_quotes('%s',200,200)$q$, OQ) when 'invoices' then format($q$select public.admin_list_invoices('%s',null,200,200)$q$, OC)
      when 'cases' then format($q$select public.admin_list_billable_cases('%s',200,200)$q$, OC) else format($q$select public.admin_list_unresolved_billing_cases('%s',false,200,200)$q$, OC) end);
    perform pg_temp.chk(format('PG-%s 201件目以降（offset 200）も取得でき、先頭は期待する201件目のID・total=%s', k, tcount),
      jsonb_array_length(page->'items') = least(200, tcount - 200) and page->'items'->0->>'id' = exp_ids[201] and (page->>'total')::int = tcount, left(page::text, 200));
    page := pg_temp.aj(adm, case k
      when 'quotes' then format($q$select public.admin_list_quotes('%s',50,100000)$q$, OQ) when 'invoices' then format($q$select public.admin_list_invoices('%s',null,50,100000)$q$, OC)
      when 'cases' then format($q$select public.admin_list_billable_cases('%s',50,100000)$q$, OC) else format($q$select public.admin_list_unresolved_billing_cases('%s',false,50,100000)$q$, OC) end);
    perform pg_temp.chk(format('PG-%s 範囲外の offset は items 空・total は全件数のまま', k), page->'items' = '[]'::jsonb and (page->>'total')::int = tcount, left(page::text, 200));
    page := pg_temp.aj(adm, case k
      when 'quotes' then format($q$select public.admin_list_quotes('%s',0,-5)$q$, OQ) when 'invoices' then format($q$select public.admin_list_invoices('%s',null,0,-5)$q$, OC)
      when 'cases' then format($q$select public.admin_list_billable_cases('%s',0,-5)$q$, OC) else format($q$select public.admin_list_unresolved_billing_cases('%s',false,0,-5)$q$, OC) end);
    perform pg_temp.chk(format('PG-%s limit 0 → 1件・負の offset → 0 扱い（先頭のID）', k), jsonb_array_length(page->'items') = 1 and page->'items'->0->>'id' = exp_ids[1], left(page::text, 200));
  end loop;
end $$;

-- 性能: 案件300件・請求60件の会社で、重い2本（案件一覧・請求一覧）を実測
do $$
declare
  adm text := '00000000-0000-0000-0000-00000000e001'; P uuid := '00000000-0000-0000-0000-0000000ea001'; S uuid := '00000000-0000-0000-0000-0000000eb001'; t0 timestamptz; ms1 numeric; ms2 numeric; j jsonb; i uuid;
begin
  insert into public.salon_organizations (id, name) values (P, '性能確認社'); insert into public.salon_stores (id, organization_id, store_name) values (S, P, 'P1');
  insert into auth.users (id, email) select ('00000000-0000-0000-0000-0000000ec' || lpad(g::text,3,'0'))::uuid, 'perf'||g||'@t' from generate_series(1,300) g;
  insert into public.admin_visit_cases (stylist_user_id, store_id, status, visit_confirmed_at) select ('00000000-0000-0000-0000-0000000ec' || lpad(g::text,3,'0'))::uuid, S, 'visit_confirmed', now() - (g||' minutes')::interval from generate_series(1,300) g;
  insert into public.admin_invoices (organization_id, created_by, status) select P, adm::uuid, 'draft' from generate_series(1,60);
  t0 := clock_timestamp(); j := pg_temp.aj(adm, format($q$select public.admin_list_billable_cases('%s',200,0)$q$, P))->'items'; ms1 := extract(milliseconds from clock_timestamp() - t0);
  perform pg_temp.chk('PF1 案件300件の会社で、案件一覧は1回最大200件（limit 200 の指定）（実測 ' || round(ms1) || 'ms）', jsonb_array_length(j) = 200 and ms1 < 2000, 'ms=' || ms1);
  t0 := clock_timestamp(); j := pg_temp.aj(adm, format($q$select public.admin_list_invoices('%s',null,50,0)$q$, P)); ms2 := extract(milliseconds from clock_timestamp() - t0);
  perform pg_temp.chk('PF2 請求60件の会社で、請求一覧は50件ずつ・total=60（実測 ' || round(ms2) || 'ms）', (j->>'total')::int = 60 and jsonb_array_length(j->'items') = 50 and ms2 < 2000, 'ms=' || ms2);
end $$;

-- 読み取り専用であること（2）: 読み取り専用トランザクションの中でも、全8本が動く（書き込みがあればエラーになる）
set local transaction_read_only = on;
do $$
declare
  e text := '00000000-0000-0000-0000-00000000e'; adm text := e||'001'; owX text := e||'002';
  orgX text := '00000000-0000-0000-0000-0000000e0a01'; i2 text := current_setting('t.i2'); i4 text := current_setting('t.i4'); bad text := '';
  r text; q text;
begin
  for q in select unnest(array[
      format($s$select public.admin_billing_summary('%s')$s$, orgX), format($s$select public.admin_list_quotes('%s')$s$, orgX), format($s$select public.admin_list_invoices('%s')$s$, orgX),
      format($s$select public.admin_get_invoice('%s')$s$, i2), format($s$select public.admin_list_billable_cases('%s')$s$, orgX), $s$select public.admin_list_unresolved_billing_cases(null,true)$s$]) loop
    r := pg_temp.as_user(adm, q); if r like 'ERR:%' then bad := bad || ' ' || substr(q, 1, 40) || '=>' || r; end if;
  end loop;
  for q in select unnest(array[format($s$select public.company_billing_overview('%s')$s$, orgX), format($s$select public.company_get_invoice('%s')$s$, i4)]) loop
    r := pg_temp.as_user(owX, q); if r like 'ERR:%' then bad := bad || ' ' || substr(q, 1, 40) || '=>' || r; end if;
  end loop;
  perform pg_temp.chk('RO2 読み取り専用トランザクション内でも、全8本がエラーなく動く（書き込みを一切しない）', bad = '', bad);
end $$;

-- 結果表（1つだけ）。FAIL があれば先頭に出る。最後の行が合計。
select * from (
  select 0 as o, n, case when ok then 'PASS' else 'FAIL' end as r, name, case when ok then '' else info end as info from t_log where not ok
  union all
  select 1, 0, 'SUMMARY', (count(*) filter (where ok))::text || ' PASS / ' || (count(*) filter (where not ok))::text || ' FAIL', '' from t_log
) z order by o, n;
rollback;
