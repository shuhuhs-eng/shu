-- 0072 適用後チェック（SELECT1文・読み取り専用）。PASS/FAIL/INFO、最終行が総合判定。
with f as (select * from pg_proc p where p.oid = to_regprocedure('public.set_stylist_value_priorities(text[])')),
r(ord, level, item, detail) as (values
 (1, case when exists (select 1 from f) then 'PASS' else 'FAIL' end, '専用の保存関数 set_stylist_value_priorities(text[]) がある', ''),
 (2, case when (select pronargs = 1 and proargnames = array['p_value_priorities']::text[] and prorettype = 'void'::regtype from f) then 'PASS' else 'FAIL' end, '引数は p_value_priorities のみ（公開範囲・生年月日・表示方法・その他の項目は引数に無い）・戻り値なし', ''),
 (3, case when (select prosecdef and exists (select 1 from unnest(coalesce(proconfig,'{}')) c where c like 'search_path=%') from f) then 'PASS' else 'FAIL' end, 'SECURITY DEFINER で search_path を固定', ''),
 (4, case when (select has_function_privilege('authenticated', oid, 'execute') and not has_function_privilege('anon', oid, 'execute') and not has_function_privilege('service_role', oid, 'execute') and not exists (select 1 from aclexplode(coalesce(proacl, acldefault('f', proowner))) a where a.grantee = 0) from f) then 'PASS' else 'FAIL' end, '実行権限は authenticated だけ（anon・service_role・PUBLICは不可）', ''),
 (5, case when (select (length(prosrc) - length(replace(lower(prosrc), 'update ', ''))) / 7 = 1 and lower(prosrc) like '%set value_priorities = p_value_priorities where user_id = v_uid%' and lower(prosrc) like '%auth.uid()%' from f) then 'PASS' else 'FAIL' end, '静的確認: UPDATEは1回だけで、SETは value_priorities の1列だけ・本人の行（auth.uid()）だけ', ''),
 (6, case when (select lower(prosrc) like '%cardinality(p_value_priorities) <> 3%' and lower(prosrc) like '%count(distinct c)%' and lower(prosrc) like '%<> all (v_allowed)%' and lower(prosrc) like '%is null%' from f) then 'PASS' else 'FAIL' end, '静的確認: 3件・重複なし・許可項目・NULLなしの検証がDB側にある', ''),
 (7, case when not has_table_privilege('authenticated','public.stylist_profiles','update') and not has_table_privilege('authenticated','public.stylist_profiles','insert') then 'PASS' else 'FAIL' end, 'authenticated は stylist_profiles を直接書けないまま（この関数は表の権限を付与しない）', ''),
 (8, case when to_regprocedure('public.save_stylist_profile_v2(text,text,public.age_band,public.gender_type,text,text,integer,text,text[],public.employment_type,public.job_change_intent,public.salary_band,jsonb,text,public.profile_visibility,boolean,text,text[],date,text)') is not null
        and exists (select 1 from pg_trigger where tgname='trg_stylist_profiles_birth_required' and tgrelid='public.stylist_profiles'::regclass and tgenabled='O') then 'PASS' else 'FAIL' end, '既存のv2保存関数と生年月日必須トリガーが変わらずある', ''),
 (9, case when to_regprocedure('public.commit_diagnosis_result(uuid,uuid,boolean,text,public.diagnosis_mode,jsonb,smallint,smallint,smallint,smallint,smallint,smallint,text,text,smallint,text,uuid,timestamptz)') is null then 'INFO'
        when not has_function_privilege('authenticated', to_regprocedure('public.commit_diagnosis_result(uuid,uuid,boolean,text,public.diagnosis_mode,jsonb,smallint,smallint,smallint,smallint,smallint,smallint,text,text,smallint,text,uuid,timestamptz)'), 'execute') then 'PASS' else 'FAIL' end,
  '診断の保存関数の権限は変わらない（authenticated は実行不可のまま。関数が無い環境＝0058未適用の検証用DBでは INFO）', ''),
 (10, 'INFO', '「大切にしたいこと」が3件で保存済みの数（適用前のINFOと同じはず）', (select count(*)::text from public.stylist_profiles where value_priorities is not null)),
 (11, 'INFO', '美容師プロフィール数（適用前と同じはず）', (select count(*)::text from public.stylist_profiles))
)
select ord, level, item, detail from (select ord::text as ord, level, item, detail from r
union all
select '99', case when (select count(*) from r where level='FAIL')=0 then 'PASS' else 'FAIL' end, '総合判定（INFO '||(select count(*) from r where level='INFO')||'件は人が確認）', 'FAIL '||(select count(*) from r where level='FAIL')||'件'
) t order by ord::int;
