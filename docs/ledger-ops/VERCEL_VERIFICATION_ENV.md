# 既存Vercel検証環境の再利用（本番ブランチへのpush禁止）
方針: 新しい環境は作らず、既存のVercel検証（Preview）環境に検証専用ブランチをデプロイする。
1. ブランチ: `verify/scout-ledger-0116-0121`（本番ブランチ＝Production Branch は絶対に使わない）。
2. Vercel › Settings › Environment Variables は **Preview のみ**に設定（Production には入れない）:
   NEXT_PUBLIC_SUPABASE_URL=https://yegjxkstxhwrknshlaip.supabase.co、対応する anon / service_role キー、
   STRIPE_SECRET_KEY(sk_test_)、STRIPE_WEBHOOK_SECRET(検証用エンドポイントのwhsec)、NEXT_PUBLIC_SITE_URL(PreviewのURL)、CRON_SECRET、
   SCOUT_LEDGER_ENABLED=1、SALON_ACCOUNT_ISSUE_ENABLED=1、MANUAL_BILLING_ENABLED=1、Turnstileテストキー。
   ※既存Preview変数が別プロジェクトを指していないか先に確認。Branch指定で当該ブランチだけに限定すると安全。
3. Supabase Redirect URLs に `<PreviewのURL>/auth/callback` を追加。
4. Stripe（テストモード）: ダッシュボードで `<PreviewのURL>/api/stripe/webhook` を検証用エンドポイントとして登録。
5. Cron: VercelのCronはProductionのみ実行される。Previewでは手動実行（`curl -H "Authorization: Bearer $CRON_SECRET" <Preview>/api/cron/scout-expiry`）。
6. 注意: Preview URLはデプロイごとに変わる場合がある。固定のブランチURLを使い、Redirect URL/Webhookもそれに合わせる。Vercel Deployment Protectionが有効なら検証者のログインが必要。
7. 確認: デプロイ後 `scripts/verify-env/preflight.mjs` 相当の確認（接続先が検証プロジェクトか）をPreview変数の目視で行い、VERIFICATION_RUNBOOK.md へ進む。
