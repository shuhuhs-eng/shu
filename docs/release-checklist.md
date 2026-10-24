# リリース前チェックリスト（最終E2E 1枚）

この1枚だけで最終確認を進められる。上から順に実施し、☐ にチェックを入れる。
詳細な背景・設定値は [production-readiness.md](./production-readiness.md)。**本番公開の直前に、必ずこの全項目を完了させる。**

前提：マイグレーション 0001〜0047 を本番 Supabase に適用済み（0048 は無い）。

---

## A. 自動確認（デプロイ前・コマンド）

- ☐ `npm ci`
- ☐ `npm run typecheck` が成功
- ☐ `npm run lint` が成功（エラー 0。警告は既知の 3 件）
- ☐ `npm test` が全件成功（DB不要のスモークテスト 28 件：課金の期限超過導出・請求状態ラベル・法務ゲート・規約スナップショット・採用停止エラー・権限ヘルパー・リダイレクト安全性・レート制限・env検証・ログ安全性）
- ☐ `npm run build` が成功
- ☐ `npm audit`：残りは zod（到達困難）と postcss/tailwind（ビルド時のみ）だけであること（production-readiness §10）
- ☐ デプロイ後のサーバーログに `[env]` の error が出ていない（出ていれば変数名の設定漏れ）

## B. Supabase 確認

- ☐ 本番に 0001〜0047 が適用済み（`supabase migration list` 等で確認）
- ☐ Auth → URL Configuration：Site URL=本番ドメイン、Redirect URLs に `…/auth/callback` と `…/auth/callback?next=/update-password`、localhost は入っていない
- ☐ Auth：メール確認 ON、独自SMTP（SPF/DKIM）、日本語テンプレート
- ☐ Storage：`avatars` `salon-photos` `stylist-evidence` `invoice-documents` がすべて **Public OFF**
- ☐ 環境変数（本番）：Supabase 2 種、`SUPABASE_SERVICE_ROLE_KEY`、`NEXT_PUBLIC_SITE_URL`(https)、`CRON_SECRET`、`ANTHROPIC_API_KEY`、`LEGAL_*` 4 種
- ☐ cron（外部スケジューラ）が `Authorization: Bearer <CRON_SECRET>` で `/api/cron/cleanup-pending-diagnoses` を呼べる（シークレット無しは 401）
- ☐ PITR など DB バックアップ、請求書PDF（Storage）の別途バックアップ方法を決定
- ☐ `platform_admins` に運営者を 2 名以上登録（SQL Editor。手順は production-readiness §2-1）

## C. admin（運営者）確認

- ☐ 運営者アカウントで `/admin` に入れる／一般アカウント・未ログインは入れない（`/mypage`・`/login` へ）
- ☐ `/admin/issuer-settings`：発行事業者名・インボイス登録番号・住所・振込先を登録できる
- ☐ `/admin/success-fees`：絞り込み（請求前／未入金／期限超過／入金済み）が動く
- ☐ 成功報酬 1 件を **請求額確定 → 請求済み（支払期限）→ PDF発行** まで進められる
- ☐ 支払期限を過去にした請求が「支払期限超過」と表示される。入金確認で「入金済み」になる
- ☐ `/admin/integrity`：整合性の異常が 0 件（または説明できる）
- ☐ `/admin/contracts`・`/admin/companies`：会社・契約が見える

## D. salon / company 確認

- ☐ サロン新規登録 → メール確認 → ログイン → オンボーディング → 店舗登録
- ☐ company_owner / company_admin：`/salon/company/billing` で請求一覧が見え、**PDFをダウンロード**できる（ファイル名 `invoice-…pdf`、日本語が文字化けしない）
- ☐ 請求先（`/salon/company/billing-profile`）を登録・更新できる
- ☐ 契約（`/salon/company/contract`）が表示される。採用停止中の店舗では「現在、この店舗では新しい採用活動を受け付けていません」のみ表示（契約状態・金額が出ない）
- ☐ store_manager など店舗レベルの担当者は請求・会社横断画面に入れない
- ☐ 別会社の請求書URLを直接開いても取得できない（404）

