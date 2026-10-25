/** 運営画面の文言（純粋）。Stripe技術IDは通常画面には出さず、詳細画面だけで表示する。 */
export const SYNC_FLAG_LABELS: Record<string, string> = {
  subscription_missing: "契約は有効で月額もあるが、カード課金が未設定",
  monthly_amount_mismatch: "契約の月額（税抜）とカード課金の税抜額が一致しない（自動変更はしません）",
  stripe_amount_mismatch: "Stripe上の現在の請求額が、決済時にDBで確定した税込額と一致しない",
  no_payment_method: "カード課金中だが、カードが未登録",
  subscription_without_contract_fee: "契約の月額が0円/未設定なのに、カード課金が有効",
};

export const ISSUE_TYPE_LABELS: Record<string, string> = {
  amount_mismatch: "請求額の不一致（入金扱いにしていません）",
  currency_mismatch: "通貨の不一致（入金扱いにしていません）",
  duplicate_payment: "二重支払い（銀行振込済みの請求にカード決済あり。返金の確認が必要）",
  fee_not_payable: "支払えない状態の請求にカード決済あり（返金の確認が必要）",
  customer_mismatch: "決済した顧客が会社と一致しない",
  organization_mismatch: "請求の所属会社が一致しない",
  unknown_checkout_session: "対応する決済の記録が見つからない",
  unknown_customer: "会社に紐づかないStripe顧客からの通知",
  duplicate_subscription: "同じ会社に有効な月額課金が2つある",
  refund_or_dispute: "返金またはチャージバック（自動では入金状態を戻していません）",
};

export const CHECKOUT_STATUS_LABELS: Record<string, string> = {
  pending: "準備中", open: "手続き中", completed: "完了", expired: "期限切れ", superseded: "置き換え", needs_review: "要確認",
};
export const CHECKOUT_PURPOSE_LABELS: Record<string, string> = {
  payment_method_setup: "カード登録", monthly_subscription: "月額課金", success_fee: "成功報酬", scout_credits: "追加スカウト枠",
};
