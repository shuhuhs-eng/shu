-- 0076 の巻き戻し（草案・未適用）。★新しいデータが失われる場合は、何も削除せず中止する。
--  中止する条件（いずれか1行でもあれば例外）:
--   ・ブランク期間が保存されている行がある（列を消すと失われる）
--   ・新卒で「卒業の区分」が空の行がある（0073の制約に戻すと違反する。区分を補うことはしない）
--   ・卒業月が3月／10月の新卒の行は問題ないが、現役/ブランクの行に旧3項目が残っている行がある（0073の制約に戻すと違反する）
--  事前に、運営者がそれらの行をどう扱うかを決めてから実行する（このSQLは決めない）。
-- ★実行順のガード: 0077（v3を閉じる）が適用済みなら、何も変更する前に拒否する。先に 0077 を巻き戻してから、この巻き戻しを行うこと。
--   （0077適用済みのままv4を削除すると、v3もv4も使えず、プロフィールを保存できなくなるため）
begin;
set local lock_timeout = '15s';
-- 実行順のガード（何も変更する前・ロックを取る前に判定）
do $$
begin
  if to_regprocedure('public.save_stylist_profile_v3(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[],date,text,text,date,text,date,text)') is null
     or not has_function_privilege('authenticated', to_regprocedure('public.save_stylist_profile_v3(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[],date,text,text,date,text,date,text)'), 'execute') then
    raise exception 'rollback aborted: 0077 is applied (save_stylist_profile_v3 is closed). Roll back 0077 first (0077_rollback.draft.sql), then roll back 0076.';
  end if;
end $$;
lock table public.stylist_profiles in share row exclusive mode;
do $$
declare n int;
begin
  select count(*) into n from public.stylist_profiles where blank_period_value is not null or blank_period_unit is not null;
  if n > 0 then raise exception 'rollback aborted: % row(s) have a blank period (would be lost)', n; end if;
  select count(*) into n from public.stylist_profiles where career_phase = 'new_graduate' and graduation_kind is null;
  if n > 0 then raise exception 'rollback aborted: % new_graduate row(s) have no graduation kind (cannot restore 0073 constraint)', n; end if;
  select count(*) into n from public.stylist_profiles where career_phase in ('experienced','blank') and (graduation_kind is not null or desired_start_ym is not null or license_status is not null);
  if n > 0 then raise exception 'rollback aborted: % experienced/blank row(s) keep legacy fields (cannot restore 0073 constraint)', n; end if;
  select count(*) into n from public.stylist_profiles where desired_start_ym is not null and graduation_ym is not null and desired_start_ym < graduation_ym;
  if n > 0 then raise exception 'rollback aborted: % row(s) violate start-after-graduation (cannot restore constraint)', n; end if;
end $$;
drop function if exists public.save_stylist_profile_v4(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[],date,text,text,date,integer,text);
drop trigger if exists trg_graduation_month_valid on public.stylist_profiles;
drop trigger if exists trg_blank_period_follow_phase on public.stylist_profiles;
drop function if exists public._trg_graduation_month_valid();
drop function if exists public._trg_blank_period_follow_phase();
alter table public.stylist_profiles drop constraint if exists stylist_profiles_career_phase_consistent;
alter table public.stylist_profiles add constraint stylist_profiles_career_phase_consistent check ((
  (career_phase is null and graduation_ym is null and graduation_kind is null and desired_start_ym is null and license_status is null)
  or (career_phase in ('experienced','blank') and graduation_ym is null and graduation_kind is null and desired_start_ym is null and license_status is null)
  or (career_phase = 'student' and graduation_ym is not null and graduation_kind is not null and graduation_kind = 'planned')
  or (career_phase = 'new_graduate' and graduation_ym is not null and graduation_kind is not null and graduation_kind in ('planned','completed'))
) is true);
alter table public.stylist_profiles add constraint stylist_profiles_start_after_graduation check (desired_start_ym is null or graduation_ym is null or desired_start_ym >= graduation_ym);
alter table public.stylist_profiles drop constraint if exists stylist_profiles_blank_period_pair, drop constraint if exists stylist_profiles_blank_period_unit_check;
alter table public.stylist_profiles drop column blank_period_value, drop column blank_period_unit;
commit;
