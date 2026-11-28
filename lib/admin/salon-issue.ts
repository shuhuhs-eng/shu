import { z } from "zod";
import { isRegistrationPlan, REGISTRATION_PLANS } from "@/lib/billing/scout-credit-rules";

/**
 * 本部によるサロンアカウントの発行（DB 0117 案）。依存は引数で渡す（試験では偽物、本番ではサーバー側の実物）。
 * 順序: 発行の記録(begin) → 認証アカウント作成 → ID記録(attach) → パスワード設定メールの送信。
 *  ・同じ requestId で何度でも再実行できる（記録済みなら続きから）。
 *  ・★登録料の決済は行わない（本部が直接徴収）。区分は、会社が作られたときに初回スカウト件数（通常10・キャンペーン5）の根拠として記録される。
 *  ・★実際の認証アカウント作成・メール送信は、実物の依存（サーバー側）を渡したときだけ。試験では偽物。
 */
export type RpcFn = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
export type IssueDeps = {
  rpc: RpcFn;
  auth: { createUser(email: string, meta: Record<string, unknown>, appMeta: Record<string, unknown>): Promise<{ id: string }>; deleteUser(id: string): Promise<void>; isUnused(id: string): Promise<boolean> };
  mailer: { sendSetPassword(email: string): Promise<void> };
};
export type IssueResult = { ok: boolean; message: string; settled?: boolean };

const schema = z.object({
  requestId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email().max(254),
  displayName: z.string().trim().min(1).max(100),
  plan: z.string().refine(isRegistrationPlan),
});
const asObj = (d: unknown): Record<string, unknown> => (typeof d === "object" && d !== null && !Array.isArray(d) ? (d as Record<string, unknown>) : {});

export function issueErrorMessage(m: string | undefined): string {
  const s = m ?? "";
  if (s.includes("already exists for this email")) return "このメールアドレスのアカウントは既にあります。発行できません。";
  if (s.includes("open issuance already exists")) return "このメールアドレスは、発行の手続き中です。一覧から再送または取消をしてください。";
  if (s.includes("different content")) return "同じ操作の内容が変わっています。画面を更新してやり直してください。";
  if (s.includes("responsible only") || s.includes("insufficient permission")) return "この操作は責任者のみ行えます。";
  if (s.includes("invalid email")) return "メールアドレスを正しく入力してください。";
  if (s.includes("already linked")) return "会社の登録が済んでいるため、取り消せません。";
  if (s.includes("unknown registration class")) return "登録区分が正しくありません。";
  return "処理を完了できませんでした。時間をおいて、もう一度お試しください。";
}

export async function issueSalonAccount(d: IssueDeps, raw: { requestId: unknown; email: unknown; displayName: unknown; plan: unknown }): Promise<IssueResult> {
  const p = schema.safeParse(raw);
  if (!p.success) return { ok: false, message: "メールアドレス・サロン名（100文字まで）・登録区分を正しく入力してください。" };
  const { requestId, email, displayName, plan } = p.data;
  const label = REGISTRATION_PLANS[plan as keyof typeof REGISTRATION_PLANS].label;
  try {
    const b = await d.rpc("admin_salon_issue_begin", { p_request_id: requestId, p_email: email, p_display_name: displayName, p_plan: plan });
    if (b.error) return { ok: false, message: issueErrorMessage(b.error.message) };
    const status = String(asObj(b.data).status ?? "");
    if (status === "cancelled") return { ok: false, message: "この発行は取り消されています。新しく発行してください。", settled: true };
    if (status === "linked") return { ok: true, message: "既に会社の登録まで完了しています。", settled: true };
    let created: string | null = null;
    if (status === "pending") {
      const u = await d.auth.createUser(email, { role: "salon", display_name: displayName, issue_request_id: requestId }, { salon_issue_request_id: requestId });   // app_metadata は本人が書けない。DBのサロン登録ガード（0120）が照合する
      created = u.id;
      const a = await d.rpc("admin_salon_issue_attach", { p_request_id: requestId, p_auth_user_id: u.id });
      if (a.error) {
        // 記録できなかった未使用のアカウントだけを片付ける（誰にも通知していない）。片付けに失敗しても、次の再実行でDBの状態から続けられる。
        try { await d.auth.deleteUser(u.id); } catch { /* 手動確認 */ }
        return { ok: false, message: issueErrorMessage(a.error.message) };
      }
    }
    try { await d.mailer.sendSetPassword(email); } catch { return { ok: false, settled: false, message: `アカウントは発行しましたが、パスワード設定のメールを送れませんでした。一覧の「メールを再送」からもう一度お試しください。（${label}）` }; }
    return { ok: true, settled: true, message: `${label}として発行しました。${email} にパスワード設定のメールを送りました。登録料は本部が直接徴収します（この画面では決済しません）。${created ? "" : "（続きの手続きを完了しました）"}` };
  } catch (e) {
    return { ok: false, message: issueErrorMessage(e instanceof Error ? e.message : undefined) };
  }
}

/** パスワード設定メールの再送。宛先は画面の入力ではなく、DBの発行の記録（責任者だけが読める一覧）から取る。 */
export async function resendSetPassword(d: IssueDeps, requestId: unknown): Promise<IssueResult> {
  const id = z.string().uuid().safeParse(requestId);
  if (!id.success) return { ok: false, message: "対象を確認できませんでした。" };
  try {
    const l = await d.rpc("admin_salon_issuances_list", { p_limit: 200 });
    if (l.error) return { ok: false, message: issueErrorMessage(l.error.message) };
    const row = (Array.isArray(l.data) ? l.data : []).map(asObj).find((r) => r.request_id === id.data);
    if (!row || row.status !== "issued" || typeof row.email !== "string") return { ok: false, message: "再送できる状態ではありません（発行済み・会社の登録前のものだけ）。" };
    await d.mailer.sendSetPassword(row.email);
    return { ok: true, message: `${row.email} にパスワード設定のメールを再送しました。` };
  } catch (e) { return { ok: false, message: issueErrorMessage(e instanceof Error ? e.message : undefined) }; }
}

/** 取消。会社の登録前だけ。未使用（一度もログインしていない）の認証アカウントだけを削除する。 */
export async function cancelIssuance(d: IssueDeps, raw: { requestId: unknown; reason: unknown }): Promise<IssueResult> {
  const id = z.string().uuid().safeParse(raw.requestId), reason = z.string().trim().min(1).max(500).safeParse(raw.reason);
  if (!id.success || !reason.success) return { ok: false, message: "取消の理由を入力してください。" };
  try {
    const c = await d.rpc("admin_salon_issue_cancel", { p_request_id: id.data, p_reason: reason.data });
    if (c.error) return { ok: false, message: issueErrorMessage(c.error.message) };
    const uid = asObj(c.data).auth_user_id;
    if (typeof uid === "string" && !asObj(c.data).repeated) {
      let removed = false;
      try { if (await d.auth.isUnused(uid)) { await d.auth.deleteUser(uid); removed = true; } } catch { /* 手動確認 */ }
      return { ok: true, message: removed ? "発行を取り消し、未使用のアカウントを削除しました。" : "発行を取り消しました。アカウントは使用済みの可能性があるため削除していません（確認してください）。" };
    }
    return { ok: true, message: "発行を取り消しました。" };
  } catch (e) { return { ok: false, message: issueErrorMessage(e instanceof Error ? e.message : undefined) }; }
}
