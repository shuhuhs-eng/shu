-- 0059 適用前チェック（読み取り専用・何も変更しません）。Supabase SQLエディタでそのまま実行できます。
-- 最後に結果表（no / level / item / value）と総合判定（99）が出ます。FAIL が1つでもあれば本体を適用しません。
-- PASS/FAIL = 適用の前提。INFO = 人が見る情報（適用後チェックの値と見比べる）。
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
-- 送信ID記録の見分け方: 新経路（確定保存関数・サロンの確定）は保存の完了時に result_ref を記録する。
-- 旧経路（旧RPC・直接INSERT）は、0058の表トリガーが制限だけ適用して記録するため result_ref が空になる。
ev as (select kind, count(*) filter (where result_ref is not null) as n_new, count(*) filter (where result_ref is null) as n_old,
              max(created_at) filter (where result_ref is not null) as latest_new, max(created_at) filter (where result_ref is null) as latest_old
         from public.diagnosis_save_requests group by kind),
t as (
  select 1 as no, '0058が適用済み（状態表3つ・確定保存関数・新関数）' as item,
         (to_regclass('public.diagnosis_change_limits') is not null and to_regclass('public.diagnosis_save_requests') is not null and to_regclass('public.salon_culture_drafts') is not null
          and to_regprocedure('public.commit_diagnosis_result(uuid,uuid,boolean,text,public.diagnosis_mode,jsonb,smallint,smallint,smallint,smallint,smallint,smallint,text,text,smallint,text,uuid,timestamptz)') is not null
          and (select count(*) = 4 from new_auth where to_regprocedure(sig) is not null)) as ok
  union all select 2, '0058の制限トリガー4つが存在し有効（0059後もこの制限を維持する）',
         (select count(*) = 4 from pg_trigger where tgname in ('trg_diagnosis_results_limit','trg_salon_culture_profiles_limit','trg_salon_store_culture_profiles_limit','trg_salon_culture_analysis_limit') and not tgisinternal and tgenabled <> 'D')
  union all select 3, '外す対象の旧サロン保存関数4つが存在（無いと本体がエラーで止まる）',
         (select count(*) = 4 from old_fn where to_regprocedure(sig) is not null)
  union all select 4, '0059が未適用（旧経路の権限が1つ以上まだ開いている）。適用済みなら再適用しない',
         (has_table_privilege('service_role','public.diagnosis_results','insert')
          or exists (select 1 from old_fn where to_regprocedure(sig) is not null and has_function_privilege('authenticated', to_regprocedure(sig), 'execute')))
  union all select 5, 'authenticated の実行権限がPUBLIC付与ではなく直接付与（PUBLIC付与だと authenticated だけ外しても閉じない）',
         (select coalesce(bool_and(not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = to_regprocedure(sig) and a.grantee = 0 and a.privilege_type = 'EXECUTE')), true) from old_fn where to_regprocedure(sig) is not null)
  union all select 6, '新経路の権限が現在そろっている（確定保存=service_roleのみ／状態取得・下書き・破棄・確認=authenticatedのみ・anon不可）',
         (to_regprocedure('public.commit_diagnosis_result(uuid,uuid,boolean,text,public.diagnosis_mode,jsonb,smallint,smallint,smallint,smallint,smallint,smallint,text,text,smallint,text,uuid,timestamptz)') is not null
          and has_function_privilege('service_role', to_regprocedure('public.commit_diagnosis_result(uuid,uuid,boolean,text,public.diagnosis_mode,jsonb,smallint,smallint,smallint,smallint,smallint,smallint,text,text,smallint,text,uuid,timestamptz)'), 'execute')
          and not has_function_privilege('authenticated', to_regprocedure('public.commit_diagnosis_result(uuid,uuid,boolean,text,public.diagnosis_mode,jsonb,smallint,smallint,smallint,smallint,smallint,smallint,text,text,smallint,text,uuid,timestamptz)'), 'execute')
          and (select coalesce(bool_and(has_function_privilege('authenticated', to_regprocedure(sig), 'execute') and not has_function_privilege('anon', to_regprocedure(sig), 'execute')), false) from new_auth))
  union all select 7, '【新経路の利用実績】美容師の確定保存が、0058の新経路（kind=stylist・結果の記録あり）で1件以上ある',
         coalesce((select n_new > 0 from ev where kind = 'stylist'), false)
  union all select 8, '【新経路の利用実績】サロン側の確定が、0058の新経路（送信ID記録 kind=salon_culture_user または salon_culture_store）で1件以上ある',
         coalesce((select sum(n_new) > 0 from ev where kind in ('salon_culture_user','salon_culture_store')), false)
  union all select 9, '【旧経路が動いていない】直近3時間に、旧経路（旧RPC・直接INSERT。結果の記録なしの送信ID記録）による保存が無い',
         not exists (select 1 from ev where latest_old > now() - interval '3 hours')
)
select no, case when ok then 'PASS' else 'FAIL' end as level, item, case when ok then 'OK' else 'NG' end as value from t
union all select 20, 'INFO', '保存の記録（kind: 新経路の件数・最新日時JST ／ 旧経路の件数・最新日時JST）。旧経路の最新が適用の数時間以内なら、旧アプリが動いている可能性',
       coalesce((select string_agg(kind || ': 新 ' || n_new || ' (' || coalesce((latest_new at time zone 'Asia/Tokyo')::text,'-') || ') ／ 旧 ' || n_old || ' (' || coalesce((latest_old at time zone 'Asia/Tokyo')::text,'-') || ')', E'\n' order by kind) from ev), '記録なし')
union all select 21, 'INFO', 'service_role の diagnosis_results への権限（INSERT / SELECT / UPDATE）。適用後はINSERTだけ f になる',
       has_table_privilege('service_role','public.diagnosis_results','insert')::text || ' / ' || has_table_privilege('service_role','public.diagnosis_results','select')::text || ' / ' || has_table_privilege('service_role','public.diagnosis_results','update')::text
union all select 22, 'INFO', '旧サロン保存関数4つを authenticated が実行できる件数（適用後は0）',
       (select count(*) from old_fn where to_regprocedure(sig) is not null and has_function_privilege('authenticated', to_regprocedure(sig), 'execute'))::text
union all select 23, 'INFO', '診断結果の総件数（0059では変わらない）', (select count(*) from public.diagnosis_results)::text
union all select 24, 'INFO', '状態表の行数 / 変更回数の合計 / ロック中の件数（0059では変わらない）',
       (select count(*) || ' / ' || coalesce(sum(change_count),0) || ' / ' || count(*) filter (where locked_until is not null and locked_until > now()) from public.diagnosis_change_limits)
union all select 25, 'INFO', '状態表の指紋md5（id・kind・回数・最終変更・ロック日時。適用の直前直後で、その間に誰も保存していなければ一致する）',
       coalesce((select md5(string_agg(id::text || kind || change_count::text || coalesce(last_change_at::text,'-') || coalesce(locked_until::text,'-'), ',' order by id)) from public.diagnosis_change_limits), '(なし)')
union all select 26, 'INFO', '診断結果の指紋md5（id一覧）',
       coalesce((select md5(string_agg(id::text, ',' order by id)) from public.diagnosis_results), '(なし)')
union all select 99, case when (select bool_and(ok) from t) then 'PASS' else 'FAIL' end, '総合判定（FAILが1つでもあれば適用しない）', ''
order by 1;
