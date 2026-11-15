-- 0071 適用後チェック（SELECT1文・読み取り専用）。PASS/FAIL/INFO、最終行が総合判定。
with r(ord, level, item, detail) as (values
 (1, case when (select count(*) from public.stylist_profiles where career_phase is not null) = 0 then 'PASS' else 'FAIL' end, '既存会員の区分はすべてNULL（未設定。経験者と推定していない）', ''),
 (2, case when not exists (select 1 from public.diagnosis_results d where d.mode='stylist' and not exists (select 1 from public.stylist_diagnosis_current c where c.user_id=d.user_id)) then 'PASS' else 'FAIL' end, '経験者診断を持つ全会員に「現在の診断」の行がある（初期登録の漏れなし）', ''),
 (3, case when not exists (select 1 from (select distinct on (user_id) user_id, id from public.diagnosis_results where mode='stylist' order by user_id, created_at desc, id desc) l left join public.stylist_diagnosis_current c on c.user_id=l.user_id where c.result_id is distinct from l.id and c.seq = 1) then 'PASS' else 'FAIL' end, '初期登録の行は、各会員の最新の経験者診断を指している', ''),
 (4, case when (select count(*) from public.student_diagnosis_results) = 0 then 'PASS' else 'INFO' end, '学生・新卒診断の結果は適用直後は0件', (select count(*)::text from public.student_diagnosis_results)),
 (5, case when (select md5(string_agg(pg_get_functiondef(p.oid), '' order by p.proname)) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('_diagnosis_limit_gate','_diag_owner_lock','_diag_gate_open','_diag_gate_close')) is not null
        and (select count(*) from pg_trigger where tgname in ('trg_set_current_diagnosis','trg_student_diagnosis_limit','trg_diagnosis_results_limit') and not tgisinternal and tgenabled='O') = 4 then 'PASS' else 'FAIL' end, '診断の結果表のトリガーが有効（現在の診断×2・学生の制限・経験者の制限）', ''),
 (6, case when has_function_privilege('service_role','public.commit_student_diagnosis(uuid,uuid,text,jsonb,jsonb)','execute') and not has_function_privilege('authenticated','public.commit_student_diagnosis(uuid,uuid,text,jsonb,jsonb)','execute') and not has_function_privilege('anon','public.commit_student_diagnosis(uuid,uuid,text,jsonb,jsonb)','execute')
        and has_function_privilege('authenticated','public.set_stylist_career_phase(text,date,text,date,text)','execute') and not has_function_privilege('anon','public.set_stylist_career_phase(text,date,text,date,text)','execute') and not has_function_privilege('service_role','public.set_stylist_career_phase(text,date,text,date,text)','execute')
        and not has_function_privilege('authenticated','public.stylist_salon_publishable(uuid)','execute') then 'PASS' else 'FAIL' end, '新設関数の実行権限（commit=service_roleのみ／区分設定=authenticatedのみ／公開判定=直接実行不可）', ''),
 (7, case when has_table_privilege('authenticated','public.student_diagnosis_results','select') and not has_table_privilege('authenticated','public.student_diagnosis_results','insert') and not has_table_privilege('anon','public.student_diagnosis_results','select')
        and has_table_privilege('authenticated','public.stylist_diagnosis_current','select') and not has_table_privilege('authenticated','public.stylist_diagnosis_current','insert') and not has_table_privilege('service_role','public.stylist_diagnosis_current','insert') then 'PASS' else 'FAIL' end, '結果表・現在の診断表の権限（本人の読み取りのみ。直接書き込み不可）', ''),
 (8, case when (select pg_get_constraintdef(oid) from pg_constraint where conname='stylist_profiles_career_phase_consistent') like '%graduation_kind IS NOT NULL%' then 'PASS' else 'FAIL' end, '卒業区分NULLを拒否する制約が入っている', ''),
 (9, case when (select pg_get_functiondef(oid) like '%career_phase%' from pg_proc where oid = to_regprocedure('public.stylist_salon_publishable(uuid)')) and exists (select 1 from public.feature_pauses where feature='minor_salon_public' and paused) then 'PASS' else 'FAIL' end, '公開判定が学生・新卒の年齢未確認を保留し、未成年フラグが保留のまま', ''),
 (10, 'INFO', '生年月日未登録の既存会員は従来どおり表示（年齢は「年齢未登録」）。学生・新卒で未登録の人数', (select count(*)::text from public.stylist_profiles sp where sp.career_phase in ('student','new_graduate')))
)
select ord, level, item, detail from (select ord::text as ord, level, item, detail from r
union all
select '99', case when (select count(*) from r where level='FAIL')=0 then 'PASS' else 'FAIL' end, '総合判定', 'FAIL '||(select count(*) from r where level='FAIL')||'件'
) t order by ord::int;
