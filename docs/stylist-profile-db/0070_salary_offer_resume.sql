-- ============================================================================
-- 給与条件の新規提示を再開する（0070で入れたDB停止を解除）。【承認後にのみ実行】
-- 誤実行防止: 下の set_config の行を、再開すると決めたときだけコメント解除して一緒に実行する。
-- 再停止: 0070_salary_offer_pause.sql
-- ※アプリ側の停止（環境変数 SALARY_OFFER_PRESENTATION_PAUSED）も別途解除が必要。
-- ============================================================================
begin;
-- select set_config('app.confirm_salary_offer_resume', 'yes', true);
do $$
begin
  if coalesce(current_setting('app.confirm_salary_offer_resume', true), '') <> 'yes' then
    raise exception '再開は未確認です。承認のうえ、ファイル冒頭の set_config の行のコメントを外して実行してください';
  end if;
end $$;
update public.feature_pauses set paused = false, reason = '運営の承認により再開', updated_at = now()
 where feature = 'salary_offer_presentation';
commit;
