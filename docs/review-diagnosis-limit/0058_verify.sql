-- 0058草案の検証（ローカルDB専用）。全体を1つのトランザクションで実行し、最後にROLLBACKする。
-- 実行: ./run-verify.sh   （使い捨てのローカルDBを作り、0058草案を適用してから、このファイルを実行する）
\set ON_ERROR_STOP on
begin;

create temp table t_log (n serial, name text, ok boolean, info text);
grant all on t_log to public; grant all on sequence t_log_n_seq to public;

create or replace function pg_temp.chk(p_name text, p_ok boolean, p_info text default '') returns void language sql as
$$ insert into t_log(name, ok, info) values (p_name, coalesce(p_ok,false), p_info) $$;

-- 例外を捕まえて、メッセージを返す
create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'OK'; exception when others then return sqlerrm; end $$;

-- ---------- 準備: 新しい美容師・サロン利用者を作る ----------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a001','s1@t'), ('00000000-0000-0000-0000-00000000a002','s2@t'), ('00000000-0000-0000-0000-00000000a003','s3@t'),
  ('00000000-0000-0000-0000-00000000b001','m1@t'), ('00000000-0000-0000-0000-00000000b002','m2@t'), ('00000000-0000-0000-0000-00000000b003','m3@t'), ('00000000-0000-0000-0000-00000000b004','m4@t'), ('00000000-0000-0000-0000-00000000a004','s4@t'), ('00000000-0000-0000-0000-00000000a005','s5@t')
on conflict do nothing;
insert into public.profiles (id, role) values
  ('00000000-0000-0000-0000-00000000a001','stylist'), ('00000000-0000-0000-0000-00000000a002','stylist'), ('00000000-0000-0000-0000-00000000a003','stylist'),
  ('00000000-0000-0000-0000-00000000b001','salon'), ('00000000-0000-0000-0000-00000000b002','salon'), ('00000000-0000-0000-0000-00000000b003','salon'), ('00000000-0000-0000-0000-00000000b004','salon'), ('00000000-0000-0000-0000-00000000a004','stylist'), ('00000000-0000-0000-0000-00000000a005','stylist')
on conflict do nothing;
insert into public.user_roles (user_id, role) values
  ('00000000-0000-0000-0000-00000000a001','stylist'), ('00000000-0000-0000-0000-00000000a002','stylist'), ('00000000-0000-0000-0000-00000000a003','stylist'),
  ('00000000-0000-0000-0000-00000000b001','salon'), ('00000000-0000-0000-0000-00000000b002','salon'), ('00000000-0000-0000-0000-00000000b003','salon'), ('00000000-0000-0000-0000-00000000b004','salon'), ('00000000-0000-0000-0000-00000000a004','stylist'), ('00000000-0000-0000-0000-00000000a005','stylist')
on conflict do nothing;

-- ===================== A. 美容師診断（commit_diagnosis_result） =====================
set local role service_role;
create or replace function pg_temp.commit(p_user uuid, p_req uuid, p_ans jsonb, p_allow boolean default true) returns jsonb language sql as $$
  select public.commit_diagnosis_result(p_user, p_req, p_allow, '1.0.0', 'stylist', p_ans,
    50::smallint,50::smallint,50::smallint,50::smallint,50::smallint,50::smallint, 'T1','タイプ',50::smallint,'300-350')
$$;
grant execute on function pg_temp.commit(uuid,uuid,jsonb,boolean) to public;
reset role;

do $$
declare
  u  uuid := '00000000-0000-0000-0000-00000000a001';
  r  jsonb; msg text; n int;
