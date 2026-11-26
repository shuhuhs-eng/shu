import { createClient } from "@/lib/supabase/server";
import { scoutLedgerEnabled } from "@/lib/billing/hire-flags";
import { ScoutQuotaCard } from "@/components/store-activity/scout-quota-card";
import { ScoutBalanceCard, type ScoutBalance } from "@/components/store-activity/scout-balance-card";
import type { StoreScoutQuota } from "@/lib/store-activity/types";

/**
 * スカウトの残数表示の共通入口（店舗ダッシュボード・美容師を探す画面〔通常／地域検索〕で同じ部品を使う）。
 * 台帳方式（SCOUT_LEDGER_ENABLED=1 かつ DBの送信方式スイッチが ledger）のときは、送信可否と同じ台帳の残高を出す。
 * それ以外は従来の月次枠（quota）。読み取りのみ。
 */
export async function ScoutAllowance({ storeId, quota }: { storeId: string; quota: StoreScoutQuota | null }) {
  if (!scoutLedgerEnabled()) return <ScoutQuotaCard quota={quota} />;
  const supabase = await createClient();
  const { data: mode } = await supabase.rpc("scout_send_mode" as never);
  if (mode !== "ledger") return <ScoutQuotaCard quota={quota} />;
  const { data } = await supabase.rpc("scout_ledger_balance_for_store" as never, { p_store_id: storeId } as never);
  const balance = data && typeof data === "object" ? (data as ScoutBalance) : null;
  return <ScoutBalanceCard balance={balance} />;
}
