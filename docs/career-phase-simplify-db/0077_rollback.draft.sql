-- 0077 の巻き戻し（草案・未適用）: v3 の実行権を authenticated へ戻す。データは変更しない。
begin;
set local lock_timeout = '15s';
grant execute on function public.save_stylist_profile_v3(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[],date,text,text,date,text,date,text) to authenticated;
commit;