begin
  set local role service_role;
  -- 初回
  r := pg_temp.commit(u, gen_random_uuid(), '[0,1]'); perform pg_temp.chk('A1 初回保存', r->>'action' = 'initial');
  -- 再送（同じrequest_id）→ 回数を消費しない・結果は同じ
  perform set_config('t.req', gen_random_uuid()::text, true);
  r := pg_temp.commit(u, current_setting('t.req')::uuid, '[1,1]'); perform pg_temp.chk('A2 変更1回目', r->>'action' = 'change');
  declare r2 jsonb; begin
    r2 := pg_temp.commit(u, current_setting('t.req')::uuid, '[1,1]');
    perform pg_temp.chk('A3 二重送信は同じ操作（replay・結果同一・重複行なし）', (r2->>'replay')::boolean and r2->>'result_id' is not distinct from r->>'result_id' and r->>'result_id' is not null, r2::text);
  end;
  reset role;
  select count(*) into n from public.diagnosis_results where user_id = u;
  perform pg_temp.chk('A4 結果は初回+変更の2件のみ', n = 2, n::text);
  select change_count into n from public.diagnosis_change_limits where user_id = u and kind = 'stylist';
  perform pg_temp.chk('A5 変更回数=1（再送で増えない）', n = 1, n::text);
  perform pg_temp.chk('A6 ロックは3か月後(JST暦)', (select locked_until from public.diagnosis_change_limits where user_id=u and kind='stylist') = ((now() at time zone 'Asia/Tokyo' + interval '3 months') at time zone 'Asia/Tokyo'));
  -- ロック中の変更は拒否され、結果は増えず、回数も増えない
  set local role service_role;
  msg := pg_temp.try(format($q$select pg_temp.commit(%L, gen_random_uuid(), '[2,2]')$q$, u));
  reset role;
  perform pg_temp.chk('A7 ロック中の変更は拒否', msg = 'diagnosis_change_locked', msg);
  select count(*) into n from public.diagnosis_results where user_id = u;
  perform pg_temp.chk('A8 拒否では結果が増えない', n = 2, n::text);
  -- 回答が同じ（結果も同じ）はロック中でも「変更なし」扱いで拒否も消費もしない
  set local role service_role;
  r := pg_temp.commit(u, gen_random_uuid(), '[1,1]');
  reset role;
  perform pg_temp.chk('A9 回答が同じなら変更なし（ロック中でも消費しない）', r->>'action' = 'unchanged', r::text);
  -- 3か月経過（locked_until を過去へ）→ また1回変更できる
  update public.diagnosis_change_limits set locked_until = now() - interval '1 second' where user_id = u and kind = 'stylist';
  set local role service_role;
  r := pg_temp.commit(u, gen_random_uuid(), '[3,3]');
  reset role;
  perform pg_temp.chk('A10 ロック解除後に再び1回変更できる', r->>'action' = 'change', r::text);
  select change_count into n from public.diagnosis_change_limits where user_id = u and kind = 'stylist';
  perform pg_temp.chk('A11 変更回数=2', n = 2);
  set local role service_role;
  msg := pg_temp.try(format($q$select pg_temp.commit(%L, gen_random_uuid(), '[4,4]')$q$, u));
  reset role;
  perform pg_temp.chk('A12 再ロック', msg = 'diagnosis_change_locked', msg);
  -- 結果（スコア・タイプ）が同じでも、回答が違えば「変更」として数える（別ユーザーで確認）
  declare u2 uuid := '00000000-0000-0000-0000-00000000a002'; begin
    set local role service_role;
    perform pg_temp.commit(u2, gen_random_uuid(), '[0,0]');
    r := pg_temp.commit(u2, gen_random_uuid(), '[0,1]');   -- スコア・タイプは同じ値で渡している
    reset role;
    perform pg_temp.chk('A13 結果が同じでも回答が違えば変更1回', r->>'action' = 'change', r::text);
  end;
  -- 新規アカウント引き継ぎ（p_allow_change=false）: 既に保存がある所有者へは保存させない
  declare u3 uuid := '00000000-0000-0000-0000-00000000a001'; begin
    set local role service_role;
    msg := pg_temp.try(format($q$select pg_temp.commit(%L, gen_random_uuid(), '[9,9]', false)$q$, u3));
    reset role;
    perform pg_temp.chk('A14 引き継ぎ経路は、保存済みの所有者には保存しない', msg = 'diagnosis_already_saved', msg);
  end;
  -- 失敗（例外）時は回数を消費しない: 不正ユーザーでの呼び出しはロールバックされる
  set local role service_role;
  msg := pg_temp.try($q$select pg_temp.commit('00000000-0000-0000-0000-0000deadbeef', gen_random_uuid(), '[0]')$q$);
  reset role;
  perform pg_temp.chk('A15 存在しないユーザーは拒否', msg = 'user not found', msg);
  -- request_id を別の所有者が流用できない
  set local role service_role;
  perform set_config('t.req2', gen_random_uuid()::text, true);
  perform pg_temp.commit('00000000-0000-0000-0000-00000000a003', current_setting('t.req2')::uuid, '[0,1]');
  msg := pg_temp.try(format($q$select pg_temp.commit(%L, %L, '[0,1]')$q$, '00000000-0000-0000-0000-00000000a002', current_setting('t.req2')));
  reset role;
  perform pg_temp.chk('A16 request_id の別所有者による流用は拒否', msg = 'request id reused', msg);
end $$;

