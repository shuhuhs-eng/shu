# 本番公開 readiness（Phase 44 → Phase 45 で更新）

販売開始前に確認・設定する項目の一覧。コードで確認できたこと（✅）と、運営側で設定・判断が必要なこと（☐）を分けている。
最終の動作確認は [release-checklist.md](./release-checklist.md) の1枚に集約している。

## 1. 環境変数（コードから洗い出し）

分類：**必須**＝常に必須 ／ **本番必須**＝本番のみ必須（開発は未設定可）／ **任意** ／ **開発用**。
起動時に `instrumentation.ts` が不足を**変数名のみ**ログへ出す（値は出さない。起動は止めない）。サンプルは `.env.example`（秘密値は書かない）。

| 変数 | 分類 | 用途 | 未設定時 |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 必須 | Supabase接続（公開可） | アプリが動かない |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 必須 | Supabase接続（公開可） | アプリが動かない |
| `SUPABASE_SERVICE_ROLE_KEY` | 本番必須 | 未ログイン診断の保存・請求書Storage。サーバー専用。`server-only` でclient importをビルドエラーにしている ✅ | 診断保存・請求書PDF発行が失敗 |
| `NEXT_PUBLIC_SITE_URL` | 本番必須 | 認証メール/再設定のリダイレクト基点。本番は `https://本番ドメイン` | localhost にフォールバック → **認証メールのリンクが壊れる** |
| `CRON_SECRET` | 本番必須 | cron API の認証（長いランダム値） | cronが401（実行不可）。安全側 |
| `ANTHROPIC_API_KEY` | 本番必須（機能） | AI解説。サーバー専用 | AI解説が生成されないだけ |
| `LEGAL_OPERATOR_NAME` | 本番必須 | 規約の運営者名 | 規約は「準備中」表示。**/admin/legal から公開不可** |
| `LEGAL_OPERATOR_ADDRESS` | 本番必須 | 運営者の所在地 | 同上 |
| `LEGAL_CONTACT_EMAIL` | 本番必須 | 問い合わせ先 | 同上 |
| `LEGAL_EFFECTIVE_DATE` | 本番必須 | 施行日 `YYYY-MM-DD` | 同上 |
| `TURNSTILE_SECRET_KEY` / `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | 任意 | bot対策（未実装のプレースホルダー） | 何もしない |
| `NODE_ENV` | 自動 | ホスティングが設定 | — |

## 2. Supabase 本番設定

- ☐ マイグレーション 0001〜0047 を本番へ適用（0048 は無い）。
- ☐ Auth → URL Configuration（下記「3. 認証の本番設定」）。
- ☐ Auth：メール確認を有効、パスワード要件、レート制限を確認。
- ☐ Auth のメール送信：標準のSMTPは送信数に制限があるため、本番は独自SMTP（SPF/DKIM設定）を推奨。
- ☐ Storage：`avatars` `salon-photos` `stylist-evidence` はマイグレーションで作成（private）。`invoice-documents` は初回の請求書発行時にアプリが private で作成（5MB・PDFのみ）。本番で Public が OFF であることを目視確認。
- ☐ バックアップ：Point-in-Time Recovery（有料プラン）。請求書PDF（Storage）は DB バックアップに含まれないため、別途の取得方法を決める。

### 2-1. 運営者（platform_admins）の初期登録 — 調査結果

- ✅ `platform_admins` は RLS 有効・**ポリシー無し**（0021）。anon / authenticated はブラウザ（anon key）から SELECT/INSERT/UPDATE/DELETE できない。一般ユーザーが自分を admin にする経路はコード・DBともに無い（`platform_admins` を書き込むアプリコードは存在しない）。
- ✅ 判定は `is_platform_admin()`（SECURITY DEFINER、search_path固定、anon から revoke）のみ。`/admin/*` の全ページと admin RPC が使う。
- ✅ service role キーはブラウザへ出ない。bootstrap にアプリ側の仕組みは不要。
- 初回登録手順（本番開始時に1回）：運営者本人が通常のアカウントでサインアップ → Supabase ダッシュボードの **SQL Editor**（postgres 権限）で実行：

```sql
insert into public.platform_admins (user_id)
select id from auth.users where email = '運営者のメールアドレス';
-- 確認
select user_id, created_at from public.platform_admins;
```

- 追加・削除も同じく SQL Editor で行う（`delete from public.platform_admins where user_id = '...'`）。**運営者が0人になる状態**を避けるため、削除前に別の運営者を登録しておく。
- ☐ 本番で運営者アカウント（できれば2名以上）を登録し、`/admin` に入れること、一般アカウントでは `/mypage` に戻されることを確認。
- 補足（任意）：多層防御として `revoke all on public.platform_admins from anon, authenticated` を足す案はあるが、RLS＋ポリシー無しで既に拒否されるため 0048 は作っていない。

## 3. 認証の本番設定（Phase 45-C）

- ✅ `localhost` のハードコードは `lib/site-url.ts` のフォールバックのみ。本番で `NEXT_PUBLIC_SITE_URL` が未設定／localhost のとき、起動ログに error を出す。
- ✅ リダイレクト先：新規登録メール `…/auth/callback`、パスワード再設定 `…/auth/callback?next=/update-password`。
- ☐ Supabase Auth → URL Configuration：
  - **Site URL** = `https://本番ドメイン`
  - **Redirect URLs** に `https://本番ドメイン/auth/callback` と `https://本番ドメイン/auth/callback?next=/update-password` を登録（開発用 `http://localhost:3000/**` は本番プロジェクトには入れない）。
- ✅ オープンリダイレクト：`next` は `lib/auth/safe-path.ts` の `safeInternalPath` に統一（`//`、`/\`、制御文字、外部URLを拒否）。ログイン・認証コールバック・同意画面で共通利用。**今回、ログイン画面の `next` が `/\evil` を許していた点を修正**。
- ✅ ミドルウェア：未ログインは `/login?next=`、役割違いは自分のマイページへ、会社レベル／請求系は役割で制限。同意ゲートは fail-closed（確認不能は `/legal/unavailable`）。
- ✅ ログアウト・パスワード再設定は存在有無を漏らさない同一メッセージ。

## 4. cron

- ✅ 期限切れの未ログイン診断の削除：`POST /api/cron/cleanup-pending-diagnoses`（`Authorization: Bearer <CRON_SECRET>`、定数時間比較）。
- ☐ 外部スケジューラ（Vercel Cron 等）の設定が必要（リポジトリに `vercel.json` なし）。
- 期限超過の請求は DB に保存せず画面で導出するため、cron は不要。

## 5. ドメイン・HTTPS・ヘッダ

- ☐ 本番ドメイン、HTTPS、HSTS（ホスティング側）。
- ✅ 基本のセキュリティヘッダ（nosniff / Referrer-Policy / X-Frame-Options / Permissions-Policy）。CSP は影響が大きいため未導入。
- ✅ Cookie：Supabase SSR のセッションCookie。診断の claim token は httpOnly・本番で secure・SameSite=Lax。

## 6. メール

- 請求書メールの自動送信は未実装（販売開始時は Beauty Reach 内で確認・ダウンロード）。
- Auth のメール（確認・再設定）は Supabase 経由。☐ 独自SMTPと日本語テンプレートの確認。

## 7. レート制限（Phase 45-E 監査）

| 入口 | 種別 | 対策 |
|---|---|---|
| `POST /api/diagnosis/guest` | 未ログイン書き込み | IP 30回/時 ✅、ボディ 32KB 上限 ✅（今回追加）、入力は `isValidAnswers` で検証 |
| `POST /api/account-recovery` | 未ログイン・メール送信 | IP 5回/時、メール 3回/24時、ボディ上限 ✅ |
| サインアップ（Server Action） | アカウント作成 | IP 10回/時 ✅（今回追加）＋ Supabase Auth 側の制限 |
| ログイン（Server Action） | 総当たり | IP 30回/10分 ✅（今回追加。サロン店内の共有回線を考慮して緩め）＋ Supabase Auth 側の制限 |
| パスワード再設定 | メール送信 | IP 5回/時 ✅（今回追加。超過時も同一メッセージで存在有無を示さない） |
| サロン文化診断のAI生成 | 有料API | ユーザー単位 5回/時 ✅（今回追加。超過時は生成のみ省略、保存は成功） |
| 診断のAI生成（claim） | 有料API | 1つの診断につき1回（claim は冪等）。アカウント作成数に比例＝サインアップ制限で間接的に抑制 |
| `GET /api/invoices/*/pdf` | 認証済み・RPC権限確認 | 認可RPCが拒否（レート制限は不要と判断） |
| `/api/cron/*` | シークレット認証 | 定数時間比較 |

- ⚠ すべて**インメモリ**（プロセス単位）。サーバーレスの複数インスタンスでは効果が下がる。**販売開始後の改善項目：共有ストア（Redis/Upstash 等）か WAF/基盤側の制限へ移行**。`checkRateLimit` のシグネチャをそのまま差し替えられる。
- 未ログインでDBに書ける入口は guest 診断のみ（`pending_diagnoses`）。期限切れ削除は cron。

## 8. ログ・個人情報（Phase 45-D 監査）

- ✅ `console.log` はアプリ全体で 0 件（認証・ミドルウェア・診断引き継ぎ・AI ジョブのデバッグログ 28 件を削除。user id・パスのログも不要なため削除）。
- ✅ サーバーエラーは `lib/security/log.ts` の `logError(where, error)` に統一：出すのは「場所・エラーコード・200字までのメッセージ」のみ。`PostgrestError` の `details`/`hint`（重複エラーで行の値＝メール・氏名・住所が入り得る）を出さない。テストあり。
- ✅ メール全文・電話・住所・氏名・請求先・口座・Storageパス・トークン・service key・DBの行を出す `console.*` は無いことを全件確認。残る識別子は UUID（storeId / processId / documentId）のみ。
- ✅ 画面・エラーにDBの生エラー・UUID・Storageパスを出さない（日本語の固定文言）。
- ☐ ホスティングのログ保管期間・閲覧権限を決める。☐ エラー監視（Sentry 等）は未導入。導入時は個人情報を送らない設定にする。

## 9. 障害時の画面（Phase 45-F）

- ✅ 追加：`app/error.tsx`（想定外エラー。本文・スタックは出さず、再試行ボタンと digest のみ）、`app/global-error.tsx`（ルート失敗時の最終フォールバック）、`app/not-found.tsx`、`app/admin/loading.tsx`、`app/salon/company/loading.tsx`。
- ✅ 個別の失敗：Supabase/RPC 失敗は各ページが日本語の固定文言か空表示（生エラー無し）／PDF 失敗は平文の日本語メッセージ（404/500）／法的同意の確認失敗は `/legal/unavailable`（再試行・ログアウトあり）／権限なしは `/mypage` へ／存在しないIDは `notFound()`。
- 過剰な追加はしない方針で、全ルートへ loading は付けていない。

## 10. 依存関係・ビルド（Phase 45-I）

- ✅ Next.js 16.4.3。`npm ci` → `npm run typecheck` → `npm run build` → `npm test` が成功。
- ✅ eslint：`eslint-config-next` 16 は ESLint 9 以上のフラット設定が前提で、8.57 固定のため起動しなかった。ESLint 9 へ更新し `eslint.config.mjs` を追加、`npm run lint` が動作（エラー 0。React Compiler 系の `set-state-in-effect` 2 件は警告に降格し、販売開始後に個別整理）。
- ⚠ `npm audit`：
  - **zod 3.x（high, GHSA-mrhx-c7xc-m3w5）**：件数上限つきの巨大コレクションの検証でメモリを消費する DoS。到達性：zod を通る配列入力は `secondaryGoals`(max 2)、`snsLinks`、`valuePriorities`(max 3) など小さな上限つきのフォーム値のみで、Server Action の本文は Next 既定の 1MB 上限、未ログイン API(guest) は zod を使わず 32KB 上限。**悪用は実質困難で、販売開始の blocker とは判定しない**。zod 4 への更新は販売開始後に計画（破壊的変更）。
  - postcss-selector-parser / tailwindcss（moderate）：ビルド時のみ（CSS生成）。実行時に到達しない。blocker ではない。

## 11. 請求書PDFのフォント（デプロイサイズ）

- 原因は日本語フォントではなく、サブセット化ライブラリ（harfbuzz）の読み込みがプロジェクト全体をデプロイ成果物へ含めていたこと。
- ✅ `serverExternalPackages` に `subset-font` `harfbuzzjs` `fontverter`。成果物のファイル数 19,709 → 162、同梱フォントは Regular / Bold の2つ（約11MB）。フォントは Git に入れない（npmパッケージ、SIL OFL）。

## 12. 課金の運用（Phase 45-G：既存機能のみ）

画面で辿れる流れ（新しい状態は作っていない）：

1. 運営者 `/admin/success-fees`：成功報酬を確認 → **請求額確定**（confirmed）→ **請求済み**（invoiced。支払期限を設定）。
2. 運営者 `/admin/issuer-settings` で発行事業者・振込先を登録済み、会社が請求先（`/salon/company/billing-profile`）を登録済みであること。
3. 運営者：**請求書PDF発行**（不足があれば日本語で理由を表示）。
4. 入金状況は画面で導出：請求済み＆支払期限 ≥ 今日（JST）＝**未入金**、期限 < 今日＝**支払期限超過**。運営者が入金確認後に **入金済み**（paid）へ。
5. 会社の owner/admin：`/salon/company/billing`（請求一覧・PDFダウンロード）、`/salon/company/billing-profile`（請求先）、`/salon/company/contract`（契約）。

**未実装のため、何か起きたときの手動運用（暫定）**

- 金額・請求先の誤り（発行後）：発行済み請求書は不変。運営者が会社へ連絡し、現状は DB を直接修正しない。販売開始後に「取消＋再発行」を実装するまでは、**誤りがある請求は未入金のまま会社へ個別連絡し、正しい金額の案内を別途送る**（運営の記録に残す）。発行前（confirmed まで）の誤りは画面から金額を直せる。
- 取消：`invoiced` から `cancel` 操作は可能（画面）。発行済みPDFは残るため、会社へ取消を連絡する。
- 免除：`waive`（画面）。
- 返金：未実装。入金済みの返金は会計処理を運営の手作業（銀行振込＋記録）で行い、システム上は変更しない。
- PDF が出ない：不足項目の案内に従い設定。整合性エラー（SHA-256不一致）は運営者へ連絡のうえ、ストレージとDBの状態を調査（再発行機能は未実装）。
- 期限超過の督促：メール自動送信は未実装。`/admin` の期限超過一覧を見て手動で連絡。

## 13. 法務（Phase 45-H）

- ✅ 0047 適用済み。**公開された版が無い間は同意を求めない**（誰もロックアウトされない）。
- ☐ **公開前に必ず**：(1) `LEGAL_OPERATOR_NAME` `LEGAL_OPERATOR_ADDRESS` `LEGAL_CONTACT_EMAIL` `LEGAL_EFFECTIVE_DATE` を設定して再デプロイ、(2) `/admin/legal` で利用規約・プライバシーポリシーの**正式版を公開**。
- ⚠ **規約・プライバシーの本文は仕様に沿った草案**で、**法的レビュー（弁護士等）は完了していない**。コードは「レビュー済み」とは扱わない。レビュー後に本文を確定し、版を上げて公開する。
- ✅ `/admin/legal` の公開は確認ダイアログを必ず経由：文書名・版・施行日・本文のハッシュ（SHA-256。DBが保存する値と同じ計算）・「公開後は変更・削除できません」を表示。運営者情報が未設定なら公開不可。公開済みの版と本文が食い違うときは警告し、版を上げるまで公開できない。

## 14. 販売開始後に回す項目

- 共有レート制限（Redis/Upstash 等）、WAF
- 請求書のメール送付（外部通知のため事前承認）／督促の自動化
- 発行済み請求書の取消・訂正・再発行（DB設計が必要）
- 返金／取消の会計処理、会計ソフト連携、カード決済（Stripe）
- zod 4 への更新、React Compiler 系 lint 警告の整理
- 退会・個人情報の削除請求の運用手順
- 監視・アラート（期限超過件数、整合性チェック、cron失敗）、エラー監視（Sentry）
- CSP の導入
