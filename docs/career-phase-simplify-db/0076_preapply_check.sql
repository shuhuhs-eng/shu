-- 0076 適用前チェック（SELECT1文・読み取り専用）。PASS/FAIL/INFO、最終行が総合判定。
with r(ord, level, item, detail) as (values
 (1, case when to_regprocedure('public.save_stylist_profile_v3(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[],date,text,text,date,text,date,text)') is not null then 'PASS' else 'FAIL' end, '前提: 0073が適用済み（v3保存関数）', ''),
 (2, case when to_regprocedure('public.save_stylist_profile_v4(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[],date,text,text,date,integer,text)') is null and not exists (select 1 from information_schema.columns where table_schema='public' and table_name='stylist_profiles' and column_name='blank_period_value') then 'PASS' else 'FAIL' end, '0076が未適用（v4・ブランク期間の列がまだ無い）', ''),
 (3, case when exists (select 1 from pg_constraint where conname='stylist_profiles_career_phase_consistent' and conrelid='public.stylist_profiles'::regclass) and exists (select 1 from pg_constraint where conname='stylist_profiles_start_after_graduation' and conrelid='public.stylist_profiles'::regclass) then 'PASS' else 'FAIL' end, '置き換える制約が現在の名前である', ''),
 (4, case when to_regprocedure('public.set_stylist_value_priorities(text[])') is not null then 'PASS' else 'FAIL' end, '前提: 0072（大切にしたい働き方の専用保存）が適用済み（この変更は触らない）', ''),
 (5, case when exists (select 1 from pg_trigger where tgname='trg_career_phase_required_on_insert' and tgrelid='public.stylist_profiles'::regclass) then 'PASS' else 'FAIL' end, '前提: 0074が適用済み（旧経路が閉じている）', ''),
 (6, 'INFO', '立場の内訳（未設定 / 美容学生 / 新卒 / 現役 / ブランクあり）', (select count(*) filter (where career_phase is null)::text||' / '||count(*) filter (where career_phase='student')::text||' / '||count(*) filter (where career_phase='new_graduate')::text||' / '||count(*) filter (where career_phase='experienced')::text||' / '||count(*) filter (where career_phase='blank')::text from public.stylist_profiles)),
 (7, 'INFO', '新卒のうち卒業月が3月・10月以外の行数（変更しない。本人が次回の保存で選び直す）', (select count(*)::text from public.stylist_profiles where career_phase='new_graduate' and extract(month from graduation_ym) not in (3,10))),
 (8, 'INFO', '旧3項目（卒業の区分/就業開始/免許）が入っている行数（削除・変換しない）', (select count(*) filter (where graduation_kind is not null)::text||' / '||count(*) filter (where desired_start_ym is not null)::text||' / '||count(*) filter (where license_status is not null)::text from public.stylist_profiles))
)
select ord, level, item, detail from (select ord::text as ord, level, item, detail from r
union all
select '99', case when (select count(*) from r where level='FAIL')=0 then 'PASS' else 'FAIL' end, '総合判定（INFO '||(select count(*) from r where level='INFO')||'件は人が確認）', 'FAIL '||(select count(*) from r where level='FAIL')||'件'
) t order by ord::int;