-- ===================== B. 権限（authenticated・anon は直接呼べない） =====================
do $$
declare msg text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a001"}', true);
  msg := pg_temp.try($q$select public.commit_diagnosis_result('00000000-0000-0000-0000-00000000a001', gen_random_uuid(), true, '1.0.0','stylist','[1]'::jsonb,1::smallint,1::smallint,1::smallint,1::smallint,1::smallint,1::smallint,'T','T',1::smallint,'x',null)$q$);
  perform pg_temp.chk('B1 authenticated は commit_diagnosis_result を呼べない', msg like 'permission denied%', msg);
  msg := pg_temp.try($q$select public._diagnosis_limit_gate('stylist','00000000-0000-0000-0000-00000000a001',null,gen_random_uuid(),true,true)$q$);
  perform pg_temp.chk('B2 authenticated は内部ゲートを呼べない', msg like 'permission denied%', msg);
  msg := pg_temp.try($q$insert into public.diagnosis_change_limits(kind,user_id) values ('stylist','00000000-0000-0000-0000-00000000a001')$q$);
  perform pg_temp.chk('B3 authenticated は状態表に直接書けない', msg like 'permission denied%', msg);
  msg := pg_temp.try($q$update public.diagnosis_change_limits set locked_until = null$q$);
  perform pg_temp.chk('B4 authenticated は状態表を直接更新できない（ロック解除不可）', msg like 'permission denied%', msg);
  msg := pg_temp.try($q$select * from public.diagnosis_save_requests$q$);
  perform pg_temp.chk('B5 authenticated は保存要求表を読めない', msg like 'permission denied%', msg);
  reset role;
  set local role anon;
  msg := pg_temp.try($q$select public.get_diagnosis_change_status('stylist')$q$);
  perform pg_temp.chk('B6 anon は状態関数を呼べない', msg like 'permission denied%', msg);
  reset role;
  set local role service_role;
  msg := pg_temp.try($q$update public.diagnosis_change_limits set locked_until = null$q$);
  perform pg_temp.chk('B7 service_role も状態表を直接書けない（関数経由のみ）', msg like 'permission denied%', msg);
  reset role;
  -- 状態の読み取り
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a001"}', true);
  perform pg_temp.chk('B8 本人の状態を読める', (public.get_diagnosis_change_status('stylist')->>'state') = 'locked');
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a002"}', true);
  perform pg_temp.chk('B9 他人の状態は見えない（自分の状態だけ）', (select count(*) from public.diagnosis_change_limits) = 1);
  reset role;
end $$;

-- ===================== C. サロンらしさ（本人用・追加5問・店舗用） =====================
create or replace function pg_temp.base12(p int) returns jsonb language sql as $$
  select jsonb_build_object('q1_education_support',p,'q2_challenge_openness',p,'q3_personal_brand_support',p,'q4_team_collaboration',p,
   'q5_individual_autonomy',p,'q6_work_flexibility',p,'q7_technical_specialization',p,'q8_premium_value',p,'q9_trend_orientation',p,
   'q10_creative_output',p,'q11_relationship_distance',p,'q12_hierarchy_flatness',p) $$;
create or replace function pg_temp.extra5(p int) returns jsonb language sql as $$
  select jsonb_build_object('q13_nurture_learning_flow',p,'q14_nurture_feedback',p,'q15_brand_staff_presentation',p,'q16_team_handover',p,'q17_discretion_proposal',p) $$;
create or replace function pg_temp.payload(p_base int, p_extra int default null, p_comment text default null) returns jsonb language sql as $$
  select jsonb_build_object('respondent_role','owner_representative','current_step',12,'answers',pg_temp.base12(p_base),'value_priorities','[]'::jsonb,'comment',p_comment)
         || case when p_extra is null then '{}'::jsonb else jsonb_build_object('extra', jsonb_build_object('version','salon-analysis-v1','answers',pg_temp.extra5(p_extra))) end $$;
grant execute on function pg_temp.base12(int), pg_temp.extra5(int), pg_temp.payload(int,int,text) to public;

do $$
declare
  m1 uuid := '00000000-0000-0000-0000-00000000b001';
  r jsonb; msg text; n int; v_ans jsonb;
  st uuid := '00000000-0000-0000-0000-0000000000f1';
  mgr_a uuid := '00000000-0000-0000-0000-000000000106';   -- f1 の store_manager
  mgr_b uuid := '00000000-0000-0000-0000-00000000010c';   -- f1 の別の store_manager
  viewer uuid := '00000000-0000-0000-0000-000000000108';  -- f1 の viewer
  req uuid;
