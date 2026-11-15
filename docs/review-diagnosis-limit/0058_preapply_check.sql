-- 0058 適用前チェック（読み取り専用・何も変更しません）。Supabase SQLエディタでそのまま実行できます。
-- PASS / FAIL = 適用の前提を満たすか。INFO = 人が見る件数（適用後チェックの値と見比べる。成否の判定には使わない）。
-- 最後の行（99）が総合判定。FAIL が1つでもあれば本体を適用しない。
with t as (
  select 1 as no, '0058が未適用（状態表・新関数・トリガーが無い）。適用済みなら再適用しない' as item,
         (to_regclass('public.diagnosis_change_limits') is null and to_regclass('public.diagnosis_save_requests') is null
          and to_regclass('public.salon_culture_drafts') is null
          and to_regprocedure('public.get_diagnosis_change_status(text,uuid)') is null
          and not exists (select 1 from pg_trigger where tgname in ('trg_diagnosis_results_limit','trg_salon_culture_profiles_limit','trg_salon_store_culture_profiles_limit','trg_salon_culture_analysis_limit') and not tgisinternal)) as ok
  union all select 2, '前提の表が存在（0001・0005・0026・0029・0056）',
         (to_regclass('public.profiles') is not null and to_regclass('public.user_roles') is not null and to_regclass('public.diagnosis_results') is not null
          and to_regclass('public.salon_stores') is not null and to_regclass('public.salon_culture_profiles') is not null
          and to_regclass('public.salon_store_culture_profiles') is not null and to_regclass('public.salon_culture_analysis_answers') is not null)
  union all select 3, '前提の型が存在（diagnosis_mode・salon_culture_status・salon_culture_respondent_role）',
         (to_regtype('public.diagnosis_mode') is not null and to_regtype('public.salon_culture_status') is not null and to_regtype('public.salon_culture_respondent_role') is not null)
  union all select 4, '前提の関数が存在（set_updated_at・is_store_accessible・can_edit_store_culture_analysis・追加5問の基準関数）',
         (to_regprocedure('public.set_updated_at()') is not null and to_regprocedure('public.is_store_accessible(uuid)') is not null
          and to_regprocedure('public.can_edit_store_culture_analysis(uuid)') is not null and to_regprocedure('public._salon_analysis_base_snapshot(jsonb,text)') is not null)
  union all select 5, '既存の保存関数4つが存在（0058が内部で呼ぶ）',
         (to_regprocedure('public.save_salon_culture_profile(public.salon_culture_status,public.salon_culture_respondent_role,integer,jsonb,text[],text)') is not null
          and to_regprocedure('public.save_salon_store_culture_profile(uuid,public.salon_culture_status,public.salon_culture_respondent_role,integer,jsonb,text[],text)') is not null
          and to_regprocedure('public.save_salon_culture_analysis_answers(text,jsonb,jsonb)') is not null
          and to_regprocedure('public.save_salon_store_culture_analysis_answers(uuid,text,jsonb,jsonb)') is not null)
  union all select 6, 'diagnosis_results に、トリガーで拒否される形の既存トリガーが無い（同名の制限トリガーが無い）',
         (select count(*) = 0 from pg_trigger where tgrelid = 'public.diagnosis_results'::regclass and tgname like 'trg\_%\_limit' and not tgisinternal)
)
select no, case when ok then 'PASS' else 'FAIL' end as level, item, case when ok then 'OK' else 'NG' end as value from t
union all select 20, 'INFO', '美容師: 診断結果を持つ会員数（状態が作られる件数）', (select count(distinct user_id) from public.diagnosis_results where mode = 'stylist')::text
union all select 21, 'INFO', '  うち2回以上受診済み（すべて「ロックなし・導入後1回変更可」。過去の受診回数でロックしない）',
       (select count(*) from (select user_id from public.diagnosis_results where mode='stylist' group by user_id having count(*) >= 2) x)::text
union all select 22, 'INFO', 'サロン診断14問: 結果を持つ会員数', (select count(distinct user_id) from public.diagnosis_results where mode = 'salon')::text
union all select 23, 'INFO', 'サロンらしさ12問（本人用）: 確定済み件数', (select count(*) from public.salon_culture_profiles where status = 'completed')::text
union all select 24, 'INFO', 'サロンらしさ12問（店舗用）: 確定済み件数', (select count(*) from public.salon_store_culture_profiles where status = 'completed')::text
union all select 25, 'INFO', '導入時に「ロック中」になる件数（常に0。遡ってロックしない）', '0'
union all select 26, 'INFO', '診断結果の総件数（適用前後で同じであるべき）', (select count(*) from public.diagnosis_results)::text
union all select 27, 'INFO', 'この件数は、適用後チェックの12〜16行目と見比べる', '適用後に一致するか確認'
union all select 99, case when (select bool_and(ok) from t) then 'PASS' else 'FAIL' end, '総合判定（FAILが1つでもあれば適用しない）', ''
order by 1;
