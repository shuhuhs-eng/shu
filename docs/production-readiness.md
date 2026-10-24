# 本番公開 readiness（Phase 44 調査）

販売開始前に確認・設定する項目の一覧。コードで確認できたこと（✅）と、運営側で設定・判断が必要なこと（☐）を分けている。

## 1. 環境変数

| 変数 | 用途 | 備考 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase接続（公開可） | ☐ 本番プロジェクトの値 |
| `SUPABASE_SERVICE_ROLE_KEY` | サーバー専用（請求書Storage・未ログイン診断・cron） | ☐ 厳重管理。`server-only` で client import をビルドエラーにしている ✅ |
| `ANTHROPIC_API_KEY` | AI解説（サーバー専用） | ☐ 未設定でもAI解説がスキップされるだけ |
| `CRON_SECRET` | cron API の認証 | ☐ 長いランダム値 |
| `NEXT_PUBLIC_SITE_URL` | 認証メールのリダイレクト基点 | ☐ 本番は必須（未設定は localhost にフォールバック） |
| `LEGAL_OPERATOR_NAME` / `LEGAL_OPERATOR_ADDRESS` / `LEGAL_CONTACT_EMAIL` / `LEGAL_EFFECTIVE_DATE` | /terms・/privacy の運営者情報 | ☐ 未設定は「準備中」表示。公開前に必須 |
| `TURNSTILE_SECRET_KEY` | bot対策（未実装のプレースホルダー） | 任意 |

## 2. Supabase 本番設定

- ☐ マイグレーション 0001〜0046（＋承認後の 0047）を本番へ適用。
- ☐ Auth：Site URL と Redirect URLs に本番ドメイン（`/auth/callback`、パスワード再設定先）を登録。
- ☐ Auth：メール確認を有効、パスワード要件、レート制限を確認。
- ☐ Auth のメール送信：標準のSMTPは送信数に制限があるため、本番は独自SMTP（送信ドメインのSPF/DKIM設定）を推奨。
- ☐ Storage：`avatars` `salon-photos` `stylist-evidence` はマイグレーションで作成（private）。`invoice-documents` は初回の請求書発行時にアプリが private で作成（5MB・PDFのみ）。本番で Public が OFF であることを目視確認。
- ☐ バックアップ：Point-in-Time Recovery（有料プラン）を有効化。請求書PDF（Storage）は DB バックアップに含まれないため、別途の取得方法を決める。
- ☐ `platform_admins` の初期登録（運営者のauth user idをSQLで1回登録する。UIからは作れない設計）。運営者の追加・削除の手順を決める。

## 3. cron

- ✅ 期限切れの未ログイン診断の削除：`POST /api/cron/cleanup-pending-diagnoses`（`Authorization: Bearer <CRON_SECRET>`、定数時間比較）。
- ☐ 外部スケジューラ（Vercel Cron 等）の設定が必要（リポジトリに `vercel.json` なし）。pg_cron が使えるなら DB 側で直接でも可。
- 期限超過の請求は DB に保存せず画面で導出するため、cron は不要。

## 4. ドメイン・HTTPS・ヘッダ

- ☐ 本番ドメイン、HTTPS（ホスティング側で提供）。HSTSはホスティング側で設定。
- ✅ 基本のセキュリティヘッダ（nosniff / Referrer-Policy / X-Frame-Options / Permissions-Policy）を `next.config.mjs` に追加。CSP は影響が大きいため未導入（公開前の検証で検討）。
- ✅ Cookie：Supabase SSR のセッションCookie。診断の claim token は httpOnly・本番で secure・SameSite=Lax。

## 5. メール

- 請求書メールの自動送信は未実装（販売開始時は Beauty Reach 内で確認・ダウンロード）。
- Auth のメール（確認・再設定）は Supabase 経由。☐ 独自SMTPの設定と文面（日本語テンプレート）の確認。

## 6. レート制限

- ✅ 問い合わせ(account-recovery)と未ログイン診断(guest)にIP単位の制限あり。
- ⚠ 実装は**インメモリ**（プロセス単位）。サーバーレスで複数インスタンスになると効果が下がる。☐ 本番は共有ストア（Redis/Upstash 等）または基盤側（WAF）での制限を検討。
- ☐ ログイン・サインアップは Supabase Auth 側のレート制限に依存。

## 7. ログ・個人情報

- ✅ メールアドレス全文はログに出さない（account-recovery は maskEmail）。ミドルウェアのログは内部のuser id（メール・氏名なし）。
- ⚠ `console.log` が認証フローに残っている（user id・パス）。本番のログ保管期間・閲覧権限を決める。必要なら削減。
- ✅ 画面・エラーにDBの生エラー・UUID・Storageパスを出さない（日本語の固定文言に変換）。
- ☐ エラー監視（Sentry 等）は未導入。導入時は個人情報（メール・氏名・請求先）を送らない設定にする。

## 8. 依存関係・ビルド

- ✅ `npm ci` → `npm run typecheck` → `npm run build` が、クリーンコピーで成功。
- ✅ Next.js を 16.3.5 → 16.4.3 に更新（`npm audit` の critical を解消）。
- ⚠ 残る `npm audit`：`zod`（3.x。巨大な配列の検証でメモリを消費するDoS。4.x は破壊的変更のため未更新）。入力はすべて文字数・件数に上限があるが、zod 4 への更新を計画する。
- ✅ eslint 設定は既存で壊れている（`npx eslint` が起動しない）。typecheck と build で機械検証している。☐ eslint 設定の修復は別途。

## 9. 請求書PDFのフォント（デプロイサイズ）

- 原因は日本語フォントではなく、サブセット化ライブラリ（harfbuzz）の読み込みがプロジェクト全体をデプロイ成果物へ含めていたこと。
- ✅ `serverExternalPackages` に `subset-font` `harfbuzzjs` `fontverter` を指定。成果物のファイル数 19,709 → 162、同梱フォントは Regular / Bold の2つ（約11MB）に。
- ✅ PDFの描画はサブセット化後に再確認（日本語の字形・レイアウト）。フォントのファイルはGitに入れない（npmパッケージ、SIL OFL）。

## 10. 販売開始後に回す項目

- 請求書のメール送付（外部通知のため事前承認）／督促
- 発行済み請求書の取消・訂正・再発行（DB設計が必要。発行済みは不変のまま、取消＋再発行の関係を持たせる）
- 返金／取消の会計処理、会計ソフト連携、カード決済（Stripe）
- 退会・個人情報の削除請求の運用手順（請求書など保存義務のある情報の扱い）
- 監視・アラート（期限超過件数、整合性チェックの異常、cron失敗）