begin
  -- ---- 本人用 ----
  set local role authenticated; perform set_config('request.jwt.claims', format('{"sub":"%s"}', m1), true);
  -- 12問が途中の下書きは確定できない（公開もされない）
  perform public.save_salon_culture_draft(null, jsonb_build_object('respondent_role','owner_representative','current_step',3,'answers','{"q1_education_support":3}'::jsonb));
  msg := pg_temp.try($q$select public.confirm_salon_culture_diagnosis(null, gen_random_uuid())$q$);
  perform pg_temp.chk('C1 途中の下書きは確定できない', msg = 'draft incomplete', msg);
  reset role;
  perform pg_temp.chk('C2 途中保存では公開中の結果も状態も作られない', (select count(*) from public.salon_culture_profiles where salon_user_id = m1) = 0 and (select count(*) from public.diagnosis_change_limits where user_id = m1) = 0);

  -- 初回: 12問のみで確定（追加5問は後で答えられる）
  set local role authenticated; perform set_config('request.jwt.claims', format('{"sub":"%s"}', m1), true);
  perform public.save_salon_culture_draft(null, pg_temp.payload(3));
  r := public.confirm_salon_culture_diagnosis(null, gen_random_uuid());
  perform pg_temp.chk('C3 初回確定（12問のみ）', r->>'action' = 'initial' and r->>'locked_until' is null, r::text);
  -- 12問を保存してもロックされず、追加5問を答えられる（同じ診断の完了・回数を消費しない）
  perform public.save_salon_culture_draft(null, pg_temp.payload(3, 4));
  r := public.confirm_salon_culture_diagnosis(null, gen_random_uuid());
  perform pg_temp.chk('C4 追加5問の初回回答は同じ診断の完了（消費しない・ロックしない）', r->>'action' = 'extra_completion' and r->>'locked_until' is null, r::text);
  reset role;
  perform pg_temp.chk('C5 追加5問が保存され、変更回数は0', (select count(*) from public.salon_culture_analysis_answers where salon_user_id = m1) = 1
    and (select change_count from public.diagnosis_change_limits where user_id = m1 and kind='salon_culture_user') = 0);

  -- 12問を変えて追加5問を答え直さない → 拒否（古い追加回答を黙って紐付けない）。回数は消費しない。
  set local role authenticated; perform set_config('request.jwt.claims', format('{"sub":"%s"}', m1), true);
  perform public.save_salon_culture_draft(null, pg_temp.payload(2));
  msg := pg_temp.try($q$select public.confirm_salon_culture_diagnosis(null, gen_random_uuid())$q$);
  perform pg_temp.chk('C6 12問を変えて追加5問が無い場合は拒否', msg = 'extra answers required', msg);
  reset role;
  perform pg_temp.chk('C7 拒否では公開中の結果も回数も変わらない', (select answers->>'q2_challenge_openness' from public.salon_culture_profiles where salon_user_id = m1) = '3'
    and (select change_count from public.diagnosis_change_limits where user_id = m1 and kind='salon_culture_user') = 0);

  -- 12問＋追加5問を一緒に変更して確定 → 変更1回・ロック
  set local role authenticated; perform set_config('request.jwt.claims', format('{"sub":"%s"}', m1), true);
  perform public.save_salon_culture_draft(null, pg_temp.payload(2, 5));
  req := gen_random_uuid();
  r := public.confirm_salon_culture_diagnosis(null, req);
  perform pg_temp.chk('C8 12問+追加5問の変更確定 = 変更1回・3か月ロック', r->>'action' = 'change' and r->>'locked_until' is not null, r::text);
  -- 二重送信（下書きは確定で消えている）→ 同じ操作として結果を返し、重複計上しない
  r := public.confirm_salon_culture_diagnosis(null, req);
  perform pg_temp.chk('C9 確定の再送は同じ操作（replay）', (r->>'replay')::boolean and r->>'action' = 'change', r::text);
  reset role;
  perform pg_temp.chk('C10 公開結果が更新され、回数は1のまま', (select answers->>'q2_challenge_openness' from public.salon_culture_profiles where salon_user_id = m1) = '2'
    and (select change_count from public.diagnosis_change_limits where user_id = m1 and kind='salon_culture_user') = 1
    and (select (answers->>'q13_nurture_learning_flow')::int from public.salon_culture_analysis_answers where salon_user_id = m1) = 5);

  -- ロック中: 下書きは保存できるが、公開中の結果は変わらず、確定は拒否される
  set local role authenticated; perform set_config('request.jwt.claims', format('{"sub":"%s"}', m1), true);
  perform public.save_salon_culture_draft(null, pg_temp.payload(1, 1));
  perform pg_temp.chk('C11 ロック中でも下書きは保存できる', true);
  msg := pg_temp.try($q$select public.confirm_salon_culture_diagnosis(null, gen_random_uuid())$q$);
  perform pg_temp.chk('C12 ロック中の確定は拒否', msg = 'diagnosis_change_locked', msg);
  reset role;
  perform pg_temp.chk('C13 拒否後も公開中の結果は変わらない', (select answers->>'q2_challenge_openness' from public.salon_culture_profiles where salon_user_id = m1) = '2');
  -- 付随項目（コメント）だけの更新は、回数を消費せず反映される（回答は同じ）
  set local role authenticated; perform set_config('request.jwt.claims', format('{"sub":"%s"}', m1), true);
  perform public.save_salon_culture_draft(null, pg_temp.payload(2, 5, '新しいコメント'));
  r := public.confirm_salon_culture_diagnosis(null, gen_random_uuid());
  perform pg_temp.chk('C14 回答が同じならロック中でも「変更なし」（付随項目は反映・消費なし）', r->>'action' = 'unchanged', r::text);
  reset role;
  perform pg_temp.chk('C15 コメントが反映され回数は1のまま', (select comment from public.salon_culture_profiles where salon_user_id = m1) = '新しいコメント'
    and (select change_count from public.diagnosis_change_limits where user_id = m1 and kind='salon_culture_user') = 1);
  -- 3か月経過後に再び1回変更できる
  update public.diagnosis_change_limits set locked_until = now() - interval '1 second' where user_id = m1 and kind='salon_culture_user';
  set local role authenticated; perform set_config('request.jwt.claims', format('{"sub":"%s"}', m1), true);
  perform public.save_salon_culture_draft(null, pg_temp.payload(4, 2));
  r := public.confirm_salon_culture_diagnosis(null, gen_random_uuid());
  perform pg_temp.chk('C16 ロック解除後に再び1回変更できる', r->>'action' = 'change', r::text);
  reset role;

  -- 他人の下書き・確定: 他のサロン利用者は自分の行しか触れない
  set local role authenticated; perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000b002"}', true);
  perform pg_temp.chk('C17 他人の下書きは見えない', (select count(*) from public.salon_culture_drafts) = 0);
  msg := pg_temp.try($q$select public.confirm_salon_culture_diagnosis(null, gen_random_uuid())$q$);
  perform pg_temp.chk('C18 他人の下書きは確定できない（自分の下書きが無い）', msg = 'draft not found', msg);
  reset role;

  -- ---- 店舗用（店舗単位で制限。担当者が変わっても回避できない） ----
  set local role authenticated; perform set_config('request.jwt.claims', format('{"sub":"%s"}', mgr_a), true);
  perform public.save_salon_culture_draft(st, pg_temp.payload(2, 3));
  r := public.confirm_salon_culture_diagnosis(st, gen_random_uuid());
  perform pg_temp.chk('S1 店舗: 担当者Aの変更確定（既存の保存済み店舗＝変更1回が残っている）', r->>'action' in ('change','extra_completion','unchanged') , r::text);
  reset role;
  -- 状態を確認
  select count(*) into n from public.diagnosis_change_limits where store_id = st and kind='salon_culture_store' and locked_until is not null;
  if n = 0 then
    -- 追加5問の初回回答だった場合は、続けて回答を変えて「変更」にする
    set local role authenticated; perform set_config('request.jwt.claims', format('{"sub":"%s"}', mgr_a), true);
    perform public.save_salon_culture_draft(st, pg_temp.payload(1, 1));
    r := public.confirm_salon_culture_diagnosis(st, gen_random_uuid());
    reset role;
  end if;
  perform pg_temp.chk('S2 店舗がロックされた', (select locked_until from public.diagnosis_change_limits where store_id = st and kind='salon_culture_store') > now());

  set local role authenticated; perform set_config('request.jwt.claims', format('{"sub":"%s"}', mgr_b), true);
  perform public.save_salon_culture_draft(st, pg_temp.payload(5, 5));
  msg := pg_temp.try(format($q$select public.confirm_salon_culture_diagnosis(%L, gen_random_uuid())$q$, st));
  perform pg_temp.chk('S3 別の担当者Bでも、店舗のロックは回避できない', msg = 'diagnosis_change_locked', msg);
  reset role;
  -- 閲覧専用は追加5問を保存できない（既存の編集権限規則を再利用）
  set local role authenticated; perform set_config('request.jwt.claims', format('{"sub":"%s"}', viewer), true);
  msg := pg_temp.try(format($q$select public.save_salon_culture_draft(%L, pg_temp.payload(5, 5))$q$, st));
  perform pg_temp.chk('S4a 閲覧専用は途中保存（下書き）もできない', msg = 'not allowed to edit this store', msg);
  msg := pg_temp.try(format($q$select public.confirm_salon_culture_diagnosis(%L, gen_random_uuid())$q$, st));
  perform pg_temp.chk('S4b 閲覧専用は確定もできない', msg = 'not allowed to edit this store', msg);
  -- アクセス権のない店舗
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000b002"}', true);
  msg := pg_temp.try(format($q$select public.save_salon_culture_draft(%L, pg_temp.payload(1))$q$, st));
  perform pg_temp.chk('S5 アクセス権のない店舗の下書きは保存できない', msg = 'not allowed to edit this store', msg);
  reset role;
  -- 本人用の状態は、店舗の変更では消費されない（本人用と店舗用は別の診断。同期の追加なし）
  perform pg_temp.chk('S6 本人用の状態は店舗の保存で変わらない', (select count(*) from public.diagnosis_change_limits where kind='salon_culture_user' and user_id in (mgr_a, mgr_b)) = 0);
