import { z } from "zod";
import { inviteStaff, resendStaffInvite, type Deps, type RpcFn } from "@/lib/admin/staff-invite";
import { buildStaffLink } from "@/lib/admin/staff-link";
import { inviteMessage, rpcErrorMessage } from "@/lib/admin/staff-admin";
import type { StaffMailerLike } from "@/lib/admin/staff-admin-types";
import type { AuthAdmin } from "@/lib/admin/staff-invite";

/** 管理画面の操作の中身（依存は引数。試験では偽物）。戻りは画面に出す文言だけ（内部の文・リンク・パスワードは返さない）。 */
export type ManageResult = { ok: boolean; message: string; settled?: boolean; clear?: boolean };
export type ManageDeps = { rpc: RpcFn; auth: AuthAdmin; mailer: StaffMailerLike };

const inviteSchema = z.object({
  requestId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email().max(254),
  displayName: z.string().trim().min(1).max(60),
});

export async function inviteCore(d: ManageDeps, raw: { requestId: unknown; email: unknown; displayName: unknown }): Promise<ManageResult> {
  const p = inviteSchema.safeParse(raw);
  if (!p.success) return { ok: false, message: "メールアドレスと名前（1〜60文字）を正しく入力してください。" };
  try {
    const o = await inviteStaff(d as Deps, p.data);
    return inviteMessage(o);
  } catch (e) {
    return { ok: false, message: rpcErrorMessage(e instanceof Error ? e.message : undefined, "招待を完了できませんでした。時間をおいて、もう一度お試しください。") };
  }
}

const idSchema = z.string().uuid();

/** 再招待。宛先は引数に取らない（DBが責任者権限と対象を確認したうえで、登録済みのメールを返す）。 */
export async function resendCore(d: ManageDeps, userId: unknown): Promise<ManageResult> {
  const id = idSchema.safeParse(userId);
  if (!id.success) return { ok: false, message: "対象を確認できませんでした。" };
  try { return inviteMessage(await resendStaffInvite(d as Deps, { userId: id.data })); }
  catch (e) { return { ok: false, message: rpcErrorMessage(e instanceof Error ? e.message : undefined, "再招待できませんでした。") }; }
}

export async function renameCore(rpc: RpcFn, userId: unknown, name: unknown): Promise<ManageResult> {
  const id = idSchema.safeParse(userId), n = z.string().trim().min(1).max(60).safeParse(name);
  if (!id.success || !n.success) return { ok: false, message: "名前は1〜60文字で入力してください。" };
  const { error } = await rpc("admin_staff_rename", { p_user_id: id.data, p_display_name: n.data });
  return error ? { ok: false, message: rpcErrorMessage(error.message, "名前を変更できませんでした。") } : { ok: true, message: "名前を変更しました。" };
}

export async function setStatusCore(rpc: RpcFn, userId: unknown, status: unknown, reason?: unknown): Promise<ManageResult> {
  const id = idSchema.safeParse(userId);
  if (!id.success || (status !== "suspended" && status !== "active")) return { ok: false, message: "対象を確認できませんでした。" };
  const r = typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 500) : null;
  const { data, error } = await rpc("admin_staff_set_status", { p_user_id: id.data, p_status: status, p_reason: r });
  if (error) return { ok: false, message: rpcErrorMessage(error.message, "状態を変更できませんでした。") };
  const changed = typeof data === "object" && data !== null && (data as { changed?: unknown }).changed === true;
  if (!changed) return { ok: true, message: "すでにその状態です（変更はありません）。" };
  return status === "suspended"
    ? { ok: true, message: "停止しました。業務操作はすぐに使えなくなります。履歴・担当の記録は残ります。" }
    : { ok: true, message: "再開しました。本人は、もう一度ログインすると使えます。" };
}

/** パスワード再設定の案内を、本人のメールへ送る（責任者はパスワードを設定も閲覧もしない）。 */
export async function passwordResetCore(d: ManageDeps, userId: unknown): Promise<ManageResult> {
  const id = idSchema.safeParse(userId);
  if (!id.success) return { ok: false, message: "対象を確認できませんでした。" };
  let email: string, displayName: string;
  try {
    const { data, error } = await d.rpc("admin_staff_password_reset_begin", { p_user_id: id.data });
    if (error) return { ok: false, message: rpcErrorMessage(error.message, "パスワード再設定を開始できませんでした。") };
    email = String((data as { email?: unknown } | null)?.email ?? "");
    displayName = String((data as { display_name?: unknown } | null)?.display_name ?? "");
    if (!email) return { ok: false, message: "メールアドレスが登録されていません。" };
  } catch { return { ok: false, message: "パスワード再設定を開始できませんでした。" }; }
  try {
    const { link } = await d.auth.generateLink(email);
    await d.mailer.sendPasswordReset(email, link, displayName);
    return { ok: true, message: "パスワード再設定のメールを送りました。本人がリンクから新しいパスワードを設定します。" };
  } catch { return { ok: false, message: "メールを送れませんでした。時間をおいて、もう一度お試しください。" }; }
}

export { buildStaffLink };
