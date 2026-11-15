-- 0071 と公開判定の整合の検証（ローカル専用）。前提: 0058→0070→0071 を適用済みのDB。全体をROLLBACKする。
-- 確定方針: 公開判定は 0070 の定義（生年月日登録・表示方法の選択・正確な満年齢）のまま。区分（学生・新卒）では変えない。
\set ON_ERROR_STOP on
begin;
create temp table t_log (n serial, name text, ok boolean);
create function pg_temp.chk(p text, o boolean) returns void language sql as $$ insert into t_log(name,ok) values (p, coalesce(o,false)) $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as $$ begin execute p_sql; return 'OK'; exception when others then return sqlerrm; end $$;
insert into auth.users (id,email) values ('00000000-0000-0000-0000-0000000e0001','e1@t'),('00000000-0000-0000-0000-0000000e0002','e2@t'),('00000000-0000-0000-0000-0000000e0003','e3@t') on conflict do nothing;
insert into public.profiles (id,role) values ('00000000-0000-0000-0000-0000000e0001','stylist'),('00000000-0000-0000-0000-0000000e0002','stylist'),('00000000-0000-0000-0000-0000000e0003','stylist') on conflict do nothing;
insert into public.user_roles (user_id,role) values ('00000000-0000-0000-0000-0000000e0001','stylist'),('00000000-0000-0000-0000-0000000e0002','stylist'),('00000000-0000-0000-0000-0000000e0003','stylist') on conflict do nothing;
-- G1 生年月日未登録: プロフィール行（区分の設定を含む）を作れない（0070のトリガー）
select pg_temp.chk('G1 生年月日未登録ではプロフィール行を作れない', pg_temp.try($q$insert into public.stylist_profiles (user_id) values ('00000000-0000-0000-0000-0000000e0001')$q$) like '%birth_date_required%');
-- 登録して作成
insert into public.stylist_private (user_id, birth_date, age_display_mode) values
  ('00000000-0000-0000-0000-0000000e0001', (current_date - interval '30 years')::date, 'decade'),
  ('00000000-0000-0000-0000-0000000e0002', (current_date - interval '19 years')::date, 'exact'),
  ('00000000-0000-0000-0000-0000000e0003', (current_date - interval '16 years')::date, 'decade');
insert into public.stylist_profiles (user_id) values ('00000000-0000-0000-0000-0000000e0001'),('00000000-0000-0000-0000-0000000e0002'),('00000000-0000-0000-0000-0000000e0003');
-- G2 学生区分でも、満19歳・表示方法選択済みなら公開可（区分による別扱いなし）
update public.stylist_profiles set career_phase='student', graduation_ym=date_trunc('month', now())::date + interval '6 months', graduation_kind='planned' where user_id='00000000-0000-0000-0000-0000000e0002';
select pg_temp.chk('G2 学生・満19歳・表示方法あり: 公開可', public.stylist_salon_publishable('00000000-0000-0000-0000-0000000e0002'));
-- G3 学生・満16歳（年代表示でも）: 保留（年代表示で未成年の保留を回避できない）
update public.stylist_profiles set career_phase='student', graduation_ym=date_trunc('month', now())::date + interval '6 months', graduation_kind='planned' where user_id='00000000-0000-0000-0000-0000000e0003';
select pg_temp.chk('G3 学生・満16歳・年代表示: 保留', not public.stylist_salon_publishable('00000000-0000-0000-0000-0000000e0003'));
-- G4 区分を経験者へ変えても、満16歳の保留は変わらない
update public.stylist_profiles set career_phase='experienced', graduation_ym=null, graduation_kind=null where user_id='00000000-0000-0000-0000-0000000e0003';
select pg_temp.chk('G4 経験者へ変更しても満16歳は保留のまま', not public.stylist_salon_publishable('00000000-0000-0000-0000-0000000e0003'));
-- G5 新卒・年代表示・成人: 公開可（区分は判定に使わない）
update public.stylist_profiles set career_phase='new_graduate', graduation_ym=date_trunc('month', now())::date - interval '2 months', graduation_kind='completed' where user_id='00000000-0000-0000-0000-0000000e0001';
select pg_temp.chk('G5 新卒・満30歳・年代表示: 公開可', public.stylist_salon_publishable('00000000-0000-0000-0000-0000000e0001'));
-- G6 フラグ解除: 満16歳も公開可（解除は別承認。ここでは判定の確認のみ）
update public.feature_pauses set paused=false where feature='minor_salon_public';
select pg_temp.chk('G6 フラグ解除: 満16歳も公開可（表示方法は選択済み）', public.stylist_salon_publishable('00000000-0000-0000-0000-0000000e0003'));
-- G7 表示方法を未選択に戻すことはできない（NULLは拒否）／生年月日をNULLへ戻せない
select pg_temp.chk('G7 登録済みの生年月日はNULLへ戻せない', pg_temp.try($q$update public.stylist_private set birth_date=null where user_id='00000000-0000-0000-0000-0000000e0001'$q$) like '%cannot be cleared%');
delete from public.feature_pauses where feature='minor_salon_public';
select pg_temp.chk('G8 フラグ行なし: 満16歳は保留（安全側）', not public.stylist_salon_publishable('00000000-0000-0000-0000-0000000e0003'));
select pg_temp.chk('G9 直接実行は誰にも許可しない', not has_function_privilege('authenticated','public.stylist_salon_publishable(uuid)','execute') and not has_function_privilege('service_role','public.stylist_salon_publishable(uuid)','execute'));
select pg_temp.chk('G10 区分設定RPCも生年月日必須（トリガー経由）', exists(select 1 from pg_trigger where tgname='trg_stylist_profiles_birth_required' and tgrelid='public.stylist_profiles'::regclass));
select n, case when ok then 'PASS' else 'FAIL' end, name from t_log order by n;
select case when bool_and(ok) then 'ALL PASS' else 'HAS FAIL' end from t_log;
rollback;
