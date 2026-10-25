# Phase 49: 月額カード決済の適格請求書方針 / Stripe Test Mode 接続手順

> 本書は設計提案であり税務・法律の助言ではない。運用開始前に税理士へ最終確認すること。

## A. 現状の構造（調査結果）
| 対象 | 現状 |
| --- | --- |
| 発行事業者 `billing_issuer_settings`（0046） | 全体1行。名称・登録番号(T+13桁)・住所・振込先。発行時にsnapshot。 |
| 請求先 `organization_billing_profiles`（0046） | 会社ごとの正式名称・住所。表示名 `salon_organizations.name` とは別。 |
| 請求書番号（0045） | `BR-YYYY-NNNNNN` 全社共通カウンタ `allocate_invoice_number`。 |
| `invoice_documents`（0046） | **成功報酬専用**（`success_fee_id` と1:1、トリガーも成功報酬の状態に固定、振込先必須）。 |
| 月額（0048） | `organization_subscriptions` に決済時のtax snapshot（税抜/税率/税額/税込）。Stripe invoice.paid は「最終成功日時」を更新するだけで、請求単位の履歴・請求書は無い。 |

→ 月額は「Stripe invoice 1件＝1取引」で成功報酬と取引単位が違う。`invoice_documents` を流用すると、fee固定のトリガー・一意制約・保存パス・振込先必須と衝突するため**別テーブルに分離**した。

## B. 適格請求書の要件（消費税法57条の4）との対応
必要記載事項：①発行事業者の名称と登録番号 ②取引年月日 ③取引内容 ④税率ごとに区分した対価の額と適用税率 ⑤税率ごとの消費税額 ⑥交付を受ける事業者の名称（簡易適格請求書は不可：B2Bのため通常の適格請求書）。電子データでの交付・保存も可。

| 要件 | 月額請求書のsnapshot項目 |
| --- | --- |
| 発行事業者名・登録番号 | `issuer_snapshot.legal_name / invoice_registration_number`（0046設定を発行時にコピー） |
| 取引年月日 | `transaction_date`（役務提供開始日）＋ `service_period_start/end`（対象期間）＋ `invoice_date`（決済日, JST） |
| 取引内容 | `line_items`：Beauty Reach 月額利用料 |
| 税抜額・税率・消費税額・税込額 | 決済時snapshot（`amount_excl_tax / tax_rate / tax_amount / total_amount`, `tax_breakdown`） |
| 請求先名 | `recipient_snapshot.legal_name`（請求先情報） |
| 支払方法・参照 | `payment.method=credit_card, status=paid, stripe_invoice_id, stripe_payment_intent_id` |

## C. 独自PDF か Stripe invoice か — 提案
**提案：Beauty Reach独自の適格請求書PDFを正本とし、Stripe invoice/領収は補助資料とする。**

| 観点 | Beauty Reach独自PDF（推奨） | Stripe invoiceを正本にする |
| --- | --- | --- |
| 税の内訳 | DBのtax snapshotをそのまま表示。成功報酬と同じ番号体系・体裁 | 本システムはStripe Tax/Tax Rateを**使わない**（二重課税防止・税込1本の価格）ため、Stripe側の請求書は税率別の内訳を持たない → 単体では要件を満たさない可能性が高い |
| 登録番号・請求先 | 0046の設定を使用。会社が自分で請求先情報を管理 | Stripe側のTax ID/顧客情報を別途同期・維持する必要 |
| 番号・保存・監査 | BR-連番、SHA-256、追記専用、ダウンロード監査 | Stripeの番号体系（別系統）になり、請求書の一元管理ができない |
| 手間 | PDF生成コードが必要（成功報酬で実績あり：`lib/invoices`） | 少ないが上記の欠点 |
| 将来の自由度 | Stripeに依存しない（他決済・乗換え可） | Stripeロックイン |

