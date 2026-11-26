import type { SupabaseClient } from "@supabase/supabase-js";
import { hireBillingEnabled } from "@/lib/billing/hire-flags";
import { getSalonAgreement } from "@/lib/billing/hire-loader";
import { isOpenAgreement } from "@/lib/billing/hire-agreement";

export const HIRE_GUARD_UNKNOWN = "入社の確認の情報を取得できなかったため、採用の確定は行いませんでした。画面を読み込み直してから、もう一度お試しください";
export const HIRE_GUARD_LIVE = "この採用には採用契約が開かれています。採用の確定は、画面の「入社の確認」から行ってください";

/**
 * 旧方式の「採用にする」（採用状況を hired にする）を、サーバー側で止めるかを判定する。null なら続行してよい。
 * - 新機能が無効なら何もしない（従来どおり）。
 * - 契約情報の取得に失敗したときは「契約なし」と扱わず、止める（旧操作を復活させない）。
 * - 有効な契約（辞退・取消でない）があるときは止める（二重の請求予定を作らない）。
 */
export async function hiredStatusBlockedReason(
  supabase: Pick<SupabaseClient, "rpc">, processId: string, env: Record<string, string | undefined> = process.env,
): Promise<string | null> {
  if (!hireBillingEnabled(env)) return null;
  const ag = await getSalonAgreement(supabase, processId);
  if (!ag.ok) return HIRE_GUARD_UNKNOWN;
  if (ag.data && isOpenAgreement(ag.data.status)) return HIRE_GUARD_LIVE;
  return null;
}
