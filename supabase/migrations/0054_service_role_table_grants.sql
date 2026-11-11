-- ============================================================================
-- 0054: service_role に必要最小限のテーブル／関数権限を明示付与（本番障害対応）
-- ============================================================================
-- 背景: Supabaseは2026-05-30以降の新規プロジェクトで、publicの新規テーブルへ
--   anon / authenticated / service_role の既定GRANTを付けない。service_roleはRLSを
--   バイパスするがテーブルGRANTはバイパスしないため、サーバー（service role）からの
--   直接INSERT等が 42501 permission denied になる（POST /api/diagnosis/guest が500）。
--
-- 方針: ALTER DEFAULT PRIVILEGES は使わない。ALL TABLES IN SCHEMA も使わない。
--   アプリが service role で実際に使うオブジェクトだけを明示する（付与のみ・冪等・データ変更なし）。
--
--   pending_diagnoses         : ゲスト診断の保存（guest route）／claim／cron削除
--   account_recovery_requests : アカウント復旧の問い合わせINSERT
--   diagnosis_results         : サーバー側INSERT（ログイン済み保存・claim）。UPDATE/DELETEは付与しない
--   cleanup_expired_pending_diagnoses() : 日次cron（service_role専用）
--
-- 0001〜0053 は変更しない。
-- ============================================================================

begin;

grant select, insert, update, delete on table public.pending_diagnoses to service_role;
grant select, insert, update, delete on table public.account_recovery_requests to service_role;
grant select, insert on table public.diagnosis_results to service_role;

grant execute on function public.cleanup_expired_pending_diagnoses() to service_role;

commit;
