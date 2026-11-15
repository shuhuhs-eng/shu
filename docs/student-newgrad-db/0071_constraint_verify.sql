-- 0071 整合制約（stylist_profiles_career_phase_consistent）の検証（ローカル専用・全体をROLLBACK）。
-- 前提: 0071 適用済みのDB。旧定義（IS TRUE なし）を一時的に入れ直して、同じテストが「失敗する」ことも確認する。
\set ON_ERROR_STOP on
begin;
create temp table t_log (n serial, name text, ok boolean);
create function pg_temp.chk(p text, o boolean) returns void language sql as $$ insert into t_log(name,ok) values (p, coalesce(o,false)) $$;
insert into auth.users (id,email) values ('00000000-0000-0000-0000-0000000cc001','cons@t') on conflict do nothing;
insert into public.profiles (id,role) values ('00000000-0000-0000-0000-0000000cc001','stylist') on conflict do nothing;
insert into public.stylist_profiles (user_id) values ('00000000-0000-0000-0000-0000000cc001') on conflict do nothing;
-- 組み合わせを書き込んでみて、受理されたら true（失敗したらfalse）。毎回サブトランザクションで元に戻す。
create function pg_temp.accepts(p_phase text, p_ym date, p_kind text, p_start date, p_lic text) returns boolean language plpgsql as $$
begin
  begin
    update public.stylist_profiles set career_phase=p_phase, graduation_ym=p_ym, graduation_kind=p_kind, desired_start_ym=p_start, license_status=p_lic
     where user_id='00000000-0000-0000-0000-0000000cc001';
    raise exception 'ok-rollback' using errcode='P0001';
  exception when check_violation then return false; when others then if sqlerrm='ok-rollback' then return true; else raise; end if; end;
end $$;
create function pg_temp.bad_accepted() returns int language sql as $$
  select (pg_temp.accepts(null,   '2027-03-01', null,       null,         null)::int            -- 区分NULL＋卒業月だけ
        + pg_temp.accepts(null,   null,         'planned',  null,         null)::int            -- 区分NULL＋卒業区分だけ
        + pg_temp.accepts(null,   null,         null,       '2027-04-01', null)::int            -- 区分NULL＋就業開始希望だけ
        + pg_temp.accepts(null,   null,         null,       null,         'obtained')::int      -- 区分NULL＋免許状況だけ
        + pg_temp.accepts('student',      '2027-03-01', null, null, null)::int                  -- 学生で卒業区分NULL
        + pg_temp.accepts('new_graduate', '2026-03-01', null, null, null)::int                  -- 新卒で卒業区分NULL
        + pg_temp.accepts('experienced',  null, null, null, 'obtained')::int                    -- 経験者に免許状況
        + pg_temp.accepts('student',      null, 'planned', null, null)::int                     -- 学生で卒業月なし
        + pg_temp.accepts(null, '2027-03-01', 'planned',   null,         null)::int            -- 区分NULL＋卒業月・卒業区分（式がNULLになる穴）
        + pg_temp.accepts(null, '2026-03-01', 'completed', '2026-04-01', 'obtained')::int      -- 区分NULL＋卒業情報一式（式がNULLになる穴）
        + pg_temp.accepts(null, '2027-03-01', 'planned',   '2027-04-01', 'studying')::int)     -- 区分NULL＋学生の入力一式（式がNULLになる穴）
$$;
create function pg_temp.good_rejected() returns int language sql as $$
  select (not pg_temp.accepts(null, null, null, null, null))::int                               -- 未設定
       + (not pg_temp.accepts('experienced', null, null, null, null))::int
       + (not pg_temp.accepts('student', '2027-03-01', 'planned', '2027-04-01', 'studying'))::int
       + (not pg_temp.accepts('new_graduate', '2026-03-01', 'completed', '2026-04-01', 'obtained'))::int
       + (not pg_temp.accepts('new_graduate', '2027-03-01', 'planned', null, 'exam_planned'))::int
$$;
-- ===== 修正後（現行の定義） =====
select pg_temp.chk('K1 現行: 許可する組み合わせ5種（未設定・経験者・学生・新卒2種）はすべて受理', pg_temp.good_rejected() = 0);
select pg_temp.chk('K2 現行: 不正な組み合わせ11種はすべて拒否', pg_temp.bad_accepted() = 0);
select pg_temp.chk('K3 現行の定義は IS TRUE 判定', (select pg_get_constraintdef(oid) like '%IS TRUE%' from pg_constraint where conname='stylist_profiles_career_phase_consistent'));
-- ===== 旧定義（IS TRUE なし）へ一時的に差し替え: 同じテストが失敗する＝テストが穴を検出できる =====
alter table public.stylist_profiles drop constraint stylist_profiles_career_phase_consistent;
alter table public.stylist_profiles add constraint stylist_profiles_career_phase_consistent check (
  (career_phase is null and graduation_ym is null and graduation_kind is null and desired_start_ym is null and license_status is null)
  or (career_phase = 'experienced' and graduation_ym is null and graduation_kind is null and desired_start_ym is null and license_status is null)
  or (career_phase = 'student' and graduation_ym is not null and graduation_kind is not null and graduation_kind = 'planned')
  or (career_phase = 'new_graduate' and graduation_ym is not null and graduation_kind is not null and graduation_kind in ('planned','completed'))
);
select pg_temp.chk('M1 旧定義: 不正な組み合わせの一部が実際に受理される（テストが穴を検出できる）', pg_temp.bad_accepted() >= 3);
select pg_temp.chk('M2 旧定義: 区分NULL＋卒業情報（式がNULLになる3種）が受理される', (pg_temp.accepts(null,'2027-03-01','planned',null,null)::int + pg_temp.accepts(null,'2026-03-01','completed','2026-04-01','obtained')::int + pg_temp.accepts(null,'2027-03-01','planned','2027-04-01','studying')::int) = 3);
select pg_temp.chk('M3 旧定義: 単独項目だけ・卒業区分NULLは旧定義でも拒否（RPCと合わせた二重の備え）', (pg_temp.accepts(null,'2027-03-01',null,null,null)::int + pg_temp.accepts('student','2027-03-01',null,null,null)::int + pg_temp.accepts('new_graduate','2026-03-01',null,null,null)::int) = 0);
select n, case when ok then 'PASS' else 'FAIL' end as r, name from t_log order by n;
rollback;
