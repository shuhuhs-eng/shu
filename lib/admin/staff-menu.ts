/** スタッフに開く画面の一覧（入口・表示）。権限の本体ではなく、画面の出し分けと対応表の根拠。各画面は requireAdminOperator、操作はDBの is_admin_operator() が確認する。 */
export const STAFF_MENU = [
  { href: "/admin/visit-requests", label: "見学・体験入店の受付", lead: "受付・担当の変更・日程の調整・双方への確認" },
  { href: "/admin/interests", label: "直接希望（見学・体験入店）", lead: "直接の希望の一覧の確認（読み取りのみ）" },
  { href: "/admin/messages", label: "連絡", lead: "既存のやり取りの確認・返信・状態の変更" },
  { href: "/admin/interviews", label: "面接・進捗", lead: "面接の予定と進捗の確認（読み取りのみ）" },
  { href: "/admin/culture-readiness", label: "診断の状況", lead: "店舗の診断の状況の確認（読み取りのみ）" },
] as const;
