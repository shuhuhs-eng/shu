-- サロン側アプリ（下書き保存→確認→確定）が使うDB経路の結合検証（ローカルDB専用）。0058（と0059）適用済みのDBで実行し、最後にROLLBACKする。
-- 画面の実装（lib/salon-culture/draft-actions.ts）が呼ぶ順序をそのまま再現する:
--   save_salon_culture_draft(版番号つき) → confirm_salon_culture_diagnosis(request_id, 版番号) → get_diagnosis_change_status
\set ON_ERROR_STOP on
begin;

create temp table t_log (n serial, name text, ok boolean, info text);
grant all on t_log to public; grant all on sequence t_log_n_seq to public;
create or replace function pg_temp.chk(p_name text, p_ok boolean, p_info text default '') returns void language sql as
$$ insert into t_log(name, ok, info) values (p_name, coalesce(p_ok,false), p_info) $$;
create or replace function pg_temp.chk(p_name text, p_ok boolean, p_info text default '') returns void language plpgsql as
$$ begin insert into t_log(name, ok, info) values (p_name, coalesce(p_ok,false), p_info); if not coalesce(p_ok,false) then raise notice 'FAIL % : %', p_name, p_info; end if; end $$;
create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'OK'; exception when others then return sqlerrm; end $$;
create or replace function pg_temp.base12(p int) returns jsonb language sql as $$
  select jsonb_build_object('q1_education_support',p,'q2_challenge_openness',p,'q3_personal_brand_support',p,'q4_team_collaboration',p,
   'q5_individual_autonomy',p,'q6_work_flexibility',p,'q7_technical_specialization',p,'q8_premium_value',p,'q9_trend_orientation',p,
   'q10_creative_output',p,'q11_relationship_distance',p,'q12_hierarchy_flatness',p) $$;
create or replace function pg_temp.extra5(p int) returns jsonb language sql as $$
  select jsonb_build_object('q13_nurture_learning_flow',p,'q14_nurture_feedback',p,'q15_brand_staff_presentation',p,'q16_team_handover',p,'q17_discretion_proposal',p) $$;
create or replace function pg_temp.payload(p_base int, p_extra int default null, p_comment text default null, p_step int default 13) returns jsonb language sql as $$
  select jsonb_build_object('respondent_role','owner_representative','current_step',p_step,'answers',pg_temp.base12(p_base),
         'value_priorities','["skill_growth","teamwork","independence"]'::jsonb,'comment',p_comment)
         || case when p_extra is null then '{}'::jsonb else jsonb_build_object('extra', jsonb_build_object('version','salon-analysis-v1','answers',pg_temp.extra5(p_extra))) end $$;
grant execute on function pg_temp.base12(int), pg_temp.extra5(int), pg_temp.payload(int,int,text,int) to public;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000c101','p1@t'), ('00000000-0000-0000-0000-00000000c102','p2@t') on conflict do nothing;
insert into public.profiles (id, role) values ('00000000-0000-0000-0000-00000000c101','salon'), ('00000000-0000-0000-0000-00000000c102','salon') on conflict do nothing;
insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-00000000c101','salon'), ('00000000-0000-0000-0000-00000000c102','salon') on conflict do nothing;

do $$
declare
  u  uuid := '00000000-0000-0000-0000-00000000c101';      -- 本人用の検証用（独立したサロン利用者）
  own uuid := '00000000-0000-0000-0000-000000000101';      -- f1/f2 の会社オーナー（f1の初期オンボーディング本人）
  mgr uuid := '00000000-0000-0000-0000-000000000106';      -- f1 の store_manager（f2には権限なし）
  viewer uuid := '00000000-0000-0000-0000-000000000108';   -- f1 の viewer
  f1 uuid := '00000000-0000-0000-0000-0000000000f1';
  f2 uuid := '00000000-0000-0000-0000-0000000000f2';
  d public.salon_culture_drafts; r jsonb; msg text; n int; n2 int; req uuid; pub jsonb;
