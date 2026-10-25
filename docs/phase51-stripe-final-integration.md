# Phase 51: Stripe 最終統合（Test Mode 接続の準備と確認手順）

> 税務・法律の助言ではない。販売開始前に税理士へ確認すること。

## 1. 人間が設定する3つの値（これだけ）
| 変数 | 値 |
| --- | --- |
| `STRIPE_SECRET_KEY` | `sk_test_…`（または `rk_test_…`）。サーバー専用 |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…`（手順3で得る署名シークレット） |
| `NEXT_PUBLIC_SITE_URL` | `https://<ドメイン>`（Checkout復帰先） |

`STRIPE_ALLOW_LIVE_MODE` は**設定しない**。設定後は読み取り専用チェッカーで確認：
```
set -a; source .env.local; set +a; npm run verify:stripe
```
env・webhook購読11イベント・Customer Portal設定・Stripe Taxを確認（Stripe側は変更せず、秘密値も出力しない）。

## 2. Stripe側の設定（Test環境）
- Customer Portal：支払い方法の更新 ON／請求履歴 ON／プラン変更 OFF／サブスク解約 OFF
- Stripe Tax：OFF（税はBeauty Reach DBが確定。コードは `automatic_tax=false` を明示）
- 商品・Priceに税率を付けない

## 3. Webhook（`/api/stripe/webhook`、署名検証必須）
購読は次の11イベントだけ：`checkout.session.completed` / `checkout.session.async_payment_succeeded` / `checkout.session.expired` / `customer.subscription.created` / `customer.subscription.updated` / `customer.subscription.deleted` / `invoice.paid` / `invoice.payment_failed` / `payment_method.detached` / `charge.refunded` / `charge.dispute.created`

**Stripe CLI（ローカル）**
```
stripe login
stripe listen --forward-to localhost:3000/api/stripe/webhook \
  --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.expired,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed,payment_method.detached,charge.refunded,charge.dispute.created
# 表示された whsec_… を STRIPE_WEBHOOK_SECRET に設定
```
**Dashboard**：開発者 → Webhooks → エンドポイント追加 → URL と上記11イベント → 署名シークレットを `STRIPE_WEBHOOK_SECRET` へ。

注意：`stripe trigger` のフィクスチャはBeauty Reachのmetadataを持たないため `not_monthly_subscription` として無視される。月額の検証は実際のCheckout経由で行う。「翌月の継続invoice」は、Checkout完了後に
`stripe subscriptions update <sub_id> --billing_cycle_anchor=now --proration_behavior=none` で次回請求を即時発生させて再現する。

## 4. Test Mode E2E チェックリスト（18項目）
| # | 項目 | 期待結果 |
| --- | --- | --- |
| 1 | Customer作成 | 請求画面から初回操作でCustomerが1件だけ作られる |
| 2 | カード登録（4242…） | ブランド／下4桁が表示（webhook後） |
| 3 | Customer Portal | 支払い方法更新・履歴のみ。解約／プラン変更は出ない |
| 4 | 月額Checkout | Stripe金額＝契約月額の税込（10,000円→11,000円） |
| 5 | 4242成功 | active、payment履歴1件、BR-番号採番 |
| 6 | 3DS成功（4000 0027 6000 3184） | 認証後 active |
| 7 | 3DS失敗 | 契約・履歴は変化しない |
| 8 | payment failed（4000 0000 0000 0341→次回請求） | payment status のみ past_due。contract_status・採用機能は不変 |
| 9 | invoice.paid | webhook 200 |
| 10 | 月額payment記録 | 金額＝DB snapshot税込額のときだけ記録 |
| 11 | 適格請求書PDF発行 | 発行元設定済みなら自動、未設定なら「準備中」＋運営画面に未発行 |
| 12 | 会社ダウンロード | 自社のみ。URL非公開、監査ログ |
| 13 | SHA-256 | 保存ハッシュ＝実ファイル。改ざんで拒否 |
| 14 | webhook再送 | 二重記録・二重加算なし |
| 15 | 不正署名／署名なしPOST | 400、DB変化なし |
| 16 | 成功報酬カード決済 | Stripe金額＝DB total_amount のときだけ paid |
| 17 | 銀行振込済みfeeへのカード決済 | duplicate_payment 要確認として記録、paid上書きなし |
| 18 | Scout商品0件 | 「追加スカウト枠は現在販売していません」（価格は設定しない） |

success URL を直接開いても paid にならない（webhookのみが確定）。

## 5. キー無しで確認済みの内容（自動テスト）
- DBテスト：成功報酬の金額改ざん→paidにしない／銀行振込済み後のカード決済→重複扱い／月額の継続請求（2か月目の番号採番・PDF自動発行）／支払い失敗でcontract_status不変／Scout購入（ローカルテスト商品）→枠加算1回のみ／refund・dispute は integrity issue として記録（返金処理は未実装）。
- JSテスト：webhookハンドラ（モックStripe）、準備チェッカー、PDF（電話番号等）。

## 6. 次Phase候補（未実装）
- 返金／チャージバック時の自動処理と適格返還請求書（消費税法57条の4第3項）
- Stripe自動メールの扱い（税理士確認）
- Live切替手順（別途）
