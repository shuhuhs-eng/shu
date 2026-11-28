"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getSiteUrl } from "@/lib/site-url";
import { salonAccountIssueEnabled } from "@/lib/billing/hire-flags";
import { cancelIssuance, issueSalonAccount, resendSetPassword, type IssueDeps, type IssueResult, type RpcFn } from "@/lib/admin/salon-issue";

/** 本部によるサロンアカウント発行の操作。SALON_ACCOUNT_ISSUE_ENABLED=1 のときだけ動く（既定オフ）。権限は各RPCが責任者のみで再確認する。 */
const OFF: IssueResult = { ok: false, message: "この機能はまだ有効になっていません。" };
async function deps(): Promise<IssueDeps> {
  const supabase = await createClient();
  const admin = createServiceClient().auth.admin;
  return {
    rpc: ((n, a) => (supabase as unknown as { rpc: RpcFn }).rpc(n, a)) as RpcFn,
    auth: {
      async createUser(email, meta, appMeta) { const { data, error } = await admin.createUser({ email, email_confirm: true, user_metadata: meta, app_metadata: appMeta }); if (error || !data.user) throw new Error("auth_create_failed"); return { id: data.user.id }; },
      async deleteUser(id) { const { error } = await admin.deleteUser(id); if (error) throw new Error("auth_delete_failed"); },
      async isUnused(id) { const { data, error } = await admin.getUserById(id); if (error || !data.user) return false; return !data.user.last_sign_in_at; },
    },
    mailer: { async sendSetPassword(email) { const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${getSiteUrl()}/auth/callback?next=/update-password` }); if (error) throw new Error("mail_failed"); } },
  };
}
export async function issueSalonAccountAction(input: { requestId: string; email: string; displayName: string; plan: string }): Promise<IssueResult> {
  if (!salonAccountIssueEnabled()) return OFF;
  const r = await issueSalonAccount(await deps(), input); revalidatePath("/admin/salons/issue"); return r;
}
export async function resendSetPasswordAction(input: { requestId: string }): Promise<IssueResult> {
  if (!salonAccountIssueEnabled()) return OFF;
  return resendSetPassword(await deps(), input.requestId);
}
export async function cancelIssuanceAction(input: { requestId: string; reason: string }): Promise<IssueResult> {
  if (!salonAccountIssueEnabled()) return OFF;
  const r = await cancelIssuance(await deps(), input); revalidatePath("/admin/salons/issue"); return r;
}
