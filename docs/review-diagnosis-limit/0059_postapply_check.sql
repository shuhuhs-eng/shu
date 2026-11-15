-- 0059 適用後チェック（読み取り専用）。PASS / FAIL / INFO と、最後に総合判定(99)。
-- 確認すること: 旧経路の権限が閉じている／新しい保存経路に必要な権限が残っている／0058の制限が維持されている。
-- INFO は適用前チェック（0059_preapply_check.sql）の値と見比べる行（成否の判定に使わない）。
with
old_fn as (select sig from (values
  ('public.save_salon_culture_profile(public.salon_culture_status,public.salon_culture_respondent_role,integer,jsonb,text[],text)'),
  ('public.save_salon_store_culture_profile(uuid,public.salon_culture_status,public.salon_culture_respondent_role,integer,jsonb,text[],text)'),
  ('public.save_salon_culture_analysis_answers(text,jsonb,jsonb)'),
  ('public.save_salon_store_culture_analysis_answers(uuid,text,jsonb,jsonb)')
) as o(sig)),
new_auth as (select sig from (values
  ('public.get_diagnosis_change_status(text,uuid)'),
  ('public.save_salon_culture_draft(uuid,jsonb,integer)'),
  ('public.discard_salon_culture_draft(uuid)'),
  ('public.confirm_salon_culture_diagnosis(uuid,uuid,integer)')
) as n(sig)),
t as (
  select 1 as no, '旧経路: service_role は diagnosis_results へ直接INSERTできない' as item,
         not has_table_privilege('service_role','public.diagnosis_results','insert') as ok
  union all select 2, '旧経路: authenticated / anon も diagnosis_results へ直接INSERTできない（従来どおり）',
         (not has_table_privilege('authenticated','public.diagnosis_results','insert') and not has_table_privilege('anon','public.diagnosis_results','insert'))
  union all select 3, '旧経路: 旧サロン保存関数4つを authenticated / anon が実行できない',
         (select count(*) = 4 and bool_and(not has_function_privilege('authenticated', to_regprocedure(sig), 'execute') and not has_function_privilege('anon', to_regprocedure(sig), 'execute')) from old_fn where to_regprocedure(sig) is not null)
  union all select 4, '新経路: 確定保存関数は service_role のみ実行可（authenticated・anon不可）',
         (to_regprocedure('public.commit_diagnosis_result(uuid,uuid,boolean,text,public.diagnosis_mode,jsonb,smallint,smallint,smallint,smallint,smallint,smallint,text,text,smallint,text,uuid,timestamptz)') is not null and has_function_privilege('service_role', to_regprocedure('public.commit_diagnosis_result(uuid,uuid,boolean,text,public.diagnosis_mode,jsonb,smallint,smallint,smallint,smallint,smallint,smallint,text,text,smallint,text,uuid,timestamptz)'), 'execute')
          and not has_function_privilege('authenticated', to_regprocedure('public.commit_diagnosis_result(uuid,uuid,boolean,text,public.diagnosis_mode,jsonb,smallint,smallint,smallint,smallint,smallint,smallint,text,text,smallint,text,uuid,timestamptz)'), 'execute') and not has_function_privilege('anon', to_regprocedure('public.commit_diagnosis_result(uuid,uuid,boolean,text,public.diagnosis_mode,jsonb,smallint,smallint,smallint,smallint,smallint,smallint,text,text,smallint,text,uuid,timestamptz)'), 'execute'))
  union all select 5, '新経路: 状態取得・下書き保存・下書き破棄・確定（サロン）は authenticated が実行可（anon不可）',
         (select count(*) = 4 and bool_and(has_function_privilege('authenticated', to_regprocedure(sig), 'execute') and not has_function_privilege('anon', to_regprocedure(sig), 'execute')) from new_auth where to_regprocedure(sig) is not null)
  union all select 6, '新経路: 状態表は authenticated が参照のみ、下書き表も参照のみ（書き込み不可）',
         (has_table_privilege('authenticated','public.diagnosis_change_limits','select') and not has_table_privilege('authenticated','public.diagnosis_change_limits','insert,update,delete')
          and has_table_privilege('authenticated','public.salon_culture_drafts','select') and not has_table_privilege('authenticated','public.salon_culture_drafts','insert,update,delete'))
  union all select 7, '0058の制限が維持: 制限トリガー4つが存在し有効',
         (select count(*) = 4 from pg_trigger where tgname in ('trg_diagnosis_results_limit','trg_salon_culture_profiles_limit','trg_salon_store_culture_profiles_limit','trg_salon_culture_analysis_limit') and not tgisinternal and tgenabled <> 'D')
  union all select 8, '0058の制限が維持: 状態表・送信ID表・下書き表が存在し、状態表のRLSが有効',
         (to_regclass('public.diagnosis_change_limits') is not null and to_regclass('public.diagnosis_save_requests') is not null and to_regclass('public.salon_culture_drafts') is not null
          and (select relrowsecurity from pg_class where oid = 'public.diagnosis_change_limits'::regclass))
  union all select 9, '0058の内部ゲート関数は誰も実行できない',
         (select coalesce(bool_and(not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('service_role', p.oid, 'execute')), false)
            from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('_diagnosis_limit_gate','_diag_gate_open','_diag_gate_close','_diag_owner_lock'))
)
select no, case when ok then 'PASS' else 'FAIL' end as level, item, case when ok then 'OK' else 'NG' end as value from t
union all select 20, 'INFO', 'service_role の diagnosis_results への権限（INSERT / SELECT / UPDATE）。適用前チェック21行と比べ、INSERTだけが f になっていること',
       has_table_privilege('service_role','public.diagnosis_results','insert')::text || ' / ' || has_table_privilege('service_role','public.diagnosis_results','select')::text || ' / ' || has_table_privilege('service_role','public.diagnosis_results','update')::text
union all select 21, 'INFO', '旧サロン保存関数4つを authenticated が実行できる件数（0であるべき）',
       (select count(*) from old_fn where to_regprocedure(sig) is not null and has_function_privilege('authenticated', to_regprocedure(sig), 'execute'))::text
union all select 23, 'INFO', '診断結果の総件数（適用前チェック23行と同じ。その間に保存があれば増える）', (select count(*) from public.diagnosis_results)::text
union all select 24, 'INFO', '状態表の行数 / 変更回数の合計 / ロック中の件数（適用前チェック24行と比較）',
       (select count(*) || ' / ' || coalesce(sum(change_count),0) || ' / ' || count(*) filter (where locked_until is not null and locked_until > now()) from public.diagnosis_change_limits)
union all select 25, 'INFO', '状態表の指紋md5（適用前チェック25行と同じか。その間に誰も保存していなければ一致）',
       coalesce((select md5(string_agg(id::text || kind || change_count::text || coalesce(last_change_at::text,'-') || coalesce(locked_until::text,'-'), ',' order by id)) from public.diagnosis_change_limits), '(なし)')
union all select 26, 'INFO', '診断結果の指紋md5（id一覧。適用前チェック26行と比較）',
       coalesce((select md5(string_agg(id::text, ',' order by id)) from public.diagnosis_results), '(なし)')
union all select 99, case when (select bool_and(ok) from t) then 'PASS' else 'FAIL' end, '総合判定（FAILが1つでもあれば、0059_rollback_permissions.sql を検討）', ''
order by 1;
