-- 0074 の巻き戻し（草案・未適用）: 旧経路の権限とトリガーを元に戻す。データには触れない。
begin;
set local lock_timeout = '15s';
drop trigger if exists trg_career_phase_required_on_insert on public.stylist_profiles;
drop function if exists public._trg_career_phase_required_on_insert();
grant execute on function public.save_stylist_profile_v2(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[],date,text) to authenticated;
grant execute on function public.save_stylist_profile(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[]) to authenticated;
grant execute on function public.set_stylist_career_phase(text, date, text, date, text) to authenticated;
commit;