end $$;

-- ===================== N. 迂回できないこと（旧RPC・直接INSERT・別タブ・同期・request_id） =====================
do $$
declare
  a4 uuid := '00000000-0000-0000-0000-00000000a004'; a5 uuid := '00000000-0000-0000-0000-00000000a005';
  b1 uuid := '00000000-0000-0000-0000-00000000b001'; b3 uuid := '00000000-0000-0000-0000-00000000b003'; b4 uuid := '00000000-0000-0000-0000-00000000b004';
  st uuid := '00000000-0000-0000-0000-0000000000f1';
  mgr_a uuid := '00000000-0000-0000-0000-000000000106'; mgr_b uuid := '00000000-0000-0000-0000-00000000010c';
  viewer uuid := '00000000-0000-0000-0000-000000000108'; owner uuid := '00000000-0000-0000-0000-000000000101';
  msg text; r jsonb; n int; req uuid; d public.salon_culture_drafts; own_before jsonb;
begin
  -- N1 同じ request_id で内容が違えば拒否（美容師）
  req := gen_random_uuid();
  set local role service_role;
  perform pg_temp.commit(a4, req, '[1]');
  msg := pg_temp.try(format($q$select pg_temp.commit(%L, %L, '[2]')$q$, a4, req));
  reset role;
  perform pg_temp.chk('N1 同じrequest_idで異なる内容は拒否（美容師）', msg = 'request id content mismatch', msg);

  -- N2 service_role の直接INSERT（旧経路）でも、規則どおり: 初回OK→同一回答は追加されず消費なし→変更1回→ロック中は拒否
  set local role service_role;
  insert into public.diagnosis_results (user_id, diagnosis_version, mode, answers, craft_score, sense_score, hospitality_score, brand_score, drive_score, mentor_score, type_id, type_name, created_at)
    values (a5, '1', 'stylist', '[1]', 1,1,1,1,1,1,'T','T', now() - interval '3 minutes');
  insert into public.diagnosis_results (user_id, diagnosis_version, mode, answers, craft_score, sense_score, hospitality_score, brand_score, drive_score, mentor_score, type_id, type_name, created_at)
    values (a5, '1', 'stylist', '[1]', 1,1,1,1,1,1,'T','T', now() - interval '2 minutes');
  reset role;
  select count(*) into n from public.diagnosis_results where user_id = a5;
  perform pg_temp.chk('N2a 直接INSERTの初回は通り、同一回答の再INSERTは追加されない', n = 1, n::text);
  perform pg_temp.chk('N2b 同一回答では回数を消費しない', (select change_count from public.diagnosis_change_limits where user_id = a5 and kind = 'stylist') = 0);
  set local role service_role;
  insert into public.diagnosis_results (user_id, diagnosis_version, mode, answers, craft_score, sense_score, hospitality_score, brand_score, drive_score, mentor_score, type_id, type_name, created_at)
    values (a5, '1', 'stylist', '[2]', 1,1,1,1,1,1,'T','T', now() - interval '1 minute');
  msg := pg_temp.try($q$insert into public.diagnosis_results (user_id, diagnosis_version, mode, answers, craft_score, sense_score, hospitality_score, brand_score, drive_score, mentor_score, type_id, type_name, created_at) values ('00000000-0000-0000-0000-00000000a005','1','stylist','[3]',1,1,1,1,1,1,'T','T', now())$q$);
  reset role;
  perform pg_temp.chk('N2c 直接INSERTの変更は1回で、ロック中の2回目は拒否', msg = 'diagnosis_change_locked' and (select change_count from public.diagnosis_change_limits where user_id = a5 and kind = 'stylist') = 1, msg);

  -- N3 旧RPC（authenticated）: 確定済みの本人用12問を直接変えられない（b1 は C16 で確定済み）
  set local role authenticated; perform set_config('request.jwt.claims', format('{"sub":"%s"}', b1), true);
  msg := pg_temp.try($q$select public.save_salon_culture_profile('completed','owner_representative',12,pg_temp.base12(1),null,null)$q$);
  perform pg_temp.chk('N3a 旧RPCで確定済みの回答は変えられない', msg = 'diagnosis_use_confirm', msg);
  msg := pg_temp.try($q$select public.save_salon_culture_profile('draft','owner_representative',3,pg_temp.base12(4),null,null)$q$);
  perform pg_temp.chk('N3b 旧RPCの途中保存で、公開中の結果を下書き扱いに戻せない', msg = 'diagnosis_use_confirm', msg);
  msg := pg_temp.try($q$select public.save_salon_culture_analysis_answers('salon-analysis-v1', pg_temp.extra5(1), pg_temp.base12(4))$q$);
  perform pg_temp.chk('N3c 旧RPCで追加5問の回答は変えられない', msg = 'diagnosis_use_confirm', msg);
  reset role;
  -- 初めて使う本人（b3）が旧RPCで確定 → 初回保存として状態が作られ、その後の旧RPCでの変更は拒否される
  set local role authenticated; perform set_config('request.jwt.claims', format('{"sub":"%s"}', b3), true);
  perform public.save_salon_culture_profile('draft','owner_representative',3,pg_temp.base12(3),null,null);
  perform public.save_salon_culture_profile('completed','owner_representative',12,pg_temp.base12(3),null,null);
  msg := pg_temp.try($q$select public.save_salon_culture_profile('completed','owner_representative',12,pg_temp.base12(5),null,null)$q$);
  reset role;
  perform pg_temp.chk('N3d 旧RPCでの初回確定は状態を作り、直後の旧RPC変更は拒否', msg = 'diagnosis_use_confirm'
    and (select count(*) from public.diagnosis_change_limits where user_id = b3 and kind = 'salon_culture_user') = 1, msg);

  -- N4 旧RPC（店舗）: 閲覧専用は不可。編集権限のある別担当者も、確定済み・ロック中の店舗の回答は変えられない
  set local role authenticated; perform set_config('request.jwt.claims', format('{"sub":"%s"}', viewer), true);
  msg := pg_temp.try(format($q$select public.save_salon_store_culture_profile(%L,'draft','owner_representative',3,pg_temp.base12(3),null,null)$q$, st));
  perform pg_temp.chk('N4a 旧RPC: 閲覧専用は店舗の途中保存もできない', msg = 'not allowed to edit this store', msg);
  perform set_config('request.jwt.claims', format('{"sub":"%s"}', mgr_b), true);
  msg := pg_temp.try(format($q$select public.save_salon_store_culture_profile(%L,'completed','owner_representative',12,pg_temp.base12(5),null,null)$q$, st));
  perform pg_temp.chk('N4b 旧RPC: 担当者が変わっても、確定済みの店舗回答は直接変えられない', msg = 'diagnosis_use_confirm', msg);
  reset role;

  -- N5 初期店舗→本人の既存同期: 本人の確定結果・ロックを上書きしない／本人用の状態に影響しない
  --    f1 の初期オンボーディング本人は owner(101)。S1/S2 の店舗確定で、101 の行は初期化（行なし→新規）されている。
  insert into public.user_roles (user_id, role) values (owner, 'salon') on conflict do nothing;
  perform pg_temp.chk('N5a 同期で本人用の行と状態が初期化された（本人用の初回保存＝変更1回が残る）',
    (select status from public.salon_culture_profiles where salon_user_id = owner) = 'completed'
    and (select change_count from public.diagnosis_change_limits where user_id = owner and kind = 'salon_culture_user') = 0
    and (select locked_until from public.diagnosis_change_limits where user_id = owner and kind = 'salon_culture_user') is null);
  set local role authenticated; perform set_config('request.jwt.claims', format('{"sub":"%s"}', owner), true);
  perform public.save_salon_culture_draft(null, pg_temp.payload(4, 4, '本人の結果'));
  r := public.confirm_salon_culture_diagnosis(null, gen_random_uuid());
  reset role;
  perform pg_temp.chk('N5b 本人が自分の結果を変更（1回）→本人用がロック', r->>'action' = 'change');
  select answers into own_before from public.salon_culture_profiles where salon_user_id = owner;
  -- 店舗のロックを解除（3か月経過を再現）し、店舗の担当者が店舗の結果を変更
  update public.diagnosis_change_limits set locked_until = now() - interval '1 second' where store_id = st and kind = 'salon_culture_store';
  set local role authenticated; perform set_config('request.jwt.claims', format('{"sub":"%s"}', mgr_a), true);
  perform public.save_salon_culture_draft(st, pg_temp.payload(3, 3));
  r := public.confirm_salon_culture_diagnosis(st, gen_random_uuid());
  reset role;
  perform pg_temp.chk('N5c 店舗の変更は店舗側で確定する', r->>'action' = 'change', r::text);
  perform pg_temp.chk('N5d 同期は本人の確定結果を上書きしない（本人の回答は変わらない）', (select answers from public.salon_culture_profiles where salon_user_id = owner) is not distinct from own_before);
  perform pg_temp.chk('N5e 店舗の変更は本人用の回数を消費せず、本人用のロックも変えない', (select change_count from public.diagnosis_change_limits where user_id = owner and kind = 'salon_culture_user') = 1);

  -- N6 別タブ（下書きの版番号）: 古い版からの上書き・確定は拒否される
  set local role authenticated; perform set_config('request.jwt.claims', format('{"sub":"%s"}', b4), true);
  d := public.save_salon_culture_draft(null, pg_temp.payload(3));
  perform pg_temp.chk('N6a 下書きの版番号が付く', d.rev = 1);
  d := public.save_salon_culture_draft(null, pg_temp.payload(2), 1);
  msg := pg_temp.try($q$select public.save_salon_culture_draft(null, pg_temp.payload(1), 1)$q$);
  perform pg_temp.chk('N6b 別タブが先に保存していたら、古い版からの上書きは拒否', msg = 'draft_changed' and d.rev = 2, msg);
  msg := pg_temp.try($q$select public.confirm_salon_culture_diagnosis(null, gen_random_uuid(), 1)$q$);
  perform pg_temp.chk('N6c 古い版を前提にした確定は拒否', msg = 'draft_changed', msg);

  -- N7 同じrequest_idで内容が違えば拒否（サロン）
  req := gen_random_uuid();
  r := public.confirm_salon_culture_diagnosis(null, req, 2);
  perform pg_temp.chk('N7a b4 の初回確定', r->>'action' = 'initial');
  perform public.save_salon_culture_draft(null, pg_temp.payload(5));
  msg := pg_temp.try(format($q$select public.confirm_salon_culture_diagnosis(null, %L)$q$, req));
  perform pg_temp.chk('N7b 同じrequest_idで、下書きの内容が違う確定は拒否', msg = 'request id content mismatch', msg);
  reset role;
