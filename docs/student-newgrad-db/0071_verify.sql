-- 0071草案の検証（ローカルDB専用。全体をROLLBACKする）。前提: 0058→0070→0071 を順に適用済みのDB
\set ON_ERROR_STOP on
begin;
create temp table t_log (n serial, name text, ok boolean, info text);
grant all on t_log to public; grant all on sequence t_log_n_seq to public;
create or replace function pg_temp.chk(p_name text, p_ok boolean, p_info text default '') returns void language sql as $$ insert into t_log(name, ok, info) values (p_name, coalesce(p_ok,false), p_info) $$;
create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$ begin execute p_sql; return 'OK'; exception when others then return sqlerrm; end $$;

insert into auth.users (id,email) values ('00000000-0000-0000-0000-0000000c0001','c1@t'),('00000000-0000-0000-0000-0000000c0002','c2@t'),('00000000-0000-0000-0000-0000000c0003','c3@t') on conflict do nothing;
insert into public.profiles (id,role) values ('00000000-0000-0000-0000-0000000c0001','stylist'),('00000000-0000-0000-0000-0000000c0002','stylist'),('00000000-0000-0000-0000-0000000c0003','stylist') on conflict do nothing;
insert into public.user_roles (user_id,role) values ('00000000-0000-0000-0000-0000000c0001','stylist'),('00000000-0000-0000-0000-0000000c0002','stylist'),('00000000-0000-0000-0000-0000000c0003','stylist') on conflict do nothing;
insert into public.stylist_profiles (user_id) values ('00000000-0000-0000-0000-0000000c0001'),('00000000-0000-0000-0000-0000000c0002') on conflict do nothing;
grant select on public.stylist_profiles to authenticated;

create or replace function pg_temp.as_user(u uuid) returns void language sql as $$ select set_config('request.jwt.claims', format('{"sub":"%s"}', u), true) $$;
create or replace function pg_temp.ans(a text) returns jsonb language sql as $$
  select jsonb_build_object('q1',a,'q2',a,'q3',a,'q4',a,'q5',a,'q6',a,'q7',a,'q9',a,'q10',a,'q11',a,'q12',a,'q13',a,'q14',a) $$;
create or replace function pg_temp.scommit(u uuid, req uuid, a jsonb) returns jsonb language sql as $$ select public.commit_student_diagnosis(u, req, 'student_newgrad_v1', a, '{"x":1}'::jsonb) $$;
create or replace function pg_temp.ecommit(u uuid, req uuid, a jsonb) returns jsonb language sql as $$
  select public.commit_diagnosis_result(u, req, true, '1.0.0', 'stylist', a, 50::smallint,50::smallint,50::smallint,50::smallint,50::smallint,50::smallint,'T1','タイプ',50::smallint,'300-350') $$;
grant execute on function pg_temp.as_user(uuid), pg_temp.ans(text), pg_temp.scommit(uuid,uuid,jsonb), pg_temp.ecommit(uuid,uuid,jsonb) to public;

do $$
declare
  u1 uuid := '00000000-0000-0000-0000-0000000c0001'; u2 uuid := '00000000-0000-0000-0000-0000000c0002'; u3 uuid := '00000000-0000-0000-0000-0000000c0003';
  r jsonb; m text; n int; md date := date_trunc('month', (now() at time zone 'Asia/Tokyo'))::date;
  r1 jsonb; r2 jsonb; cc int;
