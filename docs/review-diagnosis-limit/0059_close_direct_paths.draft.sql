-- ============================================================================
-- 0059（草案 v2・未適用）: 旧経路の「実行権限」を片付ける（多重防御）
-- ============================================================================
-- v2 では、制限は 0058 の表トリガーが担うため、0059 が無くても旧RPC・直接INSERTで制限は迂回できません。
-- 0059 は「使われなくなった入口を閉じる」整理です。アプリ切替の後に適用します（先に適用すると旧アプリの保存が止まる）。
--   ・service_role が diagnosis_results へ直接 INSERT する権限を外す（0054 の付与の取り消し）
--   ・サロンらしさの保存関数4つを authenticated から直接呼べなくする
--     （0058 の confirm_salon_culture_diagnosis は SECURITY DEFINER の内部呼び出しなので影響を受けない）
-- RLS無効化・全体GRANT・ALTER DEFAULT PRIVILEGES は使わない。
begin;
revoke insert on table public.diagnosis_results from service_role;
revoke execute on function public.save_salon_culture_profile(public.salon_culture_status, public.salon_culture_respondent_role, integer, jsonb, text[], text) from authenticated;
revoke execute on function public.save_salon_store_culture_profile(uuid, public.salon_culture_status, public.salon_culture_respondent_role, integer, jsonb, text[], text) from authenticated;
revoke execute on function public.save_salon_culture_analysis_answers(text, jsonb, jsonb) from authenticated;
revoke execute on function public.save_salon_store_culture_analysis_answers(uuid, text, jsonb, jsonb) from authenticated;
commit;
