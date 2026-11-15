-- ============================================================================
-- 0058 / 0059 の巻き戻し（草案・未適用）。適用前にレビューのためだけに置く。
-- ============================================================================
-- 目的: 0058 の適用後に問題が出たとき、制限（トリガー・新関数）だけを外して、適用前の挙動に戻す。
-- 方針:
--   ・状態表（diagnosis_change_limits / diagnosis_save_requests / salon_culture_drafts）は「消さない」。
--     回数の記録と、途中回答（下書き）を失わないため。再適用するときも、そのまま使える。
--     表ごと消す場合は、記録が失われることを承知のうえで、別途手で行う（この草案には含めない）。
--   ・0059 を適用済みの場合は、先に下の「A. 0059 の取り消し」を実行する（旧経路の権限を戻す）。
--   ・新アプリは、commit_diagnosis_result が無いDBでは従来の保存に戻る設計なので、巻き戻しても動き続ける。
--     ただし、サロンらしさの新アプリ（下書き保存＋確定）は新関数が必要なので、巻き戻す場合はアプリも一つ前の版へ戻す。
begin;

-- A. 0059 の取り消し（0059 を適用していなければ何も変わらない）
grant insert on table public.diagnosis_results to service_role;
grant execute on function public.save_salon_culture_profile(public.salon_culture_status, public.salon_culture_respondent_role, integer, jsonb, text[], text) to authenticated;
grant execute on function public.save_salon_store_culture_profile(uuid, public.salon_culture_status, public.salon_culture_respondent_role, integer, jsonb, text[], text) to authenticated;
grant execute on function public.save_salon_culture_analysis_answers(text, jsonb, jsonb) to authenticated;
grant execute on function public.save_salon_store_culture_analysis_answers(uuid, text, jsonb, jsonb) to authenticated;

-- B. 0058 の書き込み検査トリガーを外す（これで旧経路は適用前と同じ挙動に戻る）
drop trigger if exists trg_diagnosis_results_limit on public.diagnosis_results;
drop trigger if exists trg_salon_culture_profiles_limit on public.salon_culture_profiles;
drop trigger if exists trg_salon_store_culture_profiles_limit on public.salon_store_culture_profiles;
drop trigger if exists trg_salon_culture_analysis_limit on public.salon_culture_analysis_answers;

-- C. 0058 の新関数を外す（トリガーを外した後）
drop function if exists public._trg_diagnosis_results_limit();
drop function if exists public._trg_salon_culture_profiles_limit();
drop function if exists public._trg_salon_store_culture_profiles_limit();
drop function if exists public._trg_salon_culture_analysis_limit();
drop function if exists public.commit_diagnosis_result(uuid, uuid, boolean, text, public.diagnosis_mode, jsonb, smallint, smallint, smallint, smallint, smallint, smallint, text, text, smallint, text, uuid, timestamptz);
drop function if exists public.get_diagnosis_change_status(text, uuid);
drop function if exists public.save_salon_culture_draft(uuid, jsonb, integer);
drop function if exists public.discard_salon_culture_draft(uuid);
drop function if exists public.confirm_salon_culture_diagnosis(uuid, uuid, integer);
drop function if exists public._diagnosis_limit_gate(text, uuid, uuid, uuid, boolean, boolean, boolean, text);
drop function if exists public._diag_gate_open(text);
drop function if exists public._diag_gate_close();
drop function if exists public._diag_owner_lock(text, uuid, uuid);

-- D. 巻き戻しの時刻を、状態表のコメントに記録する（再開前チェックが「巻き戻し中の保存」を数えるため。表のデータは変更しない）
do $$
begin
  execute format('comment on table public.diagnosis_change_limits is %L', 'rolled_back_at=' || to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
end $$;

commit;