begin
  -- ===== 区分の設定 =====
  select count(*) into n from public.stylist_profiles where career_phase is not null;
  perform pg_temp.chk('B1 既存・新規とも区分はNULL（未設定）', n = 0, n::text);
  set local role authenticated; perform pg_temp.as_user(u1);
  m := pg_temp.try(format($q$select public.set_stylist_career_phase('student', %L, 'planned', %L, 'studying')$q$, (md + interval '6 months')::date, (md + interval '7 months')::date));
  perform pg_temp.chk('B2 学生を設定', m = 'OK', m);
  reset role;
  perform pg_temp.chk('B3 値が保存（年月は月初）', (select career_phase='student' and graduation_ym=(md + interval '6 months')::date and license_status='studying' from public.stylist_profiles where user_id=u1));
  set local role authenticated; perform pg_temp.as_user(u1);
  m := pg_temp.try(format($q$select public.set_stylist_career_phase('student', %L, 'completed', null, null)$q$, md));
  perform pg_temp.chk('B4 学生で卒業済は拒否', m like '%student requires planned%', m);
  m := pg_temp.try(format($q$select public.set_stylist_career_phase('new_graduate', %L, 'planned', %L, null)$q$, (md + interval '3 months')::date, (md + interval '1 month')::date));
  perform pg_temp.chk('B5 就業開始が卒業より前は拒否', m like '%desired start%', m);
  m := pg_temp.try(format($q$select public.set_stylist_career_phase('new_graduate', %L, 'completed', null, 'obtained')$q$, (md - interval '2 months')::date));
  perform pg_temp.chk('B6 新卒（卒業済・免許取得済）を設定', m = 'OK', m);
  m := pg_temp.try(format($q$select public.set_stylist_career_phase('experienced', %L, null, null, null)$q$, md));
  perform pg_temp.chk('B7 経験者に卒業月は拒否', m like '%must be empty%', m);
  m := pg_temp.try(format($q$select public.set_stylist_career_phase('new_graduate', %L, 'completed', null, null)$q$, (md + interval '2 months')::date));
  perform pg_temp.chk('B8 未来の卒業済は拒否', m like '%cannot be in the future%', m);
  m := pg_temp.try(format($q$select public.set_stylist_career_phase('student', %L, 'planned', null, null)$q$, (md + interval '10 years')::date));
  perform pg_temp.chk('B9 範囲外の卒業月は拒否', m like '%out of range%', m);
  m := pg_temp.try($q$select public.set_stylist_career_phase('bogus', null, null, null, null)$q$);
  perform pg_temp.chk('B10 不正な区分は拒否', m like '%invalid career phase%', m);
  m := pg_temp.try($q$select public.set_stylist_career_phase(null, null, null, null, null)$q$);
  perform pg_temp.chk('B11 NULLで未設定へ戻せる', m = 'OK', m);
  reset role;
  perform pg_temp.chk('B12 戻すと関連列もNULL', (select career_phase is null and graduation_ym is null and license_status is null from public.stylist_profiles where user_id=u1));
  -- 直接UPDATE不可・他人不可・未ログイン不可
  set local role authenticated; perform pg_temp.as_user(u1);
  m := pg_temp.try($q$update public.stylist_profiles set career_phase='student' where user_id='00000000-0000-0000-0000-0000000c0001'$q$);
  perform pg_temp.chk('B13 直接UPDATEは不可', m like '%permission denied%', m);
  perform set_config('request.jwt.claims', '{}', true);
  m := pg_temp.try($q$select public.set_stylist_career_phase('experienced', null, null, null, null)$q$);
  perform pg_temp.chk('B14 未ログインは拒否', m like '%not authenticated%', m);
  set local role anon; m := pg_temp.try($q$select public.set_stylist_career_phase('experienced', null, null, null, null)$q$);
  perform pg_temp.chk('B15 anonは実行不可', m like '%permission denied%', m);
  reset role;
  -- 他人の行は変えない（u3 はプロフィール行なし→拒否）
  set local role authenticated; perform pg_temp.as_user(u3);
  m := pg_temp.try($q$select public.set_stylist_career_phase('experienced', null, null, null, null)$q$);
  perform pg_temp.chk('B16 プロフィール行がない人は設定不可', m like '%profile not found%', m);
  reset role;
  -- 卒業区分NULLの拒否（RPCと制約の両方）
  set local role authenticated; perform pg_temp.as_user(u1);
  m := pg_temp.try(format($q$select public.set_stylist_career_phase('new_graduate', %L, null, null, null)$q$, (md - interval '1 month')::date));
  perform pg_temp.chk('B18 新卒で卒業区分NULLはRPCが拒否', m like '%graduation kind required%', m);
  m := pg_temp.try(format($q$select public.set_stylist_career_phase('student', %L, null, null, null)$q$, (md + interval '3 months')::date));
  perform pg_temp.chk('B19 学生で卒業区分NULLはRPCが拒否', m like '%graduation kind required%', m);
  reset role;
  m := pg_temp.try(format($q$update public.stylist_profiles set career_phase='new_graduate', graduation_ym=%L, graduation_kind=null where user_id=%L$q$, (md - interval '1 month')::date, u2));
  perform pg_temp.chk('B20 新卒で卒業区分NULLは制約が拒否（RPCを通さない直接書き込みでも）', m like '%career_phase_consistent%', m);
  m := pg_temp.try(format($q$update public.stylist_profiles set career_phase='student', graduation_ym=%L, graduation_kind=null where user_id=%L$q$, (md + interval '3 months')::date, u2));
  perform pg_temp.chk('B21 学生で卒業区分NULLも制約が拒否', m like '%career_phase_consistent%', m);
  -- 整合制約（直接）
  m := pg_temp.try($q$update public.stylist_profiles set career_phase='experienced', license_status='obtained' where user_id='00000000-0000-0000-0000-0000000c0002'$q$);
  perform pg_temp.chk('B17 整合制約: 経験者+免許は不可', m like '%consistent%', m);

  -- ===== 学生診断の保存と回数制限（経験者診断と状態を共有） =====
  set local role service_role;
  r := pg_temp.scommit(u1, gen_random_uuid(), pg_temp.ans('a')); perform pg_temp.chk('C1 学生診断 初回', r->>'action'='initial', r::text);
  r := pg_temp.scommit(u1, gen_random_uuid(), pg_temp.ans('a')); perform pg_temp.chk('C2 同じ回答の再保存は変更に数えない', r->>'action'='unchanged', r::text);
  reset role;
  select count(*) into n from public.student_diagnosis_results where user_id=u1; perform pg_temp.chk('C3 同じ回答は行を増やさない', n=1, n::text);
  set local role service_role;
  r1 := pg_temp.scommit(u1, gen_random_uuid(), pg_temp.ans('b')); perform pg_temp.chk('C4 回答変更1回目', r1->>'action'='change', r1::text);
  m := pg_temp.try(format($q$select pg_temp.scommit(%L, %L, pg_temp.ans('c'))$q$, u1, gen_random_uuid()));
  perform pg_temp.chk('C5 ロック中の変更は拒否', m like '%diagnosis_change_locked%', m);
