# Phase 50: Stripe月額 → 支払履歴 → 適格請求書PDF → 会社ダウンロード

前提：0001〜0049 は適用済み・変更禁止。Phase 50 では新しいmigrationを作っていない。

## 1. 処理の流れ
1. Stripe `invoice.paid` を受信（署名検証・claim済み。冪等）。
2. 通知本文ではなく Stripe から **最新の Subscription と Invoice（payments展開）** を取得し、`paid`・同じ customer・同じ subscription を検証。
3. `record_subscription_invoice_payment`（0049）で支払事実を記録。DBが「Stripe支払額＝0048の決済時tax snapshotの税込額」「通貨JPY」を検証し、不一致は記録せず `stripe_integrity_issues`。**ここで失敗（例外）したら500＝Stripeが再送。**
4. 記録が `recorded`/`already_recorded` のときだけ PDF 発行を試みる。**PDFの失敗は握りつぶし、支払記録はそのまま・webhookは200。** 再送（already_recorded）でも発行を再試行する。
5. PDF発行：`service_prepare_subscription_invoice`（条件確認＋固定snapshot）→ snapshotだけから生成 → SHA-256 → private bucketへupload → `service_register_subscription_invoice`（DBがsnapshotを再計算しdigest一致のときだけ登録）。登録に失敗したらuploadを削除（記録済みか再確認してから）。
6. 条件不足（発行事業者名/登録番号/住所・請求先名が未登録）のときは発行せず「条件不足」。設定後に運営が再試行。

## 2. Storage
- 既存の private bucket `invoice-documents` を再利用（公開URL・署名URLなし）。
- DB（0049・変更不可）の `storage_path` は `invoices/<組織ID>/<請求書番号>.pdf` の論理パス。**Storage上の実キーだけを `subscription-invoices/<組織ID>/<請求書番号>.pdf` に変換**（`lib/invoices/subscription-path.ts`。アップロード・ダウンロードは必ずこの関数を通す）。成功報酬の `invoices/…` とは物理的に分離され、請求書番号も同一カウンタ由来で衝突しない。
- ダウンロード：ログイン → `authorize_subscription_invoice_download`（権限＋監査）→ Storage取得 → SHA-256照合 → bytes返却。`storage_path` は会社に返さない。

## 3. 画面
- 会社 `/salon/company/billing`：「月額のお支払い履歴」（対象期間・支払日・税抜・税率・消費税・合計・カード決済済み・適格請求書ダウンロード）。PDFが無いときは「請求書を準備中です」（支払後30分以内）／「請求書を現在準備しています」。発行条件の不足などの内部事情は出さない。
- Stripeポータルのボタンは「Stripeでカード情報・決済履歴を確認」、Beauty Reach側は「適格請求書をダウンロード」。画面にも「Stripeの領収・明細は決済サービスの利用明細で、適格請求書ではない」と明記。
- 運営 `/admin/stripe`：「月額決済履歴と請求書PDF」。状態＝PDF発行済み／発行条件不足（不足項目を日本語で表示）／発行処理中／発行失敗（再試行してください）。1件ごとの再試行と「未発行をまとめて再試行」。

## 4. 失敗からの回復
- 失敗の理由はDBに保存していない（0049に記録先が無い）。「未発行・不足なし・30分経過」を“発行失敗の可能性”として表示し、再試行で回復する。理由はサーバーログ（`stripeWebhook: subscription invoice pdf not issued`）。
- 自動再試行（cron）は未実装。Stripe側でinvoiceが再送されると自動で再試行される。

## 5. Stripe自動メールの扱い（Test Modeで実物を確認する）
- Stripeが顧客へ送る領収・invoiceメールは「決済サービス側の利用明細・領収情報」。Beauty Reachは適格請求書として案内しない（画面・本書で役割を分離）。Beauty Reach側からの月額請求書メールはまだ送らない。
- Test Modeで、実際に届くメール（決済成功の領収、invoice関連）の件名・本文・金額表記（税込1本の価格）を確認し、「請求書」と誤認させる文言があれば本番設定時に Stripe ダッシュボード（設定 → 請求 → サブスクリプションとメール／顧客向けメール）で不要なものを無効化する。画面名は変更されることがあるため、実画面で確認すること。

## 6. 最終一括E2E（Test Mode・Stripe鍵が揃ってから）
手順の前提・環境変数・webhook・テストカードは `docs/phase49-invoice-and-stripe-test-mode.md` F節。確認項目：
1. カード登録（成功カード）→ カード表示。
2. 月額Subscription開始 → Stripe金額が税込（10,000円契約→11,000円）。
3. 3DS（4000 0027 6000 3184）で認証完了／認証失敗。
4. `invoice.paid` 受信 → webhook配信ログ200。
5. `subscription_invoice_payments` に1行（税抜10,000／税率10／税1,000／税込11,000／BR番号）。
6. PDF自動発行（`subscription_invoice_documents` に1行・Storageに `subscription-invoices/…`）。
7. 会社ownerでダウンロード（PDF内容：登録番号・請求先・対象期間・税内訳・カード決済済み、振込先なし）。他社ユーザー・美容師は404。
8. Stripeポータル（カード変更・履歴）。
9. 支払い失敗（4000 0000 0000 0341）→ past_due/payment_failed 表示、請求書は作られない。
10. webhookリプレイ（同一イベント再送）→ 支払行・BR番号・PDFが増えない。
追加：発行事業者の登録番号を一時的に未設定にして支払い → 運営画面に「発行条件不足」→ 設定後に再試行で発行。

## 7. 本番デプロイの順序
0049をSupabaseへ適用済みであることを確認 → このコードをデプロイ（先にコードだけ出すと `record_subscription_invoice_payment` が無く invoice.paid が500になる）。Vercelでは `/api/stripe/webhook` にフォントが同梱される設定（next.config.mjs）を確認。

## 8. 次のmigration候補（返金・取消対応。今回は実装しない）
- 返金/取消の記録テーブル（Stripe refund/credit note、対象 `subscription_invoice_payments`、返金額・税額内訳・日時）。0048の `charge.refunded`／dispute は現状 integrity issue 記録のみ。
- 適格返還請求書（消費税法57条の4第3項）の発行：返還請求書用のドキュメントテーブル・番号体系（BR採番の共用可否）・PDFレイアウト・元の請求書との紐付け。
- PDF発行の試行ログ（失敗理由・回数・最終試行時刻）と自動再試行（cron）。
- 契約月額変更時の「次回更新から新料金適用」（0048の snapshot/`stripe_total_amount` を前提に明示操作で実装）。
- 返金で `organization_subscriptions` の状態やScout枠をどう扱うかの方針決定。