end $$;

-- ===================== D. 月末・暦計算 =====================
select pg_temp.chk('D1 11/30 10:00(JST) の3か月後は 2/28 10:00(JST)',
  ((timestamptz '2026-11-30 10:00+09' at time zone 'Asia/Tokyo' + interval '3 months') at time zone 'Asia/Tokyo') = timestamptz '2027-02-28 10:00+09');
select pg_temp.chk('D2 1/31 の3か月後は 4/30',
  ((timestamptz '2027-01-31 10:00+09' at time zone 'Asia/Tokyo' + interval '3 months') at time zone 'Asia/Tokyo') = timestamptz '2027-04-30 10:00+09');
select pg_temp.chk('D3 11/13 の3か月後は 2/13（30日×3ではなく暦）',
  ((timestamptz '2026-11-13 15:00+09' at time zone 'Asia/Tokyo' + interval '3 months') at time zone 'Asia/Tokyo') = timestamptz '2027-02-13 15:00+09');

-- ===================== E. 0059（直接経路を閉じる）後も確定経路が動く =====================
-- 0059草案の内容を、同じトランザクション内で適用する（run-verify.sh が begin/commit を除いた版を渡す）
\i :f0059
do $$
declare
  m2 uuid := '00000000-0000-0000-0000-00000000b002'; msg text; r jsonb;