end $$;

reset role;
-- 続けて検証できるよう、再度ブロックで検証
do $$
declare u1 uuid := '00000000-0000-0000-0000-0000000c0001'; u2 uuid := '00000000-0000-0000-0000-0000000c0002'; n int; m text; rid uuid := gen_random_uuid(); r jsonb; lc record;
begin
  select count(*) into n from public.student_diagnosis_results where user_id=u1; perform pg_temp.chk('C6 拒否後も行は2件（初回+変更1）', n=2, n::text);
  select * into lc from public.diagnosis_change_limits where user_id=u1 and kind='stylist';
  perform pg_temp.chk('C7 状態は経験者(kind=stylist)と共有・変更回数1・ロック設定済', lc.change_count=1 and lc.locked_until > now(), coalesce(lc.change_count::text,'null'));
  -- 直接INSERT（ロック中・別回答）は拒否
  m := pg_temp.try(format($q$insert into public.student_diagnosis_results (user_id, version, answers, result) values (%L,'v',%L,'{}')$q$, u1, pg_temp.ans('d')::text));
  perform pg_temp.chk('C8 直接INSERT（ロック中・別回答）は拒否', m <> 'OK', m);
  -- 経験者診断へ切替してもロックは回避できない
  set local role service_role;
  m := pg_temp.try(format($q$select pg_temp.ecommit(%L, %L, '[3,3]'::jsonb)$q$, u1, gen_random_uuid()));
  reset role;
  perform pg_temp.chk('C9 経験者診断への切替でも回避できない（ロック中は拒否）', m <> 'OK', m);
  select count(*) into n from public.diagnosis_results where user_id=u1 and answers='[3,3]'::jsonb; perform pg_temp.chk('C10 拒否された経験者診断は保存されない', n=0, n::text);
  -- 別ユーザー: 経験者A → 学生B → 経験者A（共通ロック・現在の診断はバンクを横断）
  set local role service_role;
  r := pg_temp.ecommit(u2, gen_random_uuid(), '[0,0]'::jsonb); perform pg_temp.chk('D1 経験者診断A 初回', r->>'action'='initial', r::text);
  r := pg_temp.scommit(u2, gen_random_uuid(), pg_temp.ans('a')); perform pg_temp.chk('D2 学生診断Bへ切替は変更1回目', r->>'action'='change', r::text);
  m := pg_temp.try(format($q$select pg_temp.ecommit(%L, %L, '[0,0]'::jsonb)$q$, u2, gen_random_uuid()));
  perform pg_temp.chk('D3 経験者A（元と同じ回答）へ戻すのはロック中は拒否', m like '%diagnosis_change_locked%', m);
  reset role;
  select count(*) into n from public.diagnosis_results where user_id=u2; perform pg_temp.chk('D4 拒否された戻しは保存されない（経験者の行は1件のまま）', n=1, n::text);
  perform pg_temp.chk('D5 現在の診断は学生B（seq=2）のまま', (select bank='student' and seq=2 from public.stylist_diagnosis_current where user_id=u2));
  -- ロック解除後（時間経過をlocked_untilの更新で再現）: 経験者Aは「変更」として保存、現在の診断が経験者へ
  update public.diagnosis_change_limits set locked_until = now() - interval '1 minute' where user_id=u2 and kind='stylist';
  set local role service_role;
  r := pg_temp.ecommit(u2, gen_random_uuid(), '[0,0]'::jsonb);
  perform pg_temp.chk('D6 解除後の経験者A再保存は「変更」（同じ回答でもバンクが違う）', r->>'action'='change', r::text);
  reset role;
  select count(*) into n from public.diagnosis_results where user_id=u2; perform pg_temp.chk('D7 経験者の行が増える（2件）', n=2, n::text);
  perform pg_temp.chk('D8 現在の診断は経験者A（seq=3）・回数は2回・再ロック', (select c.bank='experienced' and c.seq=3 and l.change_count=2 and l.locked_until > now() from public.stylist_diagnosis_current c join public.diagnosis_change_limits l on l.user_id=c.user_id and l.kind='stylist' where c.user_id=u2));
  -- 同じバンク・同じ回答だけ「変更なし」
  set local role service_role;
  r := pg_temp.ecommit(u2, gen_random_uuid(), '[0,0]'::jsonb);
  perform pg_temp.chk('D9 現在と同じバンク・同じ回答は変更なし（ロック中でも拒否されず、消費もしない）', r->>'action'='unchanged', r::text);
  reset role;
  perform pg_temp.chk('D10 変更なしは回数・連番を動かさない', (select c.seq=3 and l.change_count=2 from public.stylist_diagnosis_current c join public.diagnosis_change_limits l on l.user_id=c.user_id and l.kind='stylist' where c.user_id=u2));
