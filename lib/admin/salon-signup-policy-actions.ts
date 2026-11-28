"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { salonAccountIssueEnabled } from "@/lib/billing/hire-flags";

/** サロンの一般登録を認証側（DB）で閉じる／開く。責任者のみ（DBが再確認）。SALON_ACCOUNT_ISSUE_ENABLED=1 のときだけ操作できる。 */
export async function setSalonSignupIssuedOnly(issuedOnly: boolean): Promise<{ success: boolean; error?: string }> {
  if (!salonAccountIssueEnabled()) return { success: false, error: "この機能はまだ有効になっていません。" };
  if (!z.boolean().safeParse(issuedOnly).success) return { success: false, error: "入力が正しくありません。" };
  const supabase = (await createClient()) as unknown as { rpc: (n: string, a: object) => PromiseLike<{ error: { message: string } | null }> };
  const { error } = await supabase.rpc("admin_set_salon_signup_policy", { p_issued_only: issuedOnly });
  if (error) return { success: false, error: /responsible only|insufficient permission/.test(error.message) ? "この操作は責任者のみ行えます。" : "設定を変更できませんでした。" };
  revalidatePath("/admin/salons/issue");
  return { success: true };
}
