-- 0077 適用前チェック（SELECT1文・読み取り専用）
with r(ord, level, item, detail) as (values
 (1, case when to_regprocedure('public.save_stylist_profile_v4(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[],date,text,text,date,integer,text)') is not null then 'PASS' else 'FAIL' end, '前提: 0076が適用済み（v4）', ''),
 (2, case when has_function_privilege('authenticated', to_regprocedure('public.save_stylist_profile_v3(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[],date,text,text,date,text,date,text)'), 'execute') then 'PASS' else 'FAIL' end, '0077が未適用（v3を authenticated が実行できる）', ''),
 (3, 'INFO', '【人が確認】アプリ（v4へ切り替え済みの版）が本番に配備され、プロフィール保存が成功していること', '')
)
select ord, level, item, detail from (select ord::text as ord, level, item, detail from r
union all
select '99', case when (select count(*) from r where level='FAIL')=0 then 'PASS' else 'FAIL' end, '総合判定（INFO '||(select count(*) from r where level='INFO')||'件は人が確認）', 'FAIL '||(select count(*) from r where level='FAIL')||'件'
) t order by ord::int;