end $$;
reset role;
-- 再送（同じ送信ID）は、現在の診断を過去へ戻さず、二重保存・二重消費もしない
do $$
declare u uuid := '00000000-0000-0000-0000-0000000c0003'; r1 uuid := gen_random_uuid(); r2 uuid := gen_random_uuid(); a jsonb; b jsonb; n1 int; n2 int; cc int; cur record;
begin
  insert into public.stylist_profiles (user_id) values (u) on conflict do nothing;
  set local role service_role;
  a := pg_temp.ecommit(u, r1, '[5,5]'::jsonb);
  b := pg_temp.scommit(u, r2, pg_temp.ans('z'));
  perform pg_temp.chk('E1 A(初回)→学生B(変更1回)', a->>'action'='initial' and b->>'action'='change', a::text || b::text);
  a := pg_temp.ecommit(u, r1, '[5,5]'::jsonb);
  perform pg_temp.chk('E2 Aの送信IDを再送 → replay（現在の診断をAへ戻さない）', (a->>'replay')::boolean and a->>'action'='initial', a::text);
  b := pg_temp.scommit(u, r2, pg_temp.ans('z'));
  perform pg_temp.chk('E3 Bの送信IDを再送 → replay', (b->>'replay')::boolean, b::text);
  reset role;
  select * into cur from public.stylist_diagnosis_current where user_id=u;
  select change_count into cc from public.diagnosis_change_limits where user_id=u and kind='stylist';
  select count(*) into n1 from public.diagnosis_results where user_id=u; select count(*) into n2 from public.student_diagnosis_results where user_id=u;
  perform pg_temp.chk('E4 現在の診断は学生Bのまま・連番2・変更回数1・各表1件ずつ', cur.bank='student' and cur.seq=2 and cc=1 and n1=1 and n2=1, format('%s %s %s %s %s', cur.bank, cur.seq, cc, n1, n2));
