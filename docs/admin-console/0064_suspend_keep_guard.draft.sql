-- 0064 の【停止（記録と二重請求防止を残す）】（草案）。運用開始後に問題が出たときの第一手段。
-- 切替の記録・案件ごとの判定・二重請求防止のトリガー・内部関数は一切変えない（旧成功報酬と新採用料の相互の抑止、月額の拒否はそのまま働く）。
-- 止めるのは「新しい切替の操作」だけ（会社の切替・案件の判定を運営画面から実行する関数の実行権限を外す）。読み取りの状況確認は残す。
-- 復旧は 0064_resume.draft.sql。0064そのものを外す 0064_rollback は、切替の記録や有効な新採用料があると自分で中止する。
begin;
revoke execute on function public.admin_set_billing_regime(uuid, timestamptz), public.admin_set_process_billing_basis(uuid, text, text)
  from public, anon, authenticated, service_role;
commit;