- 代替案（採用しない）：Stripe Tax/Tax Rateを導入しStripe invoiceを適格請求書にする。→ Phase 48で「DB確定の税込額が最終額。Stripeで税を加算しない」と決めたため、方針転換が必要になり、金額の正が2か所になる。
- Stripe送付の領収メール／invoice PDF は「決済の確認資料」。請求書として顧客に案内せず、必要なら**Stripe側の自動メールをオフ**にして紛らわしさを避ける（顧客に届く請求書はBeauty Reachのものだけにする）。この運用は税理士確認事項。
- 発行タイミング：**invoice.paid 受信 → 金額検証 → 支払履歴に記録（請求書番号採番）→ PDFを自動生成・保存**。発行事業者/請求先が未設定ならPDFだけ保留（支払履歴と番号は確定済み）、運営画面に未発行一覧を出し、設定後に再実行。
- 書面名は「請求書（クレジットカード決済済み）」とし、振込先は載せない。領収書の別発行は不要（カード明細が証憑）だが、顧客要望があれば同じsnapshotから「領収書」表示を追加できる。

## D. 0049 で作ったもの（ローカル適用・テスト済み。Supabase未適用）
- `subscription_invoice_payments`：Stripe invoice 1件＝1行の支払履歴（追記専用）。税snapshot・請求書番号・対象期間・Stripe参照。
- `subscription_invoice_documents`：発行PDFのmetadata＋issuer/recipient/content snapshot＋SHA-256（発行後は変更・削除不可）。`subscription_invoice_document_events`：発行・ダウンロード監査。
- `record_subscription_invoice_payment`（service_role）：Stripe支払額＝0048のtax snapshot税込額のときだけ記録。不一致（税の二重加算 12,100 等）・通貨違い・snapshot無しは記録せず `stripe_integrity_issues`。同一invoiceの再送／並行送信は1行・同一番号で冪等。番号は成功報酬と同じカウンタ（BR-YYYY-NNNNNN）。
- 発行：自動（`service_prepare/register_subscription_invoice`、service_role）と手動・再試行（`prepare/register_subscription_invoice_document`、platform admin）。digest照合で「PDFに載った内容＝保存snapshot」を保証。振込先は不要。
- 閲覧：会社（company_owner/admin）は自社の履歴のみ・Stripe参照は返さない。運営は全体＋未発行一覧。ダウンロードは `authorize_subscription_invoice_download` を必ず通す。
- 0001〜0048は未変更。

## E. 次Phase（実装）に残るもの / 未解決
1. webhook：`invoice.paid` で `record_subscription_invoice_payment` を呼ぶ（invoice.id・`amount_paid`・currency・`lines.data[0].period`・`status_transitions.paid_at`・payment intent を渡す）。呼ぶ前に0049をSupabaseへ適用すること（順序厳守）。
2. PDF生成：`lib/invoices` のレンダラーを月額用レイアウトに拡張、private bucketへ保存、会社の請求画面に「月額の支払履歴」と請求書ダウンロードを追加。
3. 返金・取消：Stripe側で返金/解約返金された場合の「適格返還請求書」（消費税法57条の4第3項）は未対応（0048は返金を integrity issue 記録のみ）。発生時の運用を決める必要あり。
4. 保存：電子保存要件（7年）に合わせたStorage保持・バックアップ方針。
5. 税理士確認：Stripe自動メールの扱い、取引年月日を「期間」で表記する形式、請求書兼領収の体裁。

---

## F. Stripe Test Mode 実接続の最終手順
**前提**：0048をSupabase適用済み（済）。0049は未適用で、月額請求書を使うPhaseまで不要。本番(Live)は使わない（`STRIPE_ALLOW_LIVE_MODE` は設定しない）。

1. **キー取得**：Stripeダッシュボードを「テスト環境」にし、開発者 → APIキー → **シークレットキー `sk_test_…`**（または制限付きキー `rk_test_…`）を取得。
2. **環境変数**（サーバーのみ。`NEXT_PUBLIC_` にしない）：`STRIPE_SECRET_KEY=sk_test_…` / `STRIPE_WEBHOOK_SECRET=whsec_…`（手順4で取得）/ `NEXT_PUBLIC_SITE_URL`（Checkout復帰先）。Vercel等のPreview/Productionで値を分け、Test用はPreviewのみに置く。
3. **webhookエンドポイント作成**（テスト環境）：URL `https://<ドメイン>/api/stripe/webhook`、API version はSDK既定（2026-09-30.endive）。購読イベントは次の11個**だけ**：
   `checkout.session.completed` / `checkout.session.async_payment_succeeded` / `checkout.session.expired` / `customer.subscription.created` / `customer.subscription.updated` / `customer.subscription.deleted` / `invoice.paid` / `invoice.payment_failed` / `payment_method.detached` / `charge.refunded` / `charge.dispute.created`