## E. stylist（美容師）確認

- ☐ 未ログインで診断 → 結果表示 → 新規登録 → メール確認後に診断結果が引き継がれる（AI解説は付加情報として後から表示）
- ☐ 美容師として登録後、`/stylist/*` に入れ、サロン専用画面（`/salon/*`）へは入れない（逆も同様。1 アカウント 1 役割）
- ☐ パスワード再設定メール → `/update-password` で更新 → ログインできる
- ☐ ログアウトできる

## F. security 確認

- ☐ `/login?next=//evil.example`、`/login?next=/\evil.example` でログインしても外部へ飛ばない（`/` 等の内部に戻る）
- ☐ 未ログインで `/mypage` `/salon/company/billing` `/admin` を開くとログインへ誘導される
- ☐ 請求書PDF URL を未ログイン／他社ユーザーで開くと 401／404
- ☐ ブラウザの開発者ツールで `SUPABASE_SERVICE_ROLE_KEY`・`ANTHROPIC_API_KEY` がバンドル／レスポンスに含まれない（`NEXT_PUBLIC_` 以外が出ていない）
- ☐ ブラウザから `platform_admins` へ自分を追加できない（REST で拒否される）
- ☐ 存在しないURL → 日本語の「ページが見つかりません」。想定外エラー時に生のエラー文・スタックが出ない
- ☐ サーバーログに、メール全文・氏名・住所・口座・Storageパス・トークンが出ていない（認証・請求書発行を一通り操作したあとに確認）
- ☐ 連続でログイン失敗を繰り返すと制限メッセージが出る（IP 30回/10分）

## G. billing 確認

- ☐ 請求書PDF：表紙情報・請求先・金額・税率・消費税・インボイス登録番号・振込先・支払期限が正しい
- ☐ 発行済みPDFをダウンロードして、画面のプレビューと内容が一致（SHA-256整合性エラーが出ない）
- ☐ 不足情報（振込先未登録など）のとき、発行ボタンが日本語の理由を表示し、設定画面へ案内する
- ☐ 旧請求データ（支払期限なし）は「未入金」扱いで、PDF発行不可の理由が出る
- ☐ 手動運用（訂正・取消・返金・督促は未実装）の手順を担当者が把握（production-readiness §12）

## H. legal 確認

- ☐ **法的レビュー（弁護士等）が完了している**（コードでは完了扱いにしない。草案のまま公開しない）
- ☐ `LEGAL_OPERATOR_NAME` `LEGAL_OPERATOR_ADDRESS` `LEGAL_CONTACT_EMAIL` `LEGAL_EFFECTIVE_DATE` を設定して再デプロイ済み
- ☐ `/terms` `/privacy` に運営者情報が表示され、「準備中」が出ていない
- ☐ `/admin/legal` で利用規約・プライバシーの**正式版を公開**（確認ダイアログで文書名・版・施行日・ハッシュ・「公開後は変更不可」を確認してから）
- ☐ 公開後、既存ユーザー（ログイン済み）が次のアクセスで `/legal/accept` に誘導され、同意するまで本体に入れない。同意後に元の画面へ戻る
- ☐ 新規登録ユーザーも同意画面を経由する
- ☐ `/admin/legal` に同意人数が反映される。公開済みの版の本文・ハッシュが閲覧できる
- ☐ （障害時）同意状況を確認できないとき、`/legal/unavailable` に誘導され、再試行・ログアウトができる

---

## 公開直前の最終ゲート（人間の承認）

- ☐ A〜H の全項目が完了
- ☐ 販売開始後に回す項目（production-readiness §14）の担当・時期を合意
- ☐ 公開の承認者が最終確認した
