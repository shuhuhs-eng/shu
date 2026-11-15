-- 0072 適用前チェック（SELECT1文・読み取り専用）。PASS/FAIL/INFO、最終行が総合判定。
with r(ord, level, item, detail) as (values
 (1, case when to_regprocedure('public.save_stylist_profile_v2(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[],date,text)') is not null
        and exists (select 1 from pg_trigger where tgname='trg_stylist_profiles_birth_required' and tgrelid='public.stylist_profiles'::regclass and tgenabled='O') then 'PASS' else 'FAIL' end, '前提: 0070が適用済み（v2保存関数・生年月日必須トリガーあり）', ''),
 (2, case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='stylist_profiles' and column_name='value_priorities' and data_type='ARRAY')
        and exists (select 1 from pg_constraint where conrelid='public.stylist_profiles'::regclass and contype='c' and pg_get_constraintdef(oid) like '%value_priorities%') then 'PASS' else 'FAIL' end, '前提: value_priorities 列と、3件のCHECK制約がある', ''),
 (3, case when to_regprocedure('public.set_stylist_value_priorities(text[])') is null then 'PASS' else 'FAIL' end, '0072が未適用（専用の保存関数がまだ無い）', ''),
 (4, case when not has_table_privilege('authenticated','public.stylist_profiles','update') and not has_table_privilege('authenticated','public.stylist_profiles','insert') then 'PASS' else 'FAIL' end, '前提: authenticated は stylist_profiles を直接書けない（保存は関数経由）', ''),
 (5, 'INFO', '美容師プロフィール数', (select count(*)::text from public.stylist_profiles)),
 (6, 'INFO', '「大切にしたいこと」が3件で保存済みの数（0072適用後も値は変わらない）', (select count(*)::text from public.stylist_profiles where value_priorities is not null)),
 (7, 'INFO', '許可された12項目以外のコードを含む保存済みの数（既存データ。0072は読み書きしない。新しい保存は12項目のみ許可）', (select count(*)::text from public.stylist_profiles sp where value_priorities is not null and exists (select 1 from unnest(sp.value_priorities) c where c <> all (array['work_life_balance','skill_growth','teamwork','independence','income_stability','customer_relationship','education_support','brand_customer_base','work_flexibility','evaluation_fairness','location_convenience','culture_fit'])))),
 (8, 'INFO', 'stylist_profiles への書き込みが進行中のトランザクション数（0なら待ちなしで適用できる）', (select count(*)::text from pg_locks l join pg_class c on c.oid=l.relation where c.relname='stylist_profiles' and l.mode='RowExclusiveLock' and l.granted))
)
select ord, level, item, detail from (select ord::text as ord, level, item, detail from r
union all
select '99', case when (select count(*) from r where level='FAIL')=0 then 'PASS' else 'FAIL' end, '総合判定（INFO '||(select count(*) from r where level='INFO')||'件は人が確認）', 'FAIL '||(select count(*) from r where level='FAIL')||'件'
) t order by ord::int;
