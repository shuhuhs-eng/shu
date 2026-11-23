/**
 * スタッフ招待の手順（DB の招待RPCと認証管理API・メール送信をつなぐ）。依存は全て引数で渡す（試験では偽物、本番ではサーバー側の実物）。
 * 方針:
 *  - 順序は「begin → 認証アカウント作成 → ID記録 → 登録 → リンク発行 → メール送信」。★リンクは登録が済むまで誰にも渡さない
 *    （リンクが先に使われると、DBが「使用済み」として運営権限への採用を拒否する）。
 *  - 同じ requestId で何度でも再実行できる。途中で切れても、続きから進めるか、安全に止まる。
 *  - 認証アカウントを削除してよいのは、DBが「本操作で作った・未使用・スタッフ未登録」と確認した場合だけ（may_delete）。
 *  - ★実際のメール送信・認証アカウント作成は、承認があるまで行わない（mailer / auth の実物を渡さない限り何も起きない）。
 */
export type RpcFn = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
export type AuthAdmin = {
  /** メールで既存の認証アカウントを探す（無ければ null）。ID・メタデータ(invite_request_id)を返す。 */
  findByEmail(email: string): Promise<{ id: string; inviteRequestId: string | null } | null>;
  /** 認証アカウントを作る（メールは送らない・メタデータに invite_request_id を付ける）。 */
  createUser(email: string, inviteRequestId: string): Promise<{ id: string }>;
  /** 既存アカウント向けのログイン用リンクを発行する（メールは送らない）。 */
  generateLink(email: string): Promise<{ link: string }>;
  deleteUser(id: string): Promise<void>;
};
export type Mailer = { sendInvite(to: string, link: string, displayName: string): Promise<void> };

export type InviteOutcome =
  | { status: "registered"; mailed: boolean }
  | { status: "registered_mail_failed"; error: string }          // 登録は済み。メールだけ失敗 → 再送で回復
  | { status: "stopped_unsafe"; reason: "existing_user" | "unsafe_adopt" | "open_invitation_exists" }   // 採用も削除もせず停止（手動確認）
  | { status: "compensated" }                                        // 登録できず、安全に作成物を片付けた
  | { status: "compensation_failed"; reason: string }               // 片付けられない（使用済み等）。手動確認（進行中の一覧に出る）
  | { status: "terminal" };                                          // 終了済みの招待。新しい requestId で

type Json = Record<string, unknown>;
const asJson = (d: unknown): Json => (typeof d === "object" && d !== null ? (d as Json) : {});

async function call(rpc: RpcFn, name: string, args: Record<string, unknown>): Promise<Json> {
  const { data, error } = await rpc(name, args);
  if (error) throw Object.assign(new Error(String(error.message ?? "rpc failed")), { rpcName: name });
  return asJson(data);
}

async function compensate(deps: Deps, requestId: string): Promise<InviteOutcome> {
  const c = await call(deps.rpc, "admin_staff_invite_compensation_begin", { p_request_id: requestId });
  if (c.status === "compensated") return { status: "compensated" };
  if (c.may_delete !== true) return { status: "compensation_failed", reason: String(c.reason ?? c.status ?? "not_deletable") };
  const id = String(c.auth_user_id ?? "");
  let deleted = false, err: string | undefined;
  try { await deps.auth.deleteUser(id); deleted = true; } catch (e) { err = e instanceof Error ? e.message : "delete_failed"; }
  const d = await call(deps.rpc, "admin_staff_invite_compensation_done", { p_request_id: requestId, p_deleted: deleted, p_error: err ?? null });
  return d.status === "compensated" ? { status: "compensated" } : { status: "compensation_failed", reason: String(d.status ?? "unknown") };
}

export type Deps = { rpc: RpcFn; auth: AuthAdmin; mailer: Mailer };

/** 招待を進める。何度呼んでも安全（冪等）。 */
export async function inviteStaff(deps: Deps, a: { requestId: string; email: string; displayName: string }): Promise<InviteOutcome> {
  const email = a.email.trim().toLowerCase();
  let begin: Json;
  try { begin = await call(deps.rpc, "admin_staff_invite_begin", { p_request_id: a.requestId, p_email: email, p_display_name: a.displayName }); }
  catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (m.includes("open_invitation_exists")) return { status: "stopped_unsafe", reason: "open_invitation_exists" };
    if (m.includes("existing_user")) return { status: "stopped_unsafe", reason: "existing_user" };
    throw e;
  }
  switch (begin.action) {
    case "terminal": return { status: "terminal" };
    case "compensate": return compensate(deps, a.requestId);
    case "done": return sendLink(deps, email, a.displayName.trim());
    case "create_auth": {
      // ID未記録の中断からの再開: 先にメールで既存を探し、本操作(同じ requestId)で作ったものだけを引き継ぐ。他人のものは触らない。
      const found = await deps.auth.findByEmail(email);
      let id: string;
      if (found) {
        if (found.inviteRequestId !== a.requestId) return { status: "stopped_unsafe", reason: "existing_user" };
        id = found.id;
      } else {
        id = (await deps.auth.createUser(email, a.requestId)).id;
      }
      const m = await call(deps.rpc, "admin_staff_invite_mark_auth_created", { p_request_id: a.requestId, p_auth_user_id: id });
      if (m.ok !== true) return { status: "stopped_unsafe", reason: "unsafe_adopt" };   // DBが aborted にした。削除しない
      return register(deps, a.requestId, email, a.displayName.trim());
    }
    case "register": return register(deps, a.requestId, email, a.displayName.trim());
    default: throw new Error("unexpected begin action");
  }
}

async function register(deps: Deps, requestId: string, email: string, name: string): Promise<InviteOutcome> {
  try {
    await call(deps.rpc, "admin_staff_invite_register", { p_request_id: requestId });
  } catch {
    // 登録できなかった（例: 登録前にリンクが使われた）。削除してよいかはDBが判断する。
    return compensate(deps, requestId);
  }
  return sendLink(deps, email, name);
}

/** 登録が済んでからリンクを発行して送る。失敗しても登録は取り消さない（再送で回復）。 */
async function sendLink(deps: Deps, email: string, name: string): Promise<InviteOutcome> {
  try {
    const { link } = await deps.auth.generateLink(email);
    await deps.mailer.sendInvite(email, link, name);
    return { status: "registered", mailed: true };
  } catch (e) {
    return { status: "registered_mail_failed", error: e instanceof Error ? e.message : "mail_failed" };
  }
}

/**
 * 再送（招待中のスタッフ。期限切れも可）。DBが14日の起点を更新し、★宛先メールと名前はDBが返した登録済みの値を使う
 * （画面から渡されたメールは受け取らない。他人のメールを組み合わせてもリンクは出ない）。
 */
export async function resendStaffInvite(deps: Deps, a: { userId: string }): Promise<InviteOutcome> {
  const r = await call(deps.rpc, "admin_staff_invite_resend", { p_user_id: a.userId });
  const email = typeof r.email === "string" ? r.email.trim().toLowerCase() : "";
  const name = typeof r.display_name === "string" ? r.display_name : "";
  if (!email) throw new Error("staff has no email");
  return sendLink(deps, email, name);
}
