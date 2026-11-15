-- 0071 適用前チェック（SELECT1文・読み取り専用）。PASS/FAIL/INFO、最終行が総合判定。
with r(ord, level, item, detail) as (values
 (1, case when to_regclass('public.diagnosis_change_limits') is not null and to_regprocedure('public._diagnosis_limit_gate(text,uuid,uuid,uuid,boolean,boolean,boolean,text)') is not null then 'PASS' else 'FAIL' end, '前提: 0058が適用済み', ''),
 (2, case when to_regprocedure('public.stylist_salon_publishable(uuid)') is not null and exists (select 1 from public.feature_pauses where feature='minor_salon_public' and paused) then 'PASS' else 'FAIL' end, '前提: 0070が適用済み（公開判定関数あり・未成年フラグが保留）', ''),
 (3, case when (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.commit_diagnosis_result(uuid,uuid,boolean,text,public.diagnosis_mode,jsonb,smallint,smallint,smallint,smallint,smallint,smallint,text,text,smallint,text,uuid,timestamptz)')) = '04fe4af9ea696398239f95f6f984b6f6'
        and (select md5(prosrc) from pg_proc where oid = to_regprocedure('public._trg_diagnosis_results_limit()')) = '15df323841beef4372b72dc2e2d488e4' then 'PASS' else 'FAIL' end, '置き換える2関数が0058の定義のまま', ''),
 (4, case when to_regclass('public.stylist_diagnosis_current') is null and to_regclass('public.student_diagnosis_results') is null
        and not exists (select 1 from information_schema.columns where table_schema='public' and table_name='stylist_profiles' and column_name='career_phase') then 'PASS' else 'FAIL' end, '0071が未適用（新設の表・列がまだ無い）', ''),
 (5, 'INFO', '現在の経験者診断を持つ会員数（適用後の「現在の診断」初期登録の件数と一致するはず）', (select count(distinct user_id)::text from public.diagnosis_results where mode='stylist')),
 (6, 'INFO', '美容師プロフィール数（区分は全員NULL＝未設定で始まる）', (select count(*)::text from public.stylist_profiles)),
 (7, 'INFO', '結果表への書き込みが進行中のトランザクション数（0なら待ちなしで適用できる）', (select count(*)::text from pg_locks l join pg_class c on c.oid=l.relation where c.relname='diagnosis_results' and l.mode in ('RowExclusiveLock') and l.granted))
)
select ord, level, item, detail from (select ord::text as ord, level, item, detail from r
union all
select '99', case when (select count(*) from r where level='FAIL')=0 then 'PASS' else 'FAIL' end, '総合判定（INFO '||(select count(*) from r where level='INFO')||'件は人が確認）', 'FAIL '||(select count(*) from r where level='FAIL')||'件'
) t order by ord::int;
