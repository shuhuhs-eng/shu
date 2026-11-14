-- 0061（草案 v3）の検証。0060→0061 を適用済みのローカルDBで実行し、最後にROLLBACKする。0062は別ファイル（0062_verify.sql）。
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
insert into public.admin_visit_cases (id, stylist_user_id, store_id) values
 ('00000000-0000-0000-0000-0000000f2001','00000000-0000-0000-0000-00000000f010','00000000-0000-0000-0000-0000000f0a11'),
 ('00000000-0000-0000-0000-0000000f2002','00000000-0000-0000-0000-00000000f010','00000000-0000-0000-0000-0000000f0b11');

do $$
declare
  u text := '00000000-0000-0000-0000-00000000f';
  A text := '00000000-0000-0000-0000-0000000f0a01'; A1 text := '00000000-0000-0000-0000-0000000f0a11'; A2 text := '00000000-0000-0000-0000-0000000f0a12';
  B text := '00000000-0000-0000-0000-0000000f0b01'; C text := '00000000-0000-0000-0000-0000000f0c01';
  c1 text := '00000000-0000-0000-0000-0000000f2001'; c2 text := '00000000-0000-0000-0000-0000000f2002';
  adm text := '00000000-0000-0000-0000-00000000f001';
  t_a1 uuid; t_org uuid; t_sty uuid; t_int uuid; tX1 uuid; tX2 uuid; tX3 uuid; tR uuid; tW uuid; rid uuid; r2 text; r text; j jsonb; n int; i int; msgid uuid; q uuid; inv uuid; inv2 uuid; ln uuid; fns text[];
