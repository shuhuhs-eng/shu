/** スカウト台帳（0110・提案・未適用）の画面側の表示。台帳は追記専用で、残高＝履歴の合計。★既存の送信可能数の判定・購入処理はまだ切り替えていない。 */
export type EntryType = "initial_grant" | "purchase" | "campaign_grant" | "consume" | "reversal";
export const ENTRY_LABELS: Record<string, string> = { initial_grant: "初回付与", purchase: "購入", campaign_grant: "キャンペーン付与", consume: "消費（送信）", reversal: "取消（返金に伴う差し引き）" };
export const POOL_LABELS: Record<string, string> = { free: "無料分", paid: "購入分" };
export type LedgerSummaryRow = { organization_id: string; organization_name: string; balance: number; free_balance: number; paid_balance: number; granted: number; purchased: number; consumed: number; reversed: number };
export type LedgerEntry = { id: string; created_at: string; entry_type: EntryType; quantity: number; pool: "free" | "paid"; source_ref: string; note: string | null; reverses_entry_id: string | null; store_name: string | null };
export type LedgerDetail = { organization_name: string; balance: number; free_balance: number; paid_balance: number; total: number; rows: LedgerEntry[] };
export type Campaign = { id: string; name: string; quantity: number; price_excl_tax: number; starts_on: string; ends_on: string; status: "draft" | "active" | "ended" };
