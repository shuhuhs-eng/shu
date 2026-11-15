-- 0071の公開保留の検証（ローカル専用）。前提: 0058→0070→0071 を適用済みのDB。全体をROLLBACKする。
\set ON_ERROR_STOP on
begin;
create temp table t_log (n serial, name text, ok boolean);
create function pg_temp.chk(p text, o boolean) returns void language sql as $$ insert into t_log(name,ok) values (p, coalesce(o,false)) $$;
insert into auth.users (id,email) values ('00000000-0000-0000-0000-0000000e0001','e1@t'),('00000000-0000-0000-0000-0000000e0002','e2@t'),('00000000-0000-0000-0000-0000000e0003','e3@t') on conflict do nothing;
insert into public.profiles (id,role) values ('00000000-0000-0000-0000-0000000e0001','stylist'),('00000000-0000-0000-0000-0000000e0002','stylist'),('00000000-0000-0000-0000-0000000e0003','stylist') on conflict do nothing;
insert into public.stylist_profiles (user_id) values ('00000000-0000-0000-0000-0000000e0001'),('00000000-0000-0000-0000-0000000e0002'),('00000000-0000-0000-0000-0000000e0003') on conflict do nothing;
-- e1: 区分未設定・生年月日なし（既存会員と同じ）→ 従来どおり公開可
select pg_temp.chk('G1 区分未設定・生年月日なし: 従来どおり（保留対象外）', public.stylist_salon_publishable('00000000-0000-0000-0000-0000000e0001'));
-- e2: 学生・生年月日なし → 保留（成人と推定しない）
update public.stylist_profiles set career_phase='student', graduation_ym=date_trunc('month', now())::date + interval '6 months', graduation_kind='planned' where user_id='00000000-0000-0000-0000-0000000e0002';
select pg_temp.chk('G2 学生・生年月日なし: 保留', not public.stylist_salon_publishable('00000000-0000-0000-0000-0000000e0002'));
-- e2に満18歳の生年月日 → 公開可
insert into public.stylist_private (user_id, birth_date) values ('00000000-0000-0000-0000-0000000e0002', (current_date - interval '19 years')::date) on conflict (user_id) do update set birth_date=excluded.birth_date;
select pg_temp.chk('G3 学生・満19歳: 公開可', public.stylist_salon_publishable('00000000-0000-0000-0000-0000000e0002'));
update public.stylist_private set birth_date=(current_date - interval '16 years')::date where user_id='00000000-0000-0000-0000-0000000e0002';
select pg_temp.chk('G4 学生・満16歳: 保留', not public.stylist_salon_publishable('00000000-0000-0000-0000-0000000e0002'));
-- e3: 新卒・生年月日なし → 保留
update public.stylist_profiles set career_phase='new_graduate', graduation_ym=date_trunc('month', now())::date - interval '2 months', graduation_kind='completed' where user_id='00000000-0000-0000-0000-0000000e0003';
select pg_temp.chk('G5 新卒・生年月日なし: 保留', not public.stylist_salon_publishable('00000000-0000-0000-0000-0000000e0003'));
-- 区分を経験者に（本人が選んだ）・生年月日なし → 保留対象外（従来どおり）
update public.stylist_profiles set career_phase='experienced', graduation_ym=null, graduation_kind=null where user_id='00000000-0000-0000-0000-0000000e0003';
select pg_temp.chk('G6 経験者(本人選択)・生年月日なし: 保留対象外', public.stylist_salon_publishable('00000000-0000-0000-0000-0000000e0003'));
-- フラグ解除で学生も公開可、削除で保留（安全側）
update public.feature_pauses set paused=false where feature='minor_salon_public';
select pg_temp.chk('G7 フラグ解除: 満16歳の学生も公開可（解除は別承認）', public.stylist_salon_publishable('00000000-0000-0000-0000-0000000e0002'));
delete from public.feature_pauses where feature='minor_salon_public';
select pg_temp.chk('G8 フラグ行なし: 保留（安全側）', not public.stylist_salon_publishable('00000000-0000-0000-0000-0000000e0002'));
select pg_temp.chk('G9 直接実行は誰にも許可しない', not has_function_privilege('authenticated','public.stylist_salon_publishable(uuid)','execute') and not has_function_privilege('service_role','public.stylist_salon_publishable(uuid)','execute'));
select n, case when ok then 'PASS' else 'FAIL' end, name from t_log order by n;
select case when bool_and(ok) then 'ALL PASS' else 'HAS FAIL' end from t_log;
rollback;
