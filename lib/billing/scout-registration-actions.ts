"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { scoutLedgerEnabled } from "@/lib/billing/hire-flags";
import { isRegistrationPlan } from "@/lib/billing/scout-credit-rules";
import { registrationErrorMessage } from "@/lib/billing/scout-registration-message";

/** スカウト登録区分（通常／キャンペーン）の設定。責任者のみ（DBが再確認）。初回付与の後は変更できない（DBが拒否）。SCOUT_LEDGER_ENABLED=1 のときだけ動く。 */
type Result = { success: true } | { success: false; error: string };
const orgId = z.string().uuid();
export async function setScoutRegistration(input: { organizationId: string; plan: string }): Promise<Result> {
  if (!scoutLedgerEnabled()) return { success: false, error: "この機能はまだ有効になっていません。" };
  const id = orgId.safeParse(input.organizationId);
  if (!id.success || !isRegistrationPlan(input.plan)) return { success: false, error: "入力が正しくありません。" };
  const supabase = (await createClient()) as unknown as Pick<SupabaseClient, "rpc">;
  const { error } = await supabase.rpc("admin_scout_set_registration", { p_org: id.data, p_plan: input.plan });
  if (error) { console.error("[admin_scout_set_registration]", { code: error.code }); return { success: false, error: registrationErrorMessage(error.message) }; }
  revalidatePath(`/admin/scout-ledger/${id.data}`);
  return { success: true };
}
