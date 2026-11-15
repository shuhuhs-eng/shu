-- 0074 適用前チェック（SELECT1文・読み取り専用）。PASS/FAIL/INFO、最終行が総合判定。
with r(ord, level, item, detail) as (values
 (1, case when to_regprocedure('public.save_stylist_profile_v3(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[],date,text,text,date,text,date,text)') is not null then 'PASS' else 'FAIL' end, '前提: 0073が適用済み（v3保存関数）', ''),
 (2, case when not exists (select 1 from pg_trigger where tgname='trg_career_phase_required_on_insert' and tgrelid='public.stylist_profiles'::regclass) then 'PASS' else 'FAIL' end, '0074が未適用', ''),
 (3, case when has_function_privilege('authenticated', to_regprocedure('public.save_stylist_profile_v2(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[],date,text)'), 'execute') then 'PASS' else 'FAIL' end, '現状: 旧経路は authenticated が実行できる（0074で閉じる）', ''),
 (4, 'INFO', '【人が確認】アプリは v3 に切り替えて配備済みか（未配備のまま0074を適用すると、旧アプリのプロフィール保存・立場の保存が拒否される）', ''),
 (5, 'INFO', '立場の内訳（未設定 / 美容学生 / 新卒 / 現役 / ブランクあり）。未設定・美容学生は、本人の次回の保存で選び直す（0074は変更しない）', (select count(*) filter (where career_phase is null)::text||' / '||count(*) filter (where career_phase='student')::text||' / '||count(*) filter (where career_phase='new_graduate')::text||' / '||count(*) filter (where career_phase='experienced')::text||' / '||count(*) filter (where career_phase='blank')::text from public.stylist_profiles))
)
select ord, level, item, detail from (select ord::text as ord, level, item, detail from r
union all
select '99', case when (select count(*) from r where level='FAIL')=0 then 'PASS' else 'FAIL' end, '総合判定（INFO '||(select count(*) from r where level='INFO')||'件は人が確認）', 'FAIL '||(select count(*) from r where level='FAIL')||'件'
) t order by ord::int;
