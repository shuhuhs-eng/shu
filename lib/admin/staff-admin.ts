import type { StaffMailerLike } from "@/lib/admin/staff-admin-types";
import type { AuthAdmin, InviteOutcome } from "@/lib/admin/staff-invite";
import { buildStaffLink, STAFF_LINK_TYPE } from "@/lib/admin/staff-link";
import type { MailProvider } from "@/lib/email/provider";

/** 責任者のスタッフ管理画面の、表示用の整形・メール・認証管理APIの接続（純粋な部分。DB・認証の呼び出しは各アクション）。 */
export const INVITE_VALID_DAYS = 14;

export type StaffRow = { user_id: string; display_name: string; email: string; status: "invited" | "active" | "suspended"; registered_at: string; accepted_at: string | null; status_changed_at: string };
export type OpenInvitation = { request_id: string; email: string; display_name: string; status: string; last_error: string | null; created_at: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** admin_staff_list の戻り値。想定外の形は null（空の一覧と区別して、取得失敗として表示する）。 */
export function parseStaffList(data: unknown): StaffRow[] | null {
  if (!Array.isArray(data)) return null;
  const out: StaffRow[] = [];
  for (const r of data) {
    if (!isObj(r)) return null;
    const status = r.status;
    if (status !== "invited" && status !== "active" && status !== "suspended") return null;
    out.push({ user_id: str(r.user_id), display_name: str(r.display_name), email: str(r.email), status, registered_at: str(r.registered_at), accepted_at: typeof r.accepted_at === "string" ? r.accepted_at : null, status_changed_at: str(r.status_changed_at) });
  }
  return out;
}
export function parseOpenInvitations(data: unknown): OpenInvitation[] | null {
  if (!Array.isArray(data)) return null;
  const out: OpenInvitation[] = [];
  for (const r of data) {
    if (!isObj(r)) return null;
    out.push({ request_id: str(r.request_id), email: str(r.email), display_name: str(r.display_name), status: str(r.status), last_error: typeof r.last_error === "string" ? r.last_error : null, created_at: str(r.created_at) });
  }
  return out;
}

export type StaffViewKey = "invited" | "invited_expired" | "active" | "suspended";
export type StaffAction = "resend" | "rename" | "suspend" | "reactivate" | "password_reset";
export type StaffView = { key: StaffViewKey; label: string; expiresAt: string | null; actions: StaffAction[] };

/** 行の状態表示と、出せる操作。削除は出さない（履歴・担当記録を残すため、停止で運用する）。 */
export function staffView(row: Pick<StaffRow, "status" | "registered_at" | "accepted_at">, now: Date): StaffView {
  if (row.status === "invited") {
    const exp = new Date(new Date(row.registered_at).getTime() + INVITE_VALID_DAYS * 86400000);
    const expired = exp.getTime() <= now.getTime();
    return { key: expired ? "invited_expired" : "invited", label: expired ? "招待の期限切れ" : "招待中（未承諾）", expiresAt: exp.toISOString(), actions: ["resend", "rename", "suspend"] };
  }
  if (row.status === "active") return { key: "active", label: "有効", expiresAt: null, actions: ["rename", "password_reset", "suspend"] };
  return { key: "suspended", label: row.accepted_at ? "停止中" : "停止中（未承諾）", expiresAt: null, actions: ["rename", "reactivate"] };
}

/**
 * 招待結果の画面文言と、フォームの扱い。
 *  settled: 今回の招待操作は区切りがついた（同じ requestId を使い続けない → 画面は次の招待に新しい requestId を使う）。
 *           区切りがつかないもの（片付け未完了・想定外の失敗）は、同じ requestId で再試行できるよう false。
 *  clear:   入力欄を空にしてよい（登録が済んだとき。メール送信だけ失敗した場合も、登録済みなので空にして「再招待」へ案内する）。
 */
export function inviteMessage(o: InviteOutcome): { ok: boolean; message: string; settled: boolean; clear: boolean } {
  switch (o.status) {
    case "registered": return { ok: true, settled: true, clear: true, message: "招待を登録し、招待メールを送りました。本人がリンクからパスワードを設定します。続けて、別の方も招待できます。" };
    case "registered_mail_failed": return { ok: false, settled: true, clear: true, message: "招待は登録しましたが、メールを送れませんでした。もう一度入力して送り直さず、下の一覧の「再招待」で再送してください（二重には登録されません）。" };
    case "stopped_unsafe":
      return { ok: false, settled: true, clear: false, message: o.reason === "existing_user" ? "このメールアドレスはすでに利用されています。既存のアカウントはスタッフにできません。別のメールアドレスで招待してください。"
        : o.reason === "open_invitation_exists" ? "このメールアドレスには、進行中の招待があります。下の「進行中の招待」から続けてください。"
        : "安全のため処理を止めました。運営（開発）に連絡してください。" };
    case "compensated": return { ok: false, settled: true, clear: false, message: "招待を完了できませんでした。作成途中のものは安全に片付けました。もう一度お試しください。" };
    case "compensation_failed": return { ok: false, settled: false, clear: false, message: "招待を完了できず、片付けも完了していません。「進行中の招待」を確認してください。" };
    case "terminal": return { ok: false, settled: true, clear: false, message: "この招待はすでに終了しています。新しく招待してください。" };
  }
}

/** DBの例外文を、責任者向けの文言へ（想定外は一般的な文言。内部の文は出さない）。 */
export function rpcErrorMessage(message: string | undefined, fallback: string): string {
  const m = message ?? "";
  if (m.includes("responsible admin required")) return "この操作は責任者だけができます。";
  if (m.includes("staff not found")) return "対象のスタッフが見つかりません。";
  if (m.includes("only a pending invitation can be resent")) return "再招待できるのは、招待中（未承諾）のスタッフだけです。";
  if (m.includes("only an active staff can be reset")) return "パスワード再設定を送れるのは、承諾済みで有効なスタッフだけです。招待中は再招待、停止中は再開してください。";
  if (m.includes("too many resends") || m.includes("too many resets")) return "短時間に何度も送信しています。1時間ほど待ってからお試しください。";
  if (m.includes("invalid name")) return "名前は1〜60文字で入力してください。";
  if (m.includes("staff has no email")) return "メールアドレスが登録されていません。";
  return fallback;
}

// ---- メール（本文にパスワードは入れない。リンクだけ） ----
export function inviteMailText(link: string, displayName: string): { subject: string; text: string } {
  return {
    subject: "【Beauty Reach】運営スタッフへの招待",
    text: `${displayName} 様\n\nBeauty Reach の運営スタッフに招待されました。\n下のリンクを開き、画面の案内に従ってパスワードを設定し、招待を承諾してください。\n（パスワードは、あなた自身が画面で決めます。責任者にも表示されません。）\n\n${link}\n\n・リンクは一度だけ使えます。数時間で無効になることがあります。無効になったときは、責任者に再招待を依頼してください。\n・心当たりがない場合は、このメールを破棄してください。\n`,
  };
}
export function resetMailText(link: string, displayName: string): { subject: string; text: string } {
  return {
    subject: "【Beauty Reach】パスワード再設定のご案内",
    text: `${displayName} 様\n\n責任者がパスワードの再設定を依頼しました。\n下のリンクを開き、新しいパスワードを設定してください。（パスワードは、あなた自身が画面で決めます。）\n\n${link}\n\n・リンクは一度だけ使えます。数時間で無効になることがあります。\n・心当たりがない場合は、このメールを破棄してください。パスワードは変わりません。\n`,
  };
}

/** メール送信の窓口（lib/email/provider）を使う送り手。送れなかったときは例外（呼び出し側が「再招待で再送」の案内にする）。 */
export function createStaffMailer(provider: MailProvider, newKey: () => string = () => crypto.randomUUID()): StaffMailerLike {
  const send = async (to: string, m: { subject: string; text: string }) => {
    const r = await provider.send({ to, subject: m.subject, text: m.text, idempotencyKey: newKey() });
    if (r.kind !== "sent") throw new Error("mail_" + r.kind + ":" + ("error" in r ? r.error : ""));
  };
  return {
    sendInvite: (to, link, displayName) => send(to, inviteMailText(link, displayName || "ご担当者")),
    sendPasswordReset: (to, link, displayName) => send(to, resetMailText(link, displayName || "ご担当者")),
  };
}

// ---- 認証管理API（service role）への接続。型は最小限に絞り、試験では偽物を渡す ----
export type ServiceAuthAdmin = {
  listUsers(p: { page: number; perPage: number }): Promise<{ data: { users: Array<{ id: string; email?: string | null; user_metadata?: Record<string, unknown> | null }> }; error: { message: string } | null }>;
  createUser(p: { email: string; email_confirm: boolean; user_metadata: Record<string, unknown> }): Promise<{ data: { user: { id: string } | null }; error: { message: string } | null }>;
  generateLink(p: { type: "recovery" | "invite"; email: string }): Promise<{ data: { properties?: { hashed_token?: string } | null }; error: { message: string } | null }>;
  deleteUser(id: string): Promise<{ error: { message: string } | null }>;
};

export function createStaffAuthAdmin(admin: ServiceAuthAdmin, siteUrl: string): AuthAdmin {
  return {
    async findByEmail(email) {
      const want = email.trim().toLowerCase();
      for (let page = 1; page <= 50; page++) {
        const { data, error } = await admin.listUsers({ page, perPage: 1000 });
        if (error) throw new Error("auth_list_failed");
        const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === want);
        if (hit) { const r = hit.user_metadata?.invite_request_id; return { id: hit.id, inviteRequestId: typeof r === "string" ? r : null }; }
        if (data.users.length < 1000) return null;
      }
      throw new Error("auth_list_too_long");   // 見つけきれないときは作らない（二重作成を避ける）
    },
    async createUser(email, inviteRequestId) {
      const { data, error } = await admin.createUser({ email, email_confirm: false, user_metadata: { invite_request_id: inviteRequestId } });
      if (error || !data.user) throw new Error("auth_create_failed");
      return { id: data.user.id };
    },
    async generateLink(email) {
      const { data, error } = await admin.generateLink({ type: STAFF_LINK_TYPE, email });
      const t = data?.properties?.hashed_token;
      if (error || !t) throw new Error("auth_link_failed");
      return { link: buildStaffLink(siteUrl, t) };
    },
    async deleteUser(id) {
      const { error } = await admin.deleteUser(id);
      if (error) throw new Error("auth_delete_failed");
    },
  };
}