begin
  set local role authenticated; perform set_config('request.jwt.claims', format('{"sub":"%s"}', m2), true);
  msg := pg_temp.try($q$select public.save_salon_culture_profile('completed','owner_representative',12,pg_temp.base12(3),null,null)$q$);
  perform pg_temp.chk('E1 0059後: 本人用12問の直接保存は呼べない', msg like 'permission denied%', msg);
  msg := pg_temp.try($q$select public.save_salon_store_culture_profile('00000000-0000-0000-0000-0000000000f1','completed','owner_representative',12,pg_temp.base12(3),null,null)$q$);
  perform pg_temp.chk('E2 0059後: 店舗12問の直接保存は呼べない', msg like 'permission denied%', msg);
  msg := pg_temp.try($q$select public.save_salon_culture_analysis_answers('salon-analysis-v1', pg_temp.extra5(3), '{}'::jsonb)$q$);
  perform pg_temp.chk('E3 0059後: 追加5問の直接保存は呼べない', msg like 'permission denied%', msg);
  -- 確定経路は動く
  perform public.save_salon_culture_draft(null, pg_temp.payload(3, 3));
  r := public.confirm_salon_culture_diagnosis(null, gen_random_uuid());
  perform pg_temp.chk('E4 0059後も確定経路（内部の既存関数呼び出し）は動く', r->>'action' = 'initial', r::text);
  reset role;
  set local role service_role;
  msg := pg_temp.try($q$insert into public.diagnosis_results (user_id, diagnosis_version, mode, answers, craft_score, sense_score, hospitality_score, brand_score, drive_score, mentor_score, type_id, type_name) values ('00000000-0000-0000-0000-00000000a001','1','stylist','[1]',1,1,1,1,1,1,'T','T')$q$);
  perform pg_temp.chk('E5 0059後: service_role の直接INSERTは不可', msg like 'permission denied%', msg);
  msg := pg_temp.try($q$select pg_temp.commit('00000000-0000-0000-0000-00000000a002', gen_random_uuid(), '[7,7]')$q$);
  perform pg_temp.chk('E6 0059後も commit_diagnosis_result は動く（ロック中なので規則どおり拒否される=関数は実行できる）', msg in ('diagnosis_change_locked','OK'), msg);
  reset role;
end $$;

select n, case when ok then 'PASS' else 'FAIL' end as result, name, case when ok then '' else info end as info from t_log order by n;
select count(*) filter (where ok) as pass, count(*) filter (where not ok) as fail from t_log;
rollback;
