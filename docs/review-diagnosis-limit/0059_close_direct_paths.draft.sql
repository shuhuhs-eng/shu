-- ============================================================================
-- 0059（旧経路の「実行権限」を片付ける・多重防御）。本番未適用。0058とは別に、アプリ切替の確認後に適用する。
-- ============================================================================
-- 制限そのものは 0058 の表トリガーが担っており、0059 が無くても旧RPC・直接INSERTで制限は迂回できない。
-- 0059 は「使われなくなった入口を閉じる」だけの整理。権限を外す以外は何もしない（データ・状態表・トリガーに触れない）。
--   ・service_role が diagnosis_results へ直接 INSERT する権限を外す（0054 の付与の取り消し）
--   ・サロンらしさの保存関数4つを authenticated から直接呼べなくする
--     （0058 の confirm_salon_culture_diagnosis は SECURITY DEFINER の内部呼び出しなので影響を受けない）
-- 診断結果・変更回数・ロック日時は一切変更しない。RLS無効化・全体GRANT・ALTER DEFAULT PRIVILEGES は使わない。
-- 適用順: 0059_preapply_check.sql（総合PASS）→ この本体 → 0059_postapply_check.sql（総合PASS）。
-- 問題が出たら 0059_rollback_permissions.sql（外した権限5件だけを戻す。0058の制限は維持）。
-- 本体は自己検証付き: 前提（0058適用済み）を満たさない、または適用後に権限が期待どおりでなければ、
-- 例外で全体が取り消され、何も変わらない（1トランザクション）。
begin;

do $$
begin
  if to_regprocedure('public.commit_diagnosis_result(uuid,uuid,boolean,text,public.diagnosis_mode,jsonb,smallint,smallint,smallint,smallint,smallint,smallint,text,text,smallint,text,uuid,timestamptz)') is null
     or (select count(*) from pg_trigger where tgname in ('trg_diagnosis_results_limit','trg_salon_culture_profiles_limit','trg_salon_store_culture_profiles_limit','trg_salon_culture_analysis_limit') and not tgisinternal and tgenabled <> 'D') <> 4 then
    raise exception '0059を中止: 0058が適用済み（確定保存関数と制限トリガー4つ）ではありません。何も変更していません。';
  end if;
end $$;

revoke insert on table public.diagnosis_results from service_role;
revoke execute on function public.save_salon_culture_profile(public.salon_culture_status, public.salon_culture_respondent_role, integer, jsonb, text[], text) from authenticated;
revoke execute on function public.save_salon_store_culture_profile(uuid, public.salon_culture_status, public.salon_culture_respondent_role, integer, jsonb, text[], text) from authenticated;
revoke execute on function public.save_salon_culture_analysis_answers(text, jsonb, jsonb) from authenticated;
revoke execute on function public.save_salon_store_culture_analysis_answers(uuid, text, jsonb, jsonb) from authenticated;

-- 自己検証（満たさなければ例外＝全体を取り消す）: 旧経路が閉じ、新しい保存経路に必要な権限が残っていること。
do $$
declare s text;
begin
  if has_table_privilege('service_role', 'public.diagnosis_results', 'insert') then
    raise exception '0059を取り消し: service_role の直接INSERT権限が外れていません（別の経路で付与されている可能性）。';
  end if;
  for s in select o.sig from (values
  ('public.save_salon_culture_profile(public.salon_culture_status,public.salon_culture_respondent_role,integer,jsonb,text[],text)'),
  ('public.save_salon_store_culture_profile(uuid,public.salon_culture_status,public.salon_culture_respondent_role,integer,jsonb,text[],text)'),
  ('public.save_salon_culture_analysis_answers(text,jsonb,jsonb)'),
  ('public.save_salon_store_culture_analysis_answers(uuid,text,jsonb,jsonb)')
) as o(sig) loop
    if has_function_privilege('authenticated', to_regprocedure(s), 'execute') or has_function_privilege('anon', to_regprocedure(s), 'execute') then
      raise exception '0059を取り消し: % の実行権限が authenticated/anon から外れていません（PUBLIC付与の可能性）。', s;
    end if;
  end loop;
  if not has_function_privilege('service_role', to_regprocedure('public.commit_diagnosis_result(uuid,uuid,boolean,text,public.diagnosis_mode,jsonb,smallint,smallint,smallint,smallint,smallint,smallint,text,text,smallint,text,uuid,timestamptz)'), 'execute')
     or has_function_privilege('authenticated', to_regprocedure('public.commit_diagnosis_result(uuid,uuid,boolean,text,public.diagnosis_mode,jsonb,smallint,smallint,smallint,smallint,smallint,smallint,text,text,smallint,text,uuid,timestamptz)'), 'execute') then
    raise exception '0059を取り消し: 確定保存関数の権限が期待と違います（service_roleのみ実行可であるべき）。';
  end if;
  for s in select n.sig from (values
  ('public.get_diagnosis_change_status(text,uuid)'),
  ('public.save_salon_culture_draft(uuid,jsonb,integer)'),
  ('public.discard_salon_culture_draft(uuid)'),
  ('public.confirm_salon_culture_diagnosis(uuid,uuid,integer)')
  ) as n(sig) loop
    if not has_function_privilege('authenticated', to_regprocedure(s), 'execute') or has_function_privilege('anon', to_regprocedure(s), 'execute') then
      raise exception '0059を取り消し: 新しい保存経路 % の権限が期待と違います。', s;
    end if;
  end loop;
end $$;

commit;