begin
  ---------------- P1 初回: 途中保存（版番号）→ 公開結果は作られない → 確定で初めて公開 ----------------
  set local role authenticated; perform set_config('request.jwt.claims', format('{"sub":"%s"}', u), true);
  d := public.save_salon_culture_draft(null, pg_temp.payload(3, null, null, 1));
  perform pg_temp.chk('P1a 下書き1回目は版1', d.rev = 1, d.rev::text);
  d := public.save_salon_culture_draft(null, pg_temp.payload(3, null, null, 5), d.rev);
  d := public.save_salon_culture_draft(null, pg_temp.payload(3, null, 'x', 13), d.rev);
  perform pg_temp.chk('P1b 版番号を渡した保存が重なるたびに増える', d.rev = 3, d.rev::text);
  reset role;
  perform pg_temp.chk('P1c 途中保存では公開結果も状態も作られない', (select count(*) from public.salon_culture_profiles where salon_user_id = u) = 0 and (select count(*) from public.diagnosis_change_limits where user_id = u) = 0);
  set local role authenticated; perform set_config('request.jwt.claims', format('{"sub":"%s"}', u), true);
  perform pg_temp.chk('P1d 状態は none（初回）', public.get_diagnosis_change_status('salon_culture_user')->>'state' = 'none', public.get_diagnosis_change_status('salon_culture_user')::text);
  req := gen_random_uuid();
  r := public.confirm_salon_culture_diagnosis(null, req, d.rev);
  perform pg_temp.chk('P1e 確認画面から確定: 初回', r->>'action' = 'initial' and r->>'locked_until' is null, r::text);
  reset role;
  perform pg_temp.chk('P1f 公開結果ができ、下書きは消える', (select status from public.salon_culture_profiles where salon_user_id = u) = 'completed' and (select count(*) from public.salon_culture_drafts where salon_user_id = u) = 0);
  set local role authenticated; perform set_config('request.jwt.claims', format('{"sub":"%s"}', u), true);
  perform pg_temp.chk('P1g 初回後の状態は can_change（変更1回が残る）', public.get_diagnosis_change_status('salon_culture_user')->>'state' = 'can_change');

  ---------------- P2 編集の途中でも、公開中の結果は維持される ----------------
  d := public.save_salon_culture_draft(null, pg_temp.payload(1, null, null, 2));
  d := public.save_salon_culture_draft(null, pg_temp.payload(1, null, 'y', 8), d.rev);
  reset role;
  select answers, status::text into pub from public.salon_culture_profiles where salon_user_id = u;
  perform pg_temp.chk('P2a 下書きを何度保存しても、公開中の12問・状態(completed)は変わらない', (pub->>'q1_education_support') = '3' and (select status from public.salon_culture_profiles where salon_user_id = u) = 'completed');
  perform pg_temp.chk('P2b 公開中の結果は変わらず、回数も消費されない', (select change_count from public.diagnosis_change_limits where user_id = u and kind='salon_culture_user') = 0);

  ---------------- P7 失敗しても、公開結果・回数・下書きが食い違わない ----------------
  set local role authenticated; perform set_config('request.jwt.claims', format('{"sub":"%s"}', u), true);
  d := public.save_salon_culture_draft(null, pg_temp.payload(1, null, 'y', 13), (select rev from public.salon_culture_drafts where salon_user_id = u));
  msg := pg_temp.try(format($q$select public.confirm_salon_culture_diagnosis(null, gen_random_uuid(), %s)$q$, d.rev + 5));
  perform pg_temp.chk('P7a 版番号が古い/違う確定は拒否（別タブ）', msg = 'draft_changed', msg);
  msg := pg_temp.try(format($q$select public.save_salon_culture_draft(null, pg_temp.payload(2), %s)$q$, d.rev + 5));
  perform pg_temp.chk('P7b 版番号が違う下書き保存は拒否（上書きしない）', msg = 'draft_changed', msg);
  reset role;
  perform pg_temp.chk('P7c 拒否の後も、下書き・公開結果・回数は変わらない',
    (select payload->>'comment' from public.salon_culture_drafts where salon_user_id = u) = 'y'
    and (select answers->>'q1_education_support' from public.salon_culture_profiles where salon_user_id = u) = '3'
    and (select change_count from public.diagnosis_change_limits where user_id = u and kind='salon_culture_user') = 0
    and (select count(*) from public.diagnosis_save_requests where kind='salon_culture_user' and user_id = u) = 1);

  ---------------- P3 変更1回 → 3か月ロック → 拒否しても下書きと公開結果は保たれる ----------------
  set local role authenticated; perform set_config('request.jwt.claims', format('{"sub":"%s"}', u), true);
  req := gen_random_uuid();
  r := public.confirm_salon_culture_diagnosis(null, req, d.rev);
  perform pg_temp.chk('P3a 導入後の変更1回', r->>'action' = 'change' and r->>'locked_until' is not null, r::text);
  perform pg_temp.chk('P3b 状態は locked で、解除日時が返る', public.get_diagnosis_change_status('salon_culture_user')->>'state' = 'locked' and public.get_diagnosis_change_status('salon_culture_user')->>'locked_until' is not null);
  d := public.save_salon_culture_draft(null, pg_temp.payload(5, null, 'z'));
  msg := pg_temp.try(format($q$select public.confirm_salon_culture_diagnosis(null, gen_random_uuid(), %s)$q$, d.rev));
  perform pg_temp.chk('P3c ロック中の確定は拒否（解除日時つき）', msg = 'diagnosis_change_locked', msg);
  reset role;
  perform pg_temp.chk('P3d 拒否後も、公開結果は変更後のまま・下書きは残り・回数は1のまま',
    (select answers->>'q1_education_support' from public.salon_culture_profiles where salon_user_id = u) = '1'
    and (select count(*) from public.salon_culture_drafts where salon_user_id = u) = 1
    and (select change_count from public.diagnosis_change_limits where user_id = u and kind='salon_culture_user') = 1);

  ---------------- P8 再送・二重送信 ----------------
  set local role authenticated; perform set_config('request.jwt.claims', format('{"sub":"%s"}', u), true);
  -- 別内容(z)の下書きが残った状態で、確定済みrequest_idを使い回す → 拒否（別操作の取り違え防止）
  msg := pg_temp.try(format($q$select public.confirm_salon_culture_diagnosis(null, %L)$q$, req));
  perform pg_temp.chk('P8a 同じrequest_idで別内容の確定は拒否', msg = 'request id content mismatch', msg);
  -- 同じ内容(P3aと同一)の下書きに戻して再送 → 同じ操作として返る（二重に数えない）
  d := public.save_salon_culture_draft(null, pg_temp.payload(1, null, 'y', 13), (select rev from public.salon_culture_drafts where salon_user_id = u));
  r := public.confirm_salon_culture_diagnosis(null, req, d.rev);
  perform pg_temp.chk('P8a2 同一内容の再送は replay として返る', coalesce((r->>'replay')::boolean,false), r::text);
  reset role;
  perform pg_temp.chk('P8b 再送で回数・公開結果が増減しない', (select change_count from public.diagnosis_change_limits where user_id = u and kind='salon_culture_user') = 1
    and (select answers->>'q1_education_support' from public.salon_culture_profiles where salon_user_id = u) = '1');

  ---------------- P4 解除後に再び1回 → 再ロック ----------------
  update public.diagnosis_change_limits set locked_until = now() - interval '1 second' where user_id = u and kind='salon_culture_user';
  set local role authenticated; perform set_config('request.jwt.claims', format('{"sub":"%s"}', u), true);
  perform pg_temp.chk('P4a 解除後の状態は can_change', public.get_diagnosis_change_status('salon_culture_user')->>'state' = 'can_change');
  d := public.save_salon_culture_draft(null, pg_temp.payload(2, null, 'w', 13));
  r := public.confirm_salon_culture_diagnosis(null, gen_random_uuid(), d.rev);
  perform pg_temp.chk('P4b 解除後の変更1回（2回目）', r->>'action' = 'change', r::text);
  reset role;
  perform pg_temp.chk('P4c 変更回数2・再ロック', (select change_count from public.diagnosis_change_limits where user_id = u and kind='salon_culture_user') = 2
    and (select locked_until from public.diagnosis_change_limits where user_id = u and kind='salon_culture_user') > now());

  ---------------- P5 店舗: 別店舗との分離・権限 ----------------
  -- 会社オーナー(own)は f1,f2 の両方を編集できる。f2 を確定→変更→ロックしても、f1 には影響しない。
  set local role authenticated; perform set_config('request.jwt.claims', format('{"sub":"%s"}', own), true);
  -- f2 は既存の結果がある店舗（導入前から確定済み）。導入後の変更1回が残っている。
  d := public.save_salon_culture_draft(f2, pg_temp.payload(3));
  r := public.confirm_salon_culture_diagnosis(f2, gen_random_uuid(), d.rev);
  perform pg_temp.chk('P5a f2 既存結果の導入後の変更1回', r->>'action' = 'change' and r->>'locked_until' is not null, r::text);
  d := public.save_salon_culture_draft(f2, pg_temp.payload(2));
  msg := pg_temp.try(format($q$select public.confirm_salon_culture_diagnosis(%L, gen_random_uuid(), %s)$q$, f2, d.rev));
  perform pg_temp.chk('P5b f2 の2回目の変更はロックで拒否', msg = 'diagnosis_change_locked', msg);
  perform pg_temp.chk('P5c f2 は locked', public.get_diagnosis_change_status('salon_culture_store', f2)->>'state' = 'locked');
  perform pg_temp.chk('P5d f1 は f2 のロックの影響を受けない（初期店舗の同期で本人用が作られている場合を除き、店舗の状態は none/can_change）',
    public.get_diagnosis_change_status('salon_culture_store', f1)->>'state' in ('none','can_change'), public.get_diagnosis_change_status('salon_culture_store', f1)::text);
  d := public.save_salon_culture_draft(f1, pg_temp.payload(4));
  r := public.confirm_salon_culture_diagnosis(f1, gen_random_uuid(), d.rev);
  perform pg_temp.chk('P5e f1 は f2 がロック中でも、自分の規則どおり確定できる', r->>'action' in ('initial','change'), r::text);
  perform pg_temp.chk('P5f 本人用の下書きと店舗用の下書きは別（f1の確定は f2 の下書き・結果を変えない）',
    (select answers->>'q1_education_support' from public.salon_store_culture_profiles where store_id = f2) = '3');
  -- f2 に権限のない f1 の担当者(mgr)
  perform set_config('request.jwt.claims', format('{"sub":"%s"}', mgr), true);
  msg := pg_temp.try(format($q$select public.save_salon_culture_draft(%L, pg_temp.payload(1))$q$, f2));
  perform pg_temp.chk('P5g 権限のない店舗(f2)の下書き保存は拒否', msg = 'not allowed to edit this store', msg);
  msg := pg_temp.try(format($q$select public.confirm_salon_culture_diagnosis(%L, gen_random_uuid())$q$, f2));
  perform pg_temp.chk('P5h 権限のない店舗(f2)の確定は拒否', msg = 'not allowed to edit this store', msg);
  msg := pg_temp.try(format($q$select public.discard_salon_culture_draft(%L)$q$, f2));
  perform pg_temp.chk('P5i 権限のない店舗(f2)の下書き破棄は拒否', msg = 'not allowed to edit this store', msg);
  -- 閲覧専用(viewer)
  perform set_config('request.jwt.claims', format('{"sub":"%s"}', viewer), true);
  msg := pg_temp.try(format($q$select public.save_salon_culture_draft(%L, pg_temp.payload(1))$q$, f1));
  perform pg_temp.chk('P5j 閲覧専用は下書き保存できない', msg = 'not allowed to edit this store', msg);
  msg := pg_temp.try(format($q$select public.confirm_salon_culture_diagnosis(%L, gen_random_uuid())$q$, f1));
  perform pg_temp.chk('P5k 閲覧専用は確定できない', msg = 'not allowed to edit this store', msg);
  perform pg_temp.chk('P5l 閲覧専用には下書きが見えない', (select count(*) from public.salon_culture_drafts) = 0);
  reset role;
  perform pg_temp.chk('P5m 権限エラーで、f1・f2 の結果と回数は変わらない',
    (select change_count from public.diagnosis_change_limits where store_id = f2 and kind='salon_culture_store') = 1
    and (select answers->>'q1_education_support' from public.salon_store_culture_profiles where store_id = f1) = '4');

  ---------------- P6 初期店舗→本人用の同期の影響 ----------------
  -- own は f1 の初期オンボーディング本人。f1 の確定（P5e）で、own の本人用が「行なし→初期化」されている。
  perform pg_temp.chk('P6a 初期店舗の確定で、本人用が初期化され「初回保存」の状態ができた', (select status from public.salon_culture_profiles where salon_user_id = own) = 'completed'
    and exists (select 1 from public.diagnosis_change_limits where user_id = own and kind = 'salon_culture_user'));
  set local role authenticated; perform set_config('request.jwt.claims', format('{"sub":"%s"}', own), true);
  d := public.save_salon_culture_draft(null, pg_temp.payload(2));
  r := public.confirm_salon_culture_diagnosis(null, gen_random_uuid(), d.rev);
  perform pg_temp.chk('P6b 本人が自分の結果を変更（1回）→本人用がロック', r->>'action' = 'change' and public.get_diagnosis_change_status('salon_culture_user')->>'state' = 'locked', r::text);
  -- f1 を（update locked 後に）変更する前に f1 を解除して変更する → 本人用は上書きされない
  reset role;
  update public.diagnosis_change_limits set locked_until = null where store_id = f1 and kind = 'salon_culture_store';
  select answers into pub from public.salon_culture_profiles where salon_user_id = own;
  set local role authenticated; perform set_config('request.jwt.claims', format('{"sub":"%s"}', own), true);
  d := public.save_salon_culture_draft(f1, pg_temp.payload(5));
  r := public.confirm_salon_culture_diagnosis(f1, gen_random_uuid(), d.rev);
  reset role;
  perform pg_temp.chk('P6c 店舗(f1)の変更は店舗側で確定する', r->>'action' in ('change','initial'), r::text);
  perform pg_temp.chk('P6d 同期は本人の確定結果を上書きしない（本人用の回答は変わらない）→ 本人用と店舗用は食い違う（仕様。README 6章）',
    (select answers from public.salon_culture_profiles where salon_user_id = own) is not distinct from pub
    and (select answers->>'q1_education_support' from public.salon_store_culture_profiles where store_id = f1) = '5');
  perform pg_temp.chk('P6e 店舗の変更は本人用のロックを変えない', (select locked_until from public.diagnosis_change_limits where user_id = own and kind='salon_culture_user') > now());

  ---------------- P9 保存要求の記録の整合 ----------------
  perform pg_temp.chk('P9 失敗した確定は保存要求に残らない（成功した確定だけが記録される）',
    (select count(*) from public.diagnosis_save_requests where kind='salon_culture_user' and user_id = u) = 3, (select count(*) from public.diagnosis_save_requests where kind='salon_culture_user' and user_id = u)::text);
end $$;

select n, case when ok then 'PASS' else 'FAIL' end as result, name, case when ok then '' else info end as info from t_log order by n;
select count(*) filter (where ok) as pass, count(*) filter (where not ok) as fail from t_log;
rollback;
