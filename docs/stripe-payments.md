# Stripe カード決済（Phase 48）運用メモ

> 状態: 未コミット・未適用（0048 は Supabase に未適用）。承認後に反映する。

## 1. 設定（すべてサーバー専用。NEXT_PUBLIC_ に置かない）
| 変数 | 内容 |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_...`（最初は Test Mode のみ） |
| `STRIPE_WEBHOOK_SECRET` | Webhook エンドポイントの `whsec_...` |
| `STRIPE_ALLOW_LIVE_MODE` | live 鍵を使うときだけ `true`（公開前の最終確認が終わるまで設定しない） |

## 2. Stripe ダッシュボード側の準備（Test Mode）
1. Webhook エンドポイント `https://<ドメイン>/api/stripe/webhook` を作成し、次のイベントだけ購読:
   `checkout.session.completed` / `checkout.session.async_payment_succeeded` / `checkout.session.expired` /
   `customer.subscription.created|updated|deleted` / `invoice.paid` / `invoice.payment_failed` /
   `payment_method.detached` / `charge.refunded` / `charge.dispute.created`
2. Customer Portal を有効化（カード変更・請求履歴。解約は運営管理のため原則オフ推奨）。
3. **Stripe Tax・自動税計算は有効化しない**（下の「税ルール」参照。Checkoutは `automatic_tax: {enabled:false}` を明示。商品・Priceに Tax Rate を付けない）。
4. 支払い方法はダッシュボードの動的支払い方法で管理（コードは `payment_method_types` を指定しない）。
5. 特定商取引法に基づく表記・領収書メールの設定。月の自動再試行（Smart Retries）と最終失敗時の動作を決める。
6. ローカル確認: `stripe listen --forward-to localhost:3000/api/stripe/webhook`

## 3. テストカード（Test Mode）
- 成功: `4242 4242 4242 4242` ／ 3DS 常に認証: `4000 0027 6000 3184` ／ 初回のみ認証: `4000 0025 0000 3155`
- 拒否: `4000 0000 0000 0002` ／ 残高不足: `4000 0000 0000 9995`
- 登録は成功するが請求で失敗: `4000 0000 0000 0341`（月額の支払い失敗の確認に使う）
- JCB: `3566 0020 2036 0505`

## 3.5 税ルール（Beauty Reach 全体で統一）
| 項目 | 税抜の正 | 税額・税込の確定 | Stripe へ渡す額 |
| --- | --- | --- | --- |
| 月額利用料 | `organization_contract_settings.monthly_fee`（**税抜**） | DB: `billing_tax_amount(fee, 10.00)` | 税込 `total_amount`（例 10,000 → 11,000） |
| 追加スカウト枠 | `scout_credit_packages.price_excl_tax` ＋ `tax_rate` | DB（購入開始時） | 税込 `total_amount`（例 5,000 → 5,500） |
| 成功報酬 | 既存0045の `hiring_success_fees.fee_amount/tax_rate/tax_amount/total_amount` | 0045が確定済み。**0048は再計算しない** | `hiring_success_fees.total_amount` |
- 税率の既定は 10.00%、1円未満は切り捨て（既存請求ルール `billing_tax_amount`）。browser/client から税額・金額は受け取らない。
- 決済開始時にDBが `stripe_checkout_records` へ `amount_excl_tax/tax_rate/tax_amount/total_amount` をsnapshotし、`expected_amount = total_amount`。サブスクリプション（`organization_subscriptions`）・Scout購入（`scout_credit_purchases`）にも同じsnapshotを残す。後から料金・税率を変えても過去のsnapshotは変わらない。
- **二重課税防止**: Stripe 側は税込の最終額を1本の価格として受け取るだけ。Stripe Tax／Tax Rate／`automatic_tax` を使わない（使うと Stripe が更に10%を加算する）。商品名に「税込」を入れ、Stripe 側のレシート・請求書に税の内訳は出さない。税の内訳の正本は Beauty Reach の請求書／画面（税抜・消費税・税込）。インボイス制度上のStripe発行書類の扱いは運用で別途確認すること。
- **契約の月額が変更された場合**: 既存 Subscription の金額は自動変更しない。管理画面に「契約の月額（税抜）とカード課金の税抜額が一致しない」を表示（`monthly_amount_mismatch`）。Stripe 上の請求額が決済時の税込額と違う場合は `stripe_amount_mismatch` と integrity issue を記録。将来「次回更新から新料金適用」を実装できるよう、snapshot（税抜/税込）と Stripe 実額（`stripe_total_amount`）を別列で保持している。
- **Scout creditの価格は未決定**: migration は商品を1件も作らない。運営が `/admin/stripe` から（件数・税抜価格・税率・有効）を設定するまで、会社側は「追加スカウト枠は現在販売していません」と表示される。

## 4. 設計の要点
- 決済の正は webhook。success URL に戻っただけでは何も確定しない。
- 金額は DB（`begin_*` RPC）が確定し、webhook で Stripe の実額・DB の確定額・期待額の三者一致を確認。不一致は paid にせず `stripe_integrity_issues` に記録。
- 決済状態（pending/active/past_due/payment_failed/cancelled）は契約状態（contract_status）と分離。Stripe の状態で契約を停止・変更しない。
- カード番号・CVC・有効期限は DB・ログに保存しない。表示用のブランド/下4桁/有効期限は画面表示のたびに Stripe API から取得。
- 銀行振込・admin の「入金済み」操作は従来どおり。

## 5. Test → Live 切替時
Test Mode で作成した Customer/Subscription は Live で使えない。`organization_payment_accounts` 等の Test 行を初期化してから Live 鍵に切り替える（`livemode` 列で取り違えは検知される）。