4. **署名シークレット**：作成したエンドポイントの「署名シークレット `whsec_…`」を `STRIPE_WEBHOOK_SECRET` に設定して再デプロイ。ローカル確認は `stripe listen --forward-to localhost:3000/api/stripe/webhook` が表示する `whsec_…` を `.env.local` に設定。
5. **Customer Portal**（テスト環境の設定 → Billing → カスタマーポータル）：支払い方法の更新＝オン、請求履歴の表示＝オン、サブスクリプションのキャンセル／プラン変更＝**オフ**（契約は運営管理）。ポータルのビジネス情報・利用規約リンクを設定。
6. **税設定の確認**：Stripe Tax／自動税計算を**有効にしない**。商品・Priceに税率を付けない（コードは `automatic_tax: false` を明示済み）。
7. **接続確認（順に実施）**：
   1. 運営が会社の契約を有効・月額を設定 → 会社ownerで請求画面を開く。
   2. 「カードを登録」→ 成功カード → 戻り後にカードのブランド/下4桁が表示される。
   3. 「月額をカードで自動課金」→ Stripe上の金額が**税込**（例 10,000円契約なら11,000円）であること、DBの `organization_subscriptions` のsnapshotと一致すること。
   4. 成功報酬のカード払い（請求済みfee）→ 金額＝請求書の税込額、webhook後に paid。
   5. 追加スカウト枠は、運営が商品を作成・有効化した後に購入 → 決済確認後にだけ枠が増える。
   6. ダッシュボードのwebhook配信ログで全イベントが200、`/admin/stripe` の「要対応」が0件。
8. **テストカード**
   | 目的 | 番号 |
   | --- | --- |
   | 成功 | 4242 4242 4242 4242 |
   | 3DS 常に認証要求 | 4000 0027 6000 3184 |
   | 3DS 初回のみ（以後は不要） | 4000 0025 0000 3155 |
   | 3DS認証が失敗するケース | 3DSの認証画面で「認証を失敗させる」を選択（4000 0027 6000 3184 で再現） |
   | カード拒否 | 4000 0000 0000 0002 |
   | 残高不足 | 4000 0000 0000 9995 |
   | 登録は成功するが請求で失敗 | 4000 0000 0000 0341（月額の支払い失敗の確認） |
   有効期限は未来の任意、CVCは任意3桁、郵便番号は任意。
9. **3DSテスト**：4000 0027 6000 3184 で月額開始 → 認証画面で「認証を完了」→ 成功し active。もう一度「認証を失敗」→ 登録/課金が成立せず契約・枠は変化しない。
10. **失敗系テスト**：
    - 月額の支払い失敗：4000 0000 0000 0341 で開始 → 初回は成功、次回請求を再現（テスト時計 / `stripe trigger invoice.payment_failed`）→ `past_due`/`payment_failed` 表示、契約状態(contract_status)は変わらない。
    - 戻り値だけでは確定しない：success URLを手で開いても paid にならない（webhookのみが確定）。
    - webhook再送：ダッシュボードから同一イベントを再送 → 二重加算・二重paidにならない。
    - 署名不正：署名ヘッダなし／別secretで POST → 400、DB変化なし。
    - 金額改ざん：Stripe側でSubscriptionの金額を変更 → 管理画面に `stripe_amount_mismatch`、自動修正はされない。
    - 期限切れ：Checkoutを開いて放置 → `checkout.session.expired` で失効扱い。
11. **Live切替**（今回は行わない）：Test行を初期化 → Live用キー/endpoint/Portalを別途作成 → `STRIPE_ALLOW_LIVE_MODE=true` を明示的に設定。税理士確認（上記E-5）と0049適用・請求書PDFの動作確認が完了してから。