end $$;
reset role;
-- 保存時刻の値ではなく保存順で決まる（同時刻・未来時刻でも一意）
do $$
declare u uuid := '00000000-0000-0000-0000-0000000c0003'; t timestamptz := now() + interval '1 day'; r jsonb; cur record;
begin
  delete from public.diagnosis_change_limits where user_id=u; delete from public.diagnosis_results where user_id=u; delete from public.student_diagnosis_results where user_id=u; delete from public.stylist_diagnosis_current where user_id=u;
  set local role service_role;
  r := public.commit_diagnosis_result(u, gen_random_uuid(), true, '1.0.0', 'stylist', '[7,7]'::jsonb, 50::smallint,50::smallint,50::smallint,50::smallint,50::smallint,50::smallint,'T1','タイプ',50::smallint,'300-350', null, t);
  reset role;
  update public.diagnosis_change_limits set locked_until = null where user_id=u;
  set local role service_role;
  r := pg_temp.scommit(u, gen_random_uuid(), pg_temp.ans('t'));
  reset role;
  select * into cur from public.stylist_diagnosis_current where user_id=u;
  perform pg_temp.chk('F1 経験者(created_atが未来)→学生: 現在の診断は後から保存した学生（時刻値でなく保存順）', cur.bank='student' and cur.seq=2, cur::text);
end $$;
reset role;

reset role;

-- 権限
select pg_temp.chk('P1 commit_student_diagnosis は service_role のみ',
  has_function_privilege('service_role','public.commit_student_diagnosis(uuid,uuid,text,jsonb,jsonb)','execute')
  and not has_function_privilege('authenticated','public.commit_student_diagnosis(uuid,uuid,text,jsonb,jsonb)','execute')
  and not has_function_privilege('anon','public.commit_student_diagnosis(uuid,uuid,text,jsonb,jsonb)','execute'));
select pg_temp.chk('P2 set_stylist_career_phase は authenticated のみ',
  has_function_privilege('authenticated','public.set_stylist_career_phase(text,date,text,date,text)','execute')
  and not has_function_privilege('anon','public.set_stylist_career_phase(text,date,text,date,text)','execute')
  and not has_function_privilege('service_role','public.set_stylist_career_phase(text,date,text,date,text)','execute'));
select pg_temp.chk('P3 結果表は authenticated が SELECT のみ',
  has_table_privilege('authenticated','public.student_diagnosis_results','select')
  and not has_table_privilege('authenticated','public.student_diagnosis_results','insert')
  and not has_table_privilege('anon','public.student_diagnosis_results','select')
  and not has_table_privilege('service_role','public.student_diagnosis_results','insert'));
select pg_temp.chk('P4 ゲート・ロック・開閉の関数は0058と無変更（置き換えは commit_diagnosis_result と経験者トリガーの2つだけ）', (select md5(string_agg(pg_get_functiondef(p.oid), '' order by p.proname)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('_diagnosis_limit_gate','_diag_owner_lock','_diag_gate_open','_diag_gate_close')) = '9c02acbe4e4bc29167011aef348bb555');

select n, case when ok then 'PASS' else 'FAIL' end as r, name, left(info,110) from t_log order by n;
select case when bool_and(ok) then 'ALL PASS' else 'HAS FAIL' end from t_log;
rollback;
