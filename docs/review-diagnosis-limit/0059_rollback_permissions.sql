-- ============================================================================
-- 0059 だけを戻す（権限の復元のみ）。0058の制限・状態表・トリガー・関数は一切変更しない。
-- ============================================================================
-- 使う場面: 0059 の適用後に、旧経路の権限が必要な操作（旧アプリの保存など）が止まった場合。
-- 戻すのは 0059 が外した5件だけ:
--   ・service_role の diagnosis_results への INSERT
--   ・旧サロン保存関数4つの authenticated への EXECUTE
-- 0058 の制限（表トリガー）はそのまま有効なので、権限を戻しても回数制限は迂回できない。
-- 診断結果・変更回数・ロック日時には触れない。何度実行しても同じ結果（冪等）。
-- 最後に結果表と総合判定(99)が出る。
begin;
grant insert on table public.diagnosis_results to service_role;
grant execute on function public.save_salon_culture_profile(public.salon_culture_status, public.salon_culture_respondent_role, integer, jsonb, text[], text) to authenticated;
grant execute on function public.save_salon_store_culture_profile(uuid, public.salon_culture_status, public.salon_culture_respondent_role, integer, jsonb, text[], text) to authenticated;
grant execute on function public.save_salon_culture_analysis_answers(text, jsonb, jsonb) to authenticated;
grant execute on function public.save_salon_store_culture_analysis_answers(uuid, text, jsonb, jsonb) to authenticated;
commit;

with
old_fn as (select sig from (values
  ('public.save_salon_culture_profile(public.salon_culture_status,public.salon_culture_respondent_role,integer,jsonb,text[],text)'),
  ('public.save_salon_store_culture_profile(uuid,public.salon_culture_status,public.salon_culture_respondent_role,integer,jsonb,text[],text)'),
  ('public.save_salon_culture_analysis_answers(text,jsonb,jsonb)'),
  ('public.save_salon_store_culture_analysis_answers(uuid,text,jsonb,jsonb)')
) as o(sig)),
t as (
  select 1 as no, '権限が戻った: service_role の diagnosis_results への INSERT' as item, has_table_privilege('service_role','public.diagnosis_results','insert') as ok
  union all select 2, '権限が戻った: 旧サロン保存関数4つを authenticated が実行できる',
         (select count(*) = 4 and bool_and(has_function_privilege('authenticated', to_regprocedure(sig), 'execute')) from old_fn where to_regprocedure(sig) is not null)
  union all select 3, '0058の制限が維持: 制限トリガー4つが存在し有効',
         (select count(*) = 4 from pg_trigger where tgname in ('trg_diagnosis_results_limit','trg_salon_culture_profiles_limit','trg_salon_store_culture_profiles_limit','trg_salon_culture_analysis_limit') and not tgisinternal and tgenabled <> 'D')
  union all select 4, '0058の新経路の権限が残っている（確定保存=service_roleのみ／状態取得・下書き・破棄・確認=authenticated）',
         (to_regprocedure('public.commit_diagnosis_result(uuid,uuid,boolean,text,public.diagnosis_mode,jsonb,smallint,smallint,smallint,smallint,smallint,smallint,text,text,smallint,text,uuid,timestamptz)') is not null and has_function_privilege('service_role', to_regprocedure('public.commit_diagnosis_result(uuid,uuid,boolean,text,public.diagnosis_mode,jsonb,smallint,smallint,smallint,smallint,smallint,smallint,text,text,smallint,text,uuid,timestamptz)'), 'execute') and not has_function_privilege('authenticated', to_regprocedure('public.commit_diagnosis_result(uuid,uuid,boolean,text,public.diagnosis_mode,jsonb,smallint,smallint,smallint,smallint,smallint,smallint,text,text,smallint,text,uuid,timestamptz)'), 'execute')
          and (select bool_and(has_function_privilege('authenticated', to_regprocedure(s), 'execute')) from (values
  ('public.get_diagnosis_change_status(text,uuid)'),
  ('public.save_salon_culture_draft(uuid,jsonb,integer)'),
  ('public.discard_salon_culture_draft(uuid)'),
  ('public.confirm_salon_culture_diagnosis(uuid,uuid,integer)')
          ) as n(s)))
)
select no, case when ok then 'PASS' else 'FAIL' end as level, item, case when ok then 'OK' else 'NG' end as value from t
union all select 99, case when (select bool_and(ok) from t) then 'PASS' else 'FAIL' end, '総合判定', ''
order by 1;
