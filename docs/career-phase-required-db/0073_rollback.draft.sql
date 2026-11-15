-- 0073 の巻き戻し（草案・未適用）。0074 を適用していれば、先に 0074_rollback を実行する。
-- 立場に 'blank' が1件でもあれば、旧い制約へ戻せないため、何も変更せずに中止する（データは削除しない）。
begin;
set local lock_timeout = '15s';
lock table public.stylist_profiles in access exclusive mode;
do $$
begin
  if exists (select 1 from public.stylist_profiles where career_phase = 'blank') then
    raise exception 'rollback refused: career_phase = blank exists';
  end if;
  if exists (select 1 from pg_trigger where tgname='trg_career_phase_required_on_insert' and tgrelid='public.stylist_profiles'::regclass) then
    raise exception 'rollback 0074 first';
  end if;
end $$;
drop function if exists public.save_stylist_profile_v3(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[],date,text,text,date,text,date,text);
drop trigger if exists trg_career_phase_valid on public.stylist_profiles;
drop function if exists public._trg_career_phase_valid();
alter table public.stylist_profiles drop constraint if exists stylist_profiles_career_phase_consistent;
alter table public.stylist_profiles drop constraint if exists stylist_profiles_career_phase_check;
alter table public.stylist_profiles add constraint stylist_profiles_career_phase_check check (career_phase in ('student','new_graduate','experienced'));
alter table public.stylist_profiles add constraint stylist_profiles_career_phase_consistent check ((
  (career_phase is null and graduation_ym is null and graduation_kind is null and desired_start_ym is null and license_status is null)
  or (career_phase = 'experienced' and graduation_ym is null and graduation_kind is null and desired_start_ym is null and license_status is null)
  or (career_phase = 'student' and graduation_ym is not null and graduation_kind is not null and graduation_kind = 'planned')
  or (career_phase = 'new_graduate' and graduation_ym is not null and graduation_kind is not null and graduation_kind in ('planned','completed'))
) is true);
commit;