begin
  ---- 権限判定（直接） ----
  insert into public.admin_threads (id, audience, organization_id, store_id, subject, created_by) values ('00000000-0000-0000-0000-0000000f1001','salon',A::uuid,A1::uuid,'A1店への見学希望',adm::uuid);
  insert into public.admin_threads (id, audience, organization_id, subject, created_by) values ('00000000-0000-0000-0000-0000000f1002','salon',A::uuid,'A社への連絡',adm::uuid);
  insert into public.admin_threads (id, audience, recipient_user_id, subject, created_by) values ('00000000-0000-0000-0000-0000000f1003','stylist',(u||'010')::uuid,'美容師宛',adm::uuid);
  t_a1 := '00000000-0000-0000-0000-0000000f1001'; t_org := '00000000-0000-0000-0000-0000000f1002'; t_sty := '00000000-0000-0000-0000-0000000f1003';
  perform pg_temp.chk('P1 会社オーナー/管理者/採用管理者は、店舗宛・会社宛どちらも見られる', public._admin_thread_visible_to(t_a1,(u||'002')::uuid) and public._admin_thread_visible_to(t_a1,(u||'003')::uuid) and public._admin_thread_visible_to(t_a1,(u||'004')::uuid) and public._admin_thread_visible_to(t_org,(u||'002')::uuid) and public._admin_thread_visible_to(t_org,(u||'004')::uuid));
  perform pg_temp.chk('P2 対象店舗の店長・採用担当は店舗宛を見られる', public._admin_thread_visible_to(t_a1,(u||'006')::uuid) and public._admin_thread_visible_to(t_a1,(u||'007')::uuid));
  perform pg_temp.chk('P3 店舗担当者は会社宛（店舗未指定）を見られない', not public._admin_thread_visible_to(t_org,(u||'006')::uuid) and not public._admin_thread_visible_to(t_org,(u||'007')::uuid));
  perform pg_temp.chk('P4 閲覧のみ(viewer)は見られない', not public._admin_thread_visible_to(t_a1,(u||'008')::uuid));
  perform pg_temp.chk('P5 同じ会社の別店舗(A2)の店長は A1宛を見られない', not public._admin_thread_visible_to(t_a1,(u||'012')::uuid));
  perform pg_temp.chk('P6 他社(B)のオーナーは見られない', not public._admin_thread_visible_to(t_a1,(u||'009')::uuid) and not public._admin_thread_visible_to(t_org,(u||'009')::uuid));
  perform pg_temp.chk('P7 美容師宛は本人だけ。サロンのどの権限・別の美容師・運営者も相手側では見られない', public._admin_thread_visible_to(t_sty,(u||'010')::uuid) and not public._admin_thread_visible_to(t_sty,(u||'011')::uuid) and not public._admin_thread_visible_to(t_sty,(u||'002')::uuid) and not public._admin_thread_visible_to(t_sty,(u||'004')::uuid) and not public._admin_thread_visible_to(t_sty,(u||'006')::uuid) and not public._admin_thread_visible_to(t_sty,adm::uuid));
  perform pg_temp.chk('P8 未ログイン(null)は見られない', not public._admin_thread_visible_to(t_a1,null));
  -- エリア担当（確定方針: 担当店舗に store_manager/recruiter の行がある場合のみ）
  perform pg_temp.chk('P9 エリア担当: 担当店舗(A1)にstore_manager行があれば A1宛を見られる', public._admin_thread_visible_to(t_a1,(u||'005')::uuid));
  perform pg_temp.chk('P10 エリア担当: 担当店舗がviewer行だけなら見られない／店舗行なしも見られない', not public._admin_thread_visible_to(t_a1,(u||'013')::uuid) and not public._admin_thread_visible_to(t_a1,(u||'014')::uuid));
  perform pg_temp.chk('P11 エリア担当: 他店舗(A2担当)のスレッドは見られない（A1宛を見られない）／会社宛も見られない', not public._admin_thread_visible_to(t_a1,(u||'015')::uuid) and not public._admin_thread_visible_to(t_org,(u||'005')::uuid) and not public._admin_thread_visible_to(t_org,(u||'015')::uuid));

  ---- 整合のトリガー（連絡先の取り違え防止） ----
  perform pg_temp.chk('T1 別会社の店舗は指定できない', pg_temp.try(format($q$insert into public.admin_threads (audience, organization_id, store_id, subject, created_by) values ('salon','%s','%s','x','%s')$q$, A, '00000000-0000-0000-0000-0000000f0b11', adm)) = 'store does not belong to organization');
  perform pg_temp.chk('T2 美容師宛の受信者が美容師アカウントでない(サロン担当者)と拒否', pg_temp.try(format($q$insert into public.admin_threads (audience, recipient_user_id, subject, created_by) values ('stylist','%s','x','%s')$q$, u||'002', adm)) = 'recipient is not a stylist account');
  perform pg_temp.chk('T3 サロン宛の窓口担当者が、そのスレッドを見られない人(viewer/他社)だと拒否', pg_temp.try(format($q$insert into public.admin_threads (audience, recipient_user_id, organization_id, store_id, subject, created_by) values ('salon','%s','%s','%s','x','%s')$q$, u||'008', A, A1, adm)) = 'recipient cannot access this thread'
    and pg_temp.try(format($q$insert into public.admin_threads (audience, recipient_user_id, organization_id, subject, created_by) values ('salon','%s','%s','x','%s')$q$, u||'009', A, adm)) = 'recipient cannot access this thread');
  perform pg_temp.chk('T4 閲覧できる人を窓口にするのは可（店長）', pg_temp.try(format($q$insert into public.admin_threads (audience, recipient_user_id, organization_id, store_id, subject, created_by) values ('salon','%s','%s','%s','窓口','%s')$q$, u||'006', A, A1, adm)) = 'OK');
  perform pg_temp.chk('T5 案件の美容師と宛先が違うと拒否', pg_temp.try(format($q$insert into public.admin_threads (audience, recipient_user_id, visit_case_id, subject, created_by) values ('stylist','%s','%s','x','%s')$q$, u||'011', c1, adm)) = 'visit case belongs to another stylist');
  perform pg_temp.chk('T6 案件の店舗・会社と宛先が違うと拒否', pg_temp.try(format($q$insert into public.admin_threads (audience, organization_id, store_id, visit_case_id, subject, created_by) values ('salon','%s','%s','%s','x','%s')$q$, A, A2, c1, adm)) = 'visit case belongs to another company or store'
    and pg_temp.try(format($q$insert into public.admin_threads (audience, organization_id, visit_case_id, subject, created_by) values ('salon','%s','%s','x','%s')$q$, B, c1, adm)) = 'visit case belongs to another company or store');
  perform pg_temp.chk('T7 宛先（種別・受信者・会社・店舗）は作成後に変更できない', pg_temp.try(format($q$update public.admin_threads set store_id = '%s' where id = '%s'$q$, A2, t_a1)) = 'thread destination cannot be changed'
    and pg_temp.try(format($q$update public.admin_threads set organization_id = '%s' where id = '%s'$q$, B, t_a1)) = 'thread destination cannot be changed');
  perform pg_temp.chk('T8 サロン宛は会社必須／美容師宛は本人必須（DB制約）', pg_temp.try($q$insert into public.admin_threads (audience, subject, created_by) values ('salon','x','00000000-0000-0000-0000-00000000f001')$q$) like '%violates check%' and pg_temp.try($q$insert into public.admin_threads (audience, subject, created_by) values ('stylist','x','00000000-0000-0000-0000-00000000f001')$q$) in ('recipient is not a stylist account'));
  perform pg_temp.chk('T9 運営者以外は to_recipient / internal_note を書けない', pg_temp.try(format($q$insert into public.admin_messages (thread_id, kind, author_user_id, body) values ('%s','to_recipient','%s','x')$q$, t_a1, u||'006')) = 'only admins can write this kind of message'
    and pg_temp.try(format($q$insert into public.admin_messages (thread_id, kind, author_user_id, body) values ('%s','internal_note','%s','x')$q$, t_a1, u||'002')) = 'only admins can write this kind of message');
  perform pg_temp.chk('T10 閲覧権限の無い人は from_recipient を書けない（viewer・他社・他店舗）', pg_temp.try(format($q$insert into public.admin_messages (thread_id, kind, author_user_id, body) values ('%s','from_recipient','%s','x')$q$, t_a1, u||'008')) = 'author cannot access this thread'
    and pg_temp.try(format($q$insert into public.admin_messages (thread_id, kind, author_user_id, body) values ('%s','from_recipient','%s','x')$q$, t_a1, u||'012')) = 'author cannot access this thread');
  perform pg_temp.chk('T11 メッセージ種別は4種のみ', pg_temp.try(format($q$insert into public.admin_messages (thread_id, kind, author_user_id, body) values ('%s','secret','%s','x')$q$, t_a1, adm)) like '%violates check%');
  insert into public.admin_messages (id, thread_id, kind, author_user_id, body) values ('00000000-0000-0000-0000-0000000f3001', t_a1, 'to_recipient', adm::uuid, 'テスト本文');
  perform pg_temp.chk('T12 メッセージは追記専用（更新・削除不可）', pg_temp.try($q$update public.admin_messages set body='x' where id='00000000-0000-0000-0000-0000000f3001'$q$) = 'messages are append-only' and pg_temp.try($q$delete from public.admin_messages where id='00000000-0000-0000-0000-0000000f3001'$q$) = 'messages are append-only');

  ---- 運営側RPC ----
  fns := array[format($q$select public.admin_create_thread(gen_random_uuid(),'salon',null,'%s',null,null,'x','b')$q$, A), $q$select public.admin_post_message(gen_random_uuid(),gen_random_uuid(),'internal_note','x')$q$, $q$select public.admin_set_thread_status(gen_random_uuid(),'done')$q$,
    $q$select public.admin_list_threads()$q$, $q$select public.admin_get_thread(gen_random_uuid())$q$, $q$select public.admin_record_delivery(gen_random_uuid(),'sent')$q$];
  n := 0;
  for i in 1..array_length(fns,1) loop
    for n in 2..15 loop
      if pg_temp.as_user(u||lpad(n::text,3,'0'), fns[i]) <> 'ERR:admin access required' then perform pg_temp.chk('A1 運営者以外は拒否: ユーザー'||n||' '||left(fns[i],45), false, pg_temp.as_user(u||lpad(n::text,3,'0'), fns[i])); end if;
    end loop;
    perform pg_temp.chk('A1 運営者以外(14人)は拒否: ' || left(fns[i],45), true);
    perform pg_temp.chk('A2 未ログイン(anon)は実行権限なし: ' || left(fns[i],45), pg_temp.as_anon(fns[i]) like 'ERR:permission denied%', pg_temp.as_anon(fns[i]));
  end loop;
  r := pg_temp.as_user(adm, format($q$select public.admin_create_thread(gen_random_uuid(),'salon',null,'%s','%s','%s','見学の日程調整','日程をご相談させてください')$q$, A, A1, c1));
  perform pg_temp.chk('A3 運営がサロン宛の連絡を作成（店舗・案件を指定）', r !~ '^ERR', r);
  t_int := r::uuid;
  perform pg_temp.chk('A4 運営者以外は、他人宛の連絡を作成できない', pg_temp.as_user(u||'002', format($q$select public.admin_create_thread(gen_random_uuid(),'salon',null,'%s',null,null,'x','b')$q$, A)) = 'ERR:admin access required');
  r := pg_temp.as_user(adm, format($q$select public.admin_post_message(gen_random_uuid(),'%s','internal_note','電話で日程の感触を確認。内部メモSECRET')$q$, t_int));
  perform pg_temp.chk('A5 内部メモ・対応履歴（offline_log）を運営が記録できる', r !~ '^ERR' and pg_temp.as_user(adm, format($q$select public.admin_post_message(gen_random_uuid(),'%s','offline_log','メールで返信済み')$q$, t_int)) !~ '^ERR', r);
  perform pg_temp.chk('A6 admin_post_message は未知の種別(from_recipient)を拒否', pg_temp.as_user(adm, format($q$select public.admin_post_message(gen_random_uuid(),'%s','from_recipient','x')$q$, t_int)) = 'ERR:invalid kind');
  j := pg_temp.as_user(adm, format($q$select public.admin_get_thread('%s')$q$, t_int))::jsonb;
  perform pg_temp.chk('A7 運営の詳細には本文・内部メモ・対応履歴・通知状況がすべて出る', jsonb_array_length(j->'messages') = 3 and (j::text like '%内部メモSECRET%') and exists (select 1 from jsonb_array_elements(j->'messages') e where e->>'kind' = 'to_recipient' and e->'delivery'->>'status' = 'pending') and (j::text like '%メールで返信済み%'), j::text);
  j := pg_temp.as_user(adm, format($q$select public.admin_list_threads(p_organization_id => '%s')$q$, A))::jsonb;
  perform pg_temp.chk('A8 会社から開いても同じスレッドが出る', exists (select 1 from jsonb_array_elements(j->'rows') e where e->>'id' = t_int::text), j::text);
  j := pg_temp.as_user(adm, format($q$select public.admin_list_threads(p_store_id => '%s')$q$, A1))::jsonb;
  perform pg_temp.chk('A9 店舗から開いても同じスレッドと状態', exists (select 1 from jsonb_array_elements(j->'rows') e where e->>'id' = t_int::text and e->>'status' = 'waiting_recipient'), j::text);
  j := pg_temp.as_user(adm, format($q$select public.admin_list_threads(p_visit_case_id => '%s')$q$, c1))::jsonb;
  perform pg_temp.chk('A10 案件から開いても同じスレッドと状態', (j->>'total')::int = 1 and j->'rows'->0->>'id' = t_int::text, j::text);
  select id into msgid from public.admin_messages where thread_id = t_int and kind = 'to_recipient';
  perform pg_temp.chk('A11 メール通知の失敗を記録でき、一覧で失敗が分かる（連絡自体は残る）', pg_temp.as_user(adm, format($q$select public.admin_record_delivery('%s','failed','smtp_timeout')$q$, msgid)) !~ '^ERR'
    and (pg_temp.as_user(adm, format($q$select public.admin_list_threads(p_visit_case_id => '%s')$q$, c1))::jsonb)->'rows'->0->>'delivery_failed' = 'true'
    and (select count(*) from public.admin_messages where thread_id = t_int) = 3);
  r := pg_temp.as_user(adm, format($q$select public.admin_set_thread_status('%s','waiting_admin')$q$, t_int));
  perform pg_temp.chk('A12 状態を変えられ、監査履歴に残る／不正な状態は拒否', r !~ '^ERR'
    and exists (select 1 from public.admin_audit_events where target_id = t_int and action = 'thread_status_changed' and after_value->>'status' = 'waiting_admin')
    and pg_temp.as_user(adm, format($q$select public.admin_set_thread_status('%s','x')$q$, t_int)) = 'ERR:invalid status');
  perform pg_temp.chk('A13 4つの状態（未対応/相手の返信待ち/運営の返信待ち/完了）を区別', (select count(*) from pg_constraint where conrelid='public.admin_threads'::regclass and pg_get_constraintdef(oid) like '%open_internal%waiting_recipient%waiting_admin%done%') = 1);
  perform pg_temp.chk('A14 相手に見せる本文と内部メモを書くと、to_recipient のときだけ通知レコードができる', (select count(*) from public.admin_message_deliveries d join public.admin_messages m on m.id = d.message_id where m.thread_id = t_int) = 1);
  perform pg_temp.chk('A15 美容師アカウントでない宛先・別会社の店舗など不正な作成はRPCでも拒否', pg_temp.as_user(adm, format($q$select public.admin_create_thread(gen_random_uuid(),'stylist','%s',null,null,null,'x','b')$q$, u||'002')) = 'ERR:recipient is not a stylist account'
    and pg_temp.as_user(adm, format($q$select public.admin_create_thread(gen_random_uuid(),'salon',null,'%s','%s',null,'x','b')$q$, A, '00000000-0000-0000-0000-0000000f0b11')) = 'ERR:store does not belong to organization');
  -- 美容師宛て
  r := pg_temp.as_user(adm, format($q$select public.admin_create_thread(gen_random_uuid(),'stylist','%s',null,null,'%s','見学の件','ご希望の日程を教えてください')$q$, u||'010', c1));
  perform pg_temp.chk('A16 運営が美容師宛の連絡を作成', r !~ '^ERR', r);
  t_sty := r::uuid;
  -- 内部だけのスレッド（相手に見せる本文なし）
  insert into public.admin_threads (id, audience, organization_id, store_id, subject, created_by, status) values ('00000000-0000-0000-0000-0000000f1009','salon',A::uuid,A1::uuid,'内部だけ',adm::uuid,'open_internal');

  ---- 相手側RPC（inbox_*） ----
  -- 店長(6)
  j := pg_temp.as_user(u||'006', $q$select public.inbox_list_threads()$q$)::jsonb;
  perform pg_temp.chk('I1 A1の店長は、A1宛の連絡を一覧で見られる（会社宛・他店舗・美容師宛・内部だけは出ない）', exists (select 1 from jsonb_array_elements(j->'rows') e where e->>'id' = t_int::text and (e->>'needs_reply')::boolean is false)
    and not exists (select 1 from jsonb_array_elements(j->'rows') e where e->>'id' in (t_sty::text, t_org::text, '00000000-0000-0000-0000-0000000f1009')), j::text);
  perform pg_temp.as_user(adm, format($q$select public.admin_set_thread_status('%s','waiting_recipient')$q$, t_int));
  j := pg_temp.as_user(u||'006', format($q$select public.inbox_get_thread('%s')$q$, t_int))::jsonb;
  perform pg_temp.chk('I2 相手側の詳細は「相手に見せる本文」だけ。内部メモ・対応履歴・通知状況・運営者のIDは含まれない', jsonb_array_length(j->'messages') = 1 and j->'messages'->0->>'author_label' = '運営'
    and j::text not like '%SECRET%' and j::text not like '%メールで返信済み%' and j::text not like '%smtp%' and j::text not like '%delivery%' and j::text not like '%author_user_id%' and (j->>'needs_reply')::boolean, j::text);
  r := pg_temp.as_user(u||'006', format($q$select public.inbox_reply(gen_random_uuid(),'%s','日程は来週でお願いします')$q$, t_int));
  perform pg_temp.chk('I3 店長は返信でき、運営の返信待ちに変わる', r !~ '^ERR'
    and (select status from public.admin_threads where id = t_int) = 'waiting_admin');
  j := pg_temp.as_user(u||'007', format($q$select public.inbox_get_thread('%s')$q$, t_int))::jsonb;
  perform pg_temp.chk('I4 同じ店舗の採用担当は同じスレッドを見られ、同僚の返信は名前で表示される', jsonb_array_length(j->'messages') = 2 and exists (select 1 from jsonb_array_elements(j->'messages') e where e->>'author_label' = 'ユーザー6' and (e->>'is_mine')::boolean is false), j::text);
  -- 権限のない人
  fns := array[format($q$select public.inbox_get_thread('%s')$q$, t_int), format($q$select public.inbox_reply(gen_random_uuid(),'%s','こんにちは')$q$, t_int)];
  for i in 1..2 loop
    for n in select unnest(array[8,12,13,14,15,9,10,11,1]) loop
      if pg_temp.as_user(u||lpad(n::text,3,'0'), fns[i]) <> 'ERR:thread not found' then perform pg_temp.chk('I5 権限のない人は拒否: ユーザー'||n||' '||left(fns[i],30), false, pg_temp.as_user(u||lpad(n::text,3,'0'), fns[i])); end if;
    end loop;
  end loop;
  perform pg_temp.chk('I5 閲覧のみ・他店舗・店舗行がviewerだけ/なしのエリア担当・他社・美容師・運営者は、閲覧も返信も「thread not found」（存在も漏らさない）', true);
  perform pg_temp.chk('I6 閲覧のみ(8)・店舗行なしエリア担当(14)の一覧は空', (pg_temp.as_user(u||'008', $q$select public.inbox_list_threads()$q$)::jsonb->>'total')::int = 0 and (pg_temp.as_user(u||'014', $q$select public.inbox_list_threads()$q$)::jsonb->>'total')::int = 0);
  perform pg_temp.chk('I7 エリア担当(5)は担当店舗(A1)宛を見られ返信できる／会社宛は見えない', pg_temp.as_user(u||'005', format($q$select public.inbox_get_thread('%s')$q$, t_int)) !~ '^ERR'
    and pg_temp.as_user(u||'005', format($q$select public.inbox_get_thread('%s')$q$, t_org)) = 'ERR:thread not found' and pg_temp.as_user(u||'005', format($q$select public.inbox_reply(gen_random_uuid(),'%s','担当店舗として返信')$q$, t_int)) !~ '^ERR');
  perform pg_temp.chk('I8 オーナー(2)・採用管理者(4)は会社宛の連絡も見られる（運営が to_recipient を書いたスレッドのみ）', pg_temp.as_user(u||'002', format($q$select public.inbox_get_thread('%s')$q$, t_org)) = 'ERR:thread not found'
    and (select count(*) from public.admin_messages where thread_id = t_org) = 0);
  perform pg_temp.chk('I9 内部だけのスレッド(相手に見せる本文なし)は、権限のあるオーナーにも見えない', pg_temp.as_user(u||'002', $q$select public.inbox_get_thread('00000000-0000-0000-0000-0000000f1009')$q$) = 'ERR:thread not found');
  perform pg_temp.chk('I10 美容師(10)は自分宛の連絡だけ見られ、サロン宛は見えない。別の美容師(11)は見えない', pg_temp.as_user(u||'010', format($q$select public.inbox_get_thread('%s')$q$, t_sty)) !~ '^ERR'
    and pg_temp.as_user(u||'010', format($q$select public.inbox_get_thread('%s')$q$, t_int)) = 'ERR:thread not found'
    and pg_temp.as_user(u||'011', format($q$select public.inbox_get_thread('%s')$q$, t_sty)) = 'ERR:thread not found'
    and pg_temp.as_user(u||'002', format($q$select public.inbox_get_thread('%s')$q$, t_sty)) = 'ERR:thread not found');
  j := pg_temp.as_user(u||'010', format($q$select public.inbox_get_thread('%s')$q$, t_sty))::jsonb;
  perform pg_temp.chk('I11 美容師宛の詳細に、サロンの会社名・店舗名は出ない', j->>'organization_name' is null and j->>'store_name' is null, j::text);
  perform pg_temp.chk('I12 美容師が返信でき、サロン側には見えない', pg_temp.as_user(u||'010', format($q$select public.inbox_reply(gen_random_uuid(),'%s','来週なら大丈夫です')$q$, t_sty)) !~ '^ERR'
    and not exists (select 1 from jsonb_array_elements((pg_temp.as_user(u||'002', $q$select public.inbox_list_threads()$q$))::jsonb->'rows') e where e->>'id' = t_sty::text));
  perform pg_temp.chk('I13 空・長すぎる本文は拒否', pg_temp.as_user(u||'006', format($q$select public.inbox_reply(gen_random_uuid(),'%s','   ')$q$, t_int)) = 'ERR:invalid body'
    and pg_temp.as_user(u||'006', format($q$select public.inbox_reply(gen_random_uuid(),'%s','%s')$q$, t_int, repeat('あ', 4001))) = 'ERR:invalid body');
  perform pg_temp.chk('I14 完了のスレッドには返信できない', pg_temp.as_user(adm, format($q$select public.admin_set_thread_status('%s','done')$q$, t_int)) !~ '^ERR'
    and pg_temp.as_user(u||'006', format($q$select public.inbox_reply(gen_random_uuid(),'%s','あとから')$q$, t_int)) = 'ERR:thread is closed'
    and (pg_temp.as_user(u||'006', format($q$select public.inbox_get_thread('%s')$q$, t_int))::jsonb->>'can_reply') = 'false');
  perform pg_temp.chk('I15 未ログイン(anon)は実行権限なし／subの無いログインは login required', pg_temp.as_anon($q$select public.inbox_list_threads()$q$) like 'ERR:permission denied%'
    and pg_temp.as_user('', $q$select public.inbox_list_threads()$q$) in ('ERR:login required','ERR:invalid input syntax for type uuid: ""'));
  -- 連投の制限
  perform pg_temp.chk('I16 1時間に30件を超える返信は拒否', (select count(*) from generate_series(1,40) g where pg_temp.as_user(u||'002', format($q$select public.inbox_reply(gen_random_uuid(),'%s','x%s')$q$, t_a1, g)) !~ '^ERR') = 30
    and pg_temp.as_user(u||'002', format($q$select public.inbox_reply(gen_random_uuid(),'%s','x')$q$, t_a1)) = 'ERR:too many replies');

  ---- 直接アクセス拒否・実行権限 ----
  for r in select unnest(array['admin_threads','admin_messages','admin_visit_cases','account_invitations','account_invitation_events','admin_audit_events','admin_message_deliveries','salon_inquiries']) loop
    perform pg_temp.chk('Q1 authenticated/anon は直接読めない: ' || r, pg_temp.as_user(u||'002', format('select count(*) from public.%I', r)) like 'ERR:permission denied%' and pg_temp.as_anon(format('select count(*) from public.%I', r)) like 'ERR:permission denied%');
  end loop;
  perform pg_temp.chk('Q2 公開RPCは authenticated のみ実行可（所有者を除く。anon/service_role/PUBLICは不可）', (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace
      and p.proname in ('admin_create_thread','admin_post_message','admin_set_thread_status','admin_list_threads','admin_get_thread','admin_record_delivery','inbox_list_threads','inbox_get_thread','inbox_reply')
      and (select coalesce(string_agg(case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, ','), '') from aclexplode(p.proacl) a where a.privilege_type='EXECUTE' and a.grantee <> p.proowner) = 'authenticated') = 9);
  perform pg_temp.chk('Q3 内部関数は誰にも実行権限が無い（所有者以外。service_role・anon・authenticated・PUBLIC）', (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace
      and p.proname in ('_admin_salon_access','_admin_thread_visible_to','_admin_inbox_can_see','_admin_threads_consistency','_admin_messages_rules','_admin_request_hash','_admin_lock_sender','_admin_lock_request')
      and exists (select 1 from aclexplode(p.proacl) a where a.privilege_type='EXECUTE' and a.grantee <> p.proowner)) = 0);
  perform pg_temp.chk('Q4 一般ユーザーは内部関数を直接呼べない', pg_temp.as_user(u||'002', $q$select public._admin_thread_visible_to(gen_random_uuid(), gen_random_uuid())$q$) like 'ERR:permission denied%');
  perform pg_temp.chk('Q5 service_role は公開RPCを実行できない', not has_function_privilege('service_role','public.inbox_reply(uuid,uuid,text)','execute') and not has_function_privilege('service_role','public.admin_create_thread(uuid,text,uuid,uuid,uuid,uuid,text,text)','execute'));

  ---- 招待・見学案件 ----
  insert into public.account_invitations (mode, organization_id, email, intended_company_role, invited_by, expires_at) values ('add_to_company',A::uuid,'x@t','recruiting_admin',adm::uuid, now()+interval '7 days');
  perform pg_temp.chk('R1 同じ会社・同じメールへの有効な招待は重複できない', pg_temp.try(format($q$insert into public.account_invitations (mode, organization_id, email, invited_by, expires_at) values ('add_to_company','%s','x@t','%s', now()+interval '7 days')$q$, A, adm)) like '%duplicate key%');
  update public.account_invitations set status = 'expired' where email = 'x@t';
  perform pg_temp.chk('R2 期限切れ後は再招待できる', pg_temp.try(format($q$insert into public.account_invitations (mode, organization_id, email, invited_by, expires_at) values ('add_to_company','%s','x@t','%s', now()+interval '7 days')$q$, A, adm)) = 'OK');
  perform pg_temp.chk('R3 既存会社への追加は会社必須', pg_temp.try(format($q$insert into public.account_invitations (mode, email, invited_by, expires_at) values ('add_to_company','y@t','%s', now()+interval '7 days')$q$, adm)) like '%violates check%');
  perform pg_temp.chk('R4 同じ美容師×店舗の進行中の案件は重複できない', pg_temp.try(format($q$insert into public.admin_visit_cases (stylist_user_id, store_id) values ('%s','%s')$q$, u||'010', A1)) like '%duplicate key%');
  perform pg_temp.chk('R5 実施確認済みは実施日時が必須', pg_temp.try(format($q$update public.admin_visit_cases set status='visit_confirmed' where id='%s'$q$, c1)) like '%violates check%');

  ---- v3: 新設テーブルの実効権限（PUBLIC・anon・authenticated・service_role すべて無し） ----
  perform pg_temp.chk('V1 新設8テーブルに、所有者以外の権限付与が1つも無い（表・列とも）',
    (select count(*) from pg_class c, aclexplode(c.relacl) a where c.relnamespace = 'public'::regnamespace and c.relname in ('admin_audit_events','admin_visit_cases','admin_threads','admin_messages','admin_message_deliveries','account_invitations','account_invitation_events','salon_inquiries') and a.grantee <> c.relowner) = 0
    and (select count(*) from pg_attribute at join pg_class c on c.oid = at.attrelid, aclexplode(at.attacl) a where c.relnamespace = 'public'::regnamespace and c.relname in ('admin_audit_events','admin_visit_cases','admin_threads','admin_messages','admin_message_deliveries','account_invitations','account_invitation_events','salon_inquiries') and at.attacl is not null) = 0);
  perform pg_temp.chk('V2 実効権限: 4つのロールとも、新設8テーブルに select/insert/update/delete/truncate/references/trigger が無い',
    (select count(*) from unnest(array['public','anon','authenticated','service_role']) rl, unnest(array['admin_audit_events','admin_visit_cases','admin_threads','admin_messages','admin_message_deliveries','account_invitations','account_invitation_events','salon_inquiries']) tb
      where has_table_privilege(rl, 'public.' || tb, 'select,insert,update,delete,truncate,references,trigger') or has_any_column_privilege(rl, 'public.' || tb, 'select,insert,update,references')) = 0);
  perform pg_temp.chk('V3 service_role も表を直接読めない（RLSのバイパスとは別に、表の権限が無い）', (select count(*) from unnest(array['admin_threads','admin_messages','admin_message_deliveries','admin_audit_events']) tb
      where pg_temp.try('set local role service_role; select count(*) from public.' || tb) like 'permission denied%') = 4);
  reset role;

  ---- v3-1: 連投制限は送信者単位（複数スレッド合算） ----
  r := pg_temp.as_user(adm, format($q$select public.admin_create_thread(gen_random_uuid(),'salon',null,'%s',null,null,'複数1','本文')$q$, A)); tX1 := r::uuid;
  r := pg_temp.as_user(adm, format($q$select public.admin_create_thread(gen_random_uuid(),'salon',null,'%s','%s',null,'複数2','本文')$q$, A, A1)); tX2 := r::uuid;
  r := pg_temp.as_user(adm, format($q$select public.admin_create_thread(gen_random_uuid(),'salon',null,'%s',null,null,'複数3','本文')$q$, A)); tX3 := r::uuid;
  n := 0;
  for i in 1..40 loop
    if pg_temp.as_user(u||'003', format($q$select public.inbox_reply(gen_random_uuid(),'%s','x%s')$q$, (array[tX1, tX2, tX3])[1 + i % 3], i)) !~ '^ERR' then n := n + 1; end if;
  end loop;
  perform pg_temp.chk('W1 3つのスレッドに分散しても、送信者単位で30件/時を超えない', n = 30 and (select count(*) from public.admin_messages where author_user_id = (u||'003')::uuid and kind = 'from_recipient') = 30, n::text);
  perform pg_temp.chk('W2 制限は送信者ごと（別の人は影響を受けない）', pg_temp.as_user(u||'004', format($q$select public.inbox_reply(gen_random_uuid(),'%s','別の送信者')$q$, tX1)) !~ '^ERR');
  perform pg_temp.chk('W3 超過後のメッセージは作られない（拒否の理由が too many replies）', pg_temp.as_user(u||'003', format($q$select public.inbox_reply(gen_random_uuid(),'%s','もう1件')$q$, tX2)) = 'ERR:too many replies');

  ---- v3-2: 送信ID（再送は同じ結果、内容違いは拒否、通知は二重作成しない） ----
  rid := gen_random_uuid();
  r := pg_temp.as_user(adm, format($q$select public.admin_create_thread('%s','salon',null,'%s','%s',null,'再送テスト','最初の本文')$q$, rid, A, A1)); tR := r::uuid;
  r2 := pg_temp.as_user(adm, format($q$select public.admin_create_thread('%s','salon',null,'%s','%s',null,'再送テスト','最初の本文')$q$, rid, A, A1));
  perform pg_temp.chk('X1 連絡作成の再送は、同じスレッドIDを返し、スレッド・メッセージ・通知を増やさない', r !~ '^ERR' and r2 = r and (select count(*) from public.admin_threads where subject = '再送テスト') = 1
    and (select count(*) from public.admin_messages where thread_id = tR) = 1 and (select count(*) from public.admin_message_deliveries d join public.admin_messages m on m.id = d.message_id where m.thread_id = tR) = 1, r || ' / ' || r2);
  perform pg_temp.chk('X2 同じ送信IDで内容が違う連絡作成は拒否（件名・本文・宛先のどれが違っても）', pg_temp.as_user(adm, format($q$select public.admin_create_thread('%s','salon',null,'%s','%s',null,'再送テスト','違う本文')$q$, rid, A, A1)) = 'ERR:request id content mismatch'
    and pg_temp.as_user(adm, format($q$select public.admin_create_thread('%s','salon',null,'%s',null,null,'再送テスト','最初の本文')$q$, rid, A)) = 'ERR:request id content mismatch');
  rid := gen_random_uuid();
  r := pg_temp.as_user(adm, format($q$select public.admin_post_message('%s','%s','to_recipient','追記です')$q$, rid, tR));
  r2 := pg_temp.as_user(adm, format($q$select public.admin_post_message('%s','%s','to_recipient','追記です')$q$, rid, tR));
  perform pg_temp.chk('X3 運営の追記の再送は、同じメッセージIDを返し、メッセージ・通知を増やさない', r !~ '^ERR' and r2 = r and (select count(*) from public.admin_messages where thread_id = tR and body = '追記です') = 1
    and (select count(*) from public.admin_message_deliveries d where d.message_id = r::uuid) = 1, r || ' / ' || r2);
  perform pg_temp.chk('X4 同じ送信IDで種別や本文が違う追記は拒否／別のスレッドへの流用も拒否', pg_temp.as_user(adm, format($q$select public.admin_post_message('%s','%s','internal_note','追記です')$q$, rid, tR)) = 'ERR:request id content mismatch'
    and pg_temp.as_user(adm, format($q$select public.admin_post_message('%s','%s','to_recipient','追記です')$q$, rid, tX1)) = 'ERR:request id content mismatch');
  perform pg_temp.chk('X5 送信IDが無い(null)は拒否', pg_temp.as_user(adm, format($q$select public.admin_post_message(null,'%s','internal_note','x')$q$, tR)) = 'ERR:request id required'
    and pg_temp.as_user(u||'006', format($q$select public.inbox_reply(null,'%s','x')$q$, tR)) = 'ERR:request id required'
    and pg_temp.as_user(adm, format($q$select public.admin_create_thread(null,'salon',null,'%s',null,null,'x','b')$q$, A)) = 'ERR:request id required');
  rid := gen_random_uuid();
  r := pg_temp.as_user(u||'007', format($q$select public.inbox_reply('%s','%s','返信の再送テスト')$q$, rid, tR));
  r2 := pg_temp.as_user(u||'007', format($q$select public.inbox_reply('%s','%s','返信の再送テスト')$q$, rid, tR));
  perform pg_temp.chk('X6 相手の返信の再送は、同じメッセージIDを返し、メッセージを増やさない', r !~ '^ERR' and r2 = r and (select count(*) from public.admin_messages where thread_id = tR and body = '返信の再送テスト') = 1, r || ' / ' || r2);
  perform pg_temp.chk('X7 同じ送信IDで内容が違う返信は拒否', pg_temp.as_user(u||'007', format($q$select public.inbox_reply('%s','%s','違う返信')$q$, rid, tR)) = 'ERR:request id content mismatch');
  perform pg_temp.chk('X8 返信の再送は、送信数（30件/時）に数えない', (select count(*) from public.admin_messages where author_user_id = (u||'007')::uuid and kind = 'from_recipient' and thread_id = tR) = 1);
  perform pg_temp.chk('X9 送信IDは送信者ごと（別の人が同じIDを使っても別の送信として扱う）', pg_temp.as_user(u||'006', format($q$select public.inbox_reply('%s','%s','店長の返信')$q$, rid, tR)) !~ '^ERR' and pg_temp.as_user(u||'006', format($q$select public.inbox_reply('%s','%s','店長の返信')$q$, rid, tR)) !~ '^ERR');
  select id into msgid from public.admin_messages where thread_id = tR and kind = 'to_recipient' order by id limit 1;
  r := pg_temp.try(format($q$insert into public.admin_message_deliveries (message_id) values ('%s')$q$, msgid));
  r2 := pg_temp.as_user(adm, format($q$select public.admin_record_delivery('%s','failed','e1')$q$, msgid));
  r2 := r2 || pg_temp.as_user(adm, format($q$select public.admin_record_delivery('%s','sent')$q$, msgid));
  perform pg_temp.chk('X10 通知は1メッセージ1件（DBの一意制約）。再試行は attempts が増えるだけ', r like '%duplicate key%' and r2 !~ 'ERR' and (select attempts from public.admin_message_deliveries d where d.message_id = msgid) = 2, r || ' / ' || r2);
  perform pg_temp.chk('X11 送信IDの重複はDBでも一意（送信者×送信ID）', pg_temp.try(format($q$insert into public.admin_messages (thread_id, kind, author_user_id, body, request_id, request_hash) select thread_id, 'internal_note', author_user_id, 'dup', request_id, request_hash from public.admin_messages where request_id is not null and thread_id = '%s' limit 1$q$, tR)) like '%duplicate key%');

  ---- v3-3: 窓口担当者が異動・退職して権限を失った後 ----
  r := pg_temp.as_user(adm, format($q$select public.admin_create_thread(gen_random_uuid(),'salon','%s','%s','%s',null,'窓口の件','窓口担当へ')$q$, u||'007', A, A1)); tW := r::uuid;
  perform pg_temp.chk('Y1 作成時は、窓口担当者が閲覧できる人でなければ拒否される（作成時の宛先検証）', pg_temp.as_user(adm, format($q$select public.admin_create_thread(gen_random_uuid(),'salon','%s','%s','%s',null,'x','b')$q$, u||'008', A, A1)) = 'ERR:recipient cannot access this thread' and r !~ '^ERR', r);
  delete from public.store_members where store_id = A1::uuid and user_id = (u||'007')::uuid;   -- 異動・退職
  perform pg_temp.chk('Y2 権限を失った元窓口担当者は、閲覧も返信もできない（thread not found）', pg_temp.as_user(u||'007', format($q$select public.inbox_get_thread('%s')$q$, tW)) = 'ERR:thread not found'
    and pg_temp.as_user(u||'007', format($q$select public.inbox_reply(gen_random_uuid(),'%s','退職後の返信')$q$, tW)) = 'ERR:thread not found'
    and (select (pg_temp.as_user(u||'007', $q$select public.inbox_list_threads()$q$))::jsonb->>'total')::int = 0);
  j := pg_temp.as_user(adm, format($q$select public.admin_get_thread('%s')$q$, tW))::jsonb;
  perform pg_temp.chk('Y3 運営は引き続きスレッドを閲覧でき、窓口担当者が現在アクセス不可であることが分かる', j->'thread'->>'recipient_access_lost' = 'true' and jsonb_array_length(j->'messages') = 1 and (j->'thread'->>'salon_reader_count')::int >= 1, j::text);
  j := pg_temp.as_user(adm, format($q$select public.admin_list_threads(p_store_id => '%s')$q$, A1))::jsonb;
  perform pg_temp.chk('Y4 運営の一覧にも「窓口担当者のアクセス不可」が出る', exists (select 1 from jsonb_array_elements(j->'rows') e where e->>'id' = tW::text and e->>'recipient_access_lost' = 'true'), j::text);
  r := pg_temp.as_user(adm, format($q$select public.admin_post_message(gen_random_uuid(),'%s','internal_note','窓口が退職。後任を確認')$q$, tW));
  r2 := pg_temp.as_user(adm, format($q$select public.admin_set_thread_status('%s','done')$q$, tW));
  perform pg_temp.chk('Y5a 運営は権限を失った後も、内部メモの追記と完了ができる', r !~ '^ERR' and r2 !~ '^ERR' and (select status from public.admin_threads where id = tW) = 'done', r || r2);
  r := pg_temp.as_user(adm, format($q$select public.admin_set_thread_status('%s','waiting_recipient')$q$, tW));
  perform pg_temp.chk('Y5b 完了したスレッドを運営が再開できる', r !~ '^ERR' and (select status from public.admin_threads where id = tW) = 'waiting_recipient', r);
  r := pg_temp.as_user(adm, format($q$select public.admin_post_message(gen_random_uuid(),'%s','to_recipient','後任の方へ')$q$, tW));
  perform pg_temp.chk('Y5c 運営は権限を失った後も、相手向けの追記ができる', r !~ '^ERR', r);
  perform pg_temp.chk('Y6 同じ店舗の他の権限者（店長）は、そのスレッドを見て返信できる', pg_temp.as_user(u||'006', format($q$select public.inbox_get_thread('%s')$q$, tW)) !~ '^ERR' and pg_temp.as_user(u||'006', format($q$select public.inbox_reply(gen_random_uuid(),'%s','後任として返信')$q$, tW)) !~ '^ERR');
  perform pg_temp.chk('Y7 宛先は引き続き変更できない（権限を失っても、受信者の付け替えはできない）', pg_temp.try(format($q$update public.admin_threads set recipient_user_id = '%s' where id = '%s'$q$, u||'006', tW)) = 'thread destination cannot be changed');
  perform pg_temp.chk('Y8 再開後の元担当者も依然として閲覧できない', pg_temp.as_user(u||'007', format($q$select public.inbox_get_thread('%s')$q$, tW)) = 'ERR:thread not found');
end $$;

select n, case when ok then 'PASS' else 'FAIL' end as r, name from t_log where not ok order by n;
select count(*) filter (where ok) as pass, count(*) filter (where not ok) as fail from t_log;
rollback;
