-- 0058 適用後チェック（読み取り専用）。PASS / FAIL / INFO と、最後に総合判定(99)。
-- INFO は人が適用前チェックの値と見比べる行（成功・失敗の判定に使わない）。
with t as (
  select 1 as no, '状態表・保存要求表・下書き表が存在' as item,
         (to_regclass('public.diagnosis_change_limits') is not null and to_regclass('public.diagnosis_save_requests') is not null and to_regclass('public.salon_culture_drafts') is not null) as ok
  union all select 2, '制限のトリガー4つが存在（診断結果・サロン本人・店舗・追加5問）',
         (select count(*) = 4 from pg_trigger where tgname in ('trg_diagnosis_results_limit','trg_salon_culture_profiles_limit','trg_salon_store_culture_profiles_limit','trg_salon_culture_analysis_limit') and not tgisinternal)
  union all select 3, '正規の関数5つが存在',
         (select count(*) = 5 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('commit_diagnosis_result','get_diagnosis_change_status','save_salon_culture_draft','discard_salon_culture_draft','confirm_salon_culture_diagnosis'))
  union all select 4, '権限: 確定保存は service_role のみ／状態取得・下書き・確認は authenticated のみ（anonはどれも不可）',
         (select bool_and(
            not has_function_privilege('anon', p.oid, 'execute')
            and case when p.proname = 'commit_diagnosis_result'
                     then has_function_privilege('service_role', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')
                     else has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('service_role', p.oid, 'execute') end)
            from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('commit_diagnosis_result','get_diagnosis_change_status','save_salon_culture_draft','discard_salon_culture_draft','confirm_salon_culture_diagnosis'))
  union all select 5, '内部ゲート関数は誰も実行できない',
         (select bool_and(not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('service_role', p.oid, 'execute'))
            from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('_diagnosis_limit_gate','_diag_gate_open','_diag_gate_close','_diag_owner_lock'))
  union all select 6, '状態表は authenticated が参照のみ（書き込み不可）。anon・service_roleは触れない',
         (has_table_privilege('authenticated','public.diagnosis_change_limits','select') and not has_table_privilege('authenticated','public.diagnosis_change_limits','insert,update,delete')
          and not has_table_privilege('anon','public.diagnosis_change_limits','select') and not has_table_privilege('service_role','public.diagnosis_change_limits','insert,update,delete'))
  union all select 7, '状態表のRLSが有効',
         (select relrowsecurity from pg_class where oid = 'public.diagnosis_change_limits'::regclass)
  union all select 8, '導入時に「ロック中」の行が無い（遡ってロックしていない）',
         (select count(*) = 0 from public.diagnosis_change_limits where locked_until is not null and created_at > now() - interval '1 hour' and last_change_at is null)
  union all select 9, '導入時の状態行は変更回数0（過去の受診回数を数えていない）',
         (select count(*) = 0 from public.diagnosis_change_limits where change_count > 0 and last_change_at is null)
  union all select 10, '美容師の状態行数が、診断結果を持つ会員数以上',
         (select (select count(*) from public.diagnosis_change_limits where kind='stylist') >= (select count(distinct user_id) from public.diagnosis_results where mode='stylist'))
)
select no, case when ok then 'PASS' else 'FAIL' end as level, item, case when ok then 'OK' else 'NG' end as value from t
union all select 12, 'INFO', '状態行 美容師（適用前チェック2行目と比較）', (select count(*) from public.diagnosis_change_limits where kind='stylist')::text
union all select 13, 'INFO', '状態行 サロン診断14問（同4行目）', (select count(*) from public.diagnosis_change_limits where kind='salon_quiz')::text
union all select 14, 'INFO', '状態行 サロンらしさ本人用（同5行目）', (select count(*) from public.diagnosis_change_limits where kind='salon_culture_user')::text
union all select 15, 'INFO', '状態行 サロンらしさ店舗用（同6行目）', (select count(*) from public.diagnosis_change_limits where kind='salon_culture_store')::text
union all select 16, 'INFO', '診断結果の総件数（同8行目と同じであるべき）', (select count(*) from public.diagnosis_results)::text
union all select 99, case when (select bool_and(ok) from t) then 'PASS' else 'FAIL' end, '総合判定（FAILが1つでもあれば FAIL）', ''
order by 1;
