/** 見学・体験料（DB草案0108）の機能フラグ（サーバー側のみ・既定オフ）。0108の適用（レビュー・承認後）より前に有効にしない。 */
import { flagEnabled } from "@/lib/billing/hire-flags";
export function visitFeeEnabled(env: Record<string, string | undefined> = process.env): boolean { return flagEnabled(env.VISIT_FEE_ENABLED); }
