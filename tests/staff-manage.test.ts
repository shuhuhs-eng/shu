import test from "node:test";
import assert from "node:assert/strict";
import { buildStaffLink, parseStaffLinkParams, staffLinkReturnPath, STAFF_LINK_PATH } from "../lib/admin/staff-link";
import { createStaffAuthAdmin, createStaffMailer, inviteMailText, resetMailText, staffView, parseStaffList, rpcErrorMessage, type ServiceAuthAdmin } from "../lib/admin/staff-admin";
import { inviteCore, passwordResetCore, renameCore, resendCore, setStatusCore, type ManageDeps } from "../lib/admin/staff-manage-core";
import { CaptureProvider, type MailProvider } from "../lib/email/provider";
import type { RpcFn } from "../lib/admin/staff-invite";

const TOK = "abcdefghijklmnop1234567890-_.AB";
const SITE = "https://staging.example.test/";

test("リンク: 自サイトの確認ページへ。末尾スラッシュ正規化・トークン形式検査", () => {
  const l = buildStaffLink(SITE, TOK);
  assert.equal(l, `https://staging.example.test${STAFF_LINK_PATH}?token_hash=${TOK}&type=recovery`);
  assert.throws(() => buildStaffLink(SITE, "short"));
  assert.throws(() => buildStaffLink(SITE, "x".repeat(20) + "&next=//evil"));
});
test("リンク検証: 形式違い・種別違い・複数指定は拒否", () => {
  assert.deepEqual(parseStaffLinkParams({ token_hash: TOK, type: "recovery" }), { ok: true, tokenHash: TOK, type: "recovery" });
  assert.equal(parseStaffLinkParams({ token_hash: TOK, type: "invite" }).ok, true);
  for (const bad of [{ token_hash: TOK, type: "magiclink" }, { token_hash: TOK, type: "signup" }, { token_hash: "a b", type: "recovery" }, { token_hash: [TOK, TOK], type: "recovery" }, { type: "recovery" }, {}])
    assert.equal(parseStaffLinkParams(bad as never).ok, false);
});
test("戻り先は確認ページのみ", () => {
  assert.equal(staffLinkReturnPath({ ok: false }), STAFF_LINK_PATH);
  assert.ok(staffLinkReturnPath({ ok: true, tokenHash: TOK, type: "recovery" }).startsWith(STAFF_LINK_PATH + "?"));
});
test("メール本文: リンクを含み、パスワード・秘密を含まない", () => {
  for (const m of [inviteMailText("https://x/l", "山田"), resetMailText("https://x/l", "山田")]) {
    assert.ok(m.text.includes("https://x/l")); assert.ok(!/パスワード[:：]\s*\S+\s*$/m.test(m.text));
  }
});
test("状態表示: 期限切れ・操作の出し分け（削除は無い）", () => {
  const now = new Date("2026-11-21T00:00:00Z");
  const inv = staffView({ status: "invited", registered_at: "2026-11-10T00:00:00Z", accepted_at: null }, now);
  assert.equal(inv.key, "invited"); assert.deepEqual(inv.actions, ["resend", "rename", "suspend"]);
  const exp = staffView({ status: "invited", registered_at: "2026-11-01T00:00:00Z", accepted_at: null }, now);
  assert.equal(exp.key, "invited_expired"); assert.deepEqual(exp.actions, ["resend", "rename", "suspend"], "期限切れも停止できる");
  assert.equal(staffView({ status: "suspended", registered_at: "2026-11-10T00:00:00Z", accepted_at: null }, now).label, "停止中（未承諾）");
  assert.deepEqual(staffView({ status: "active", registered_at: "x", accepted_at: "y" }, now).actions, ["rename", "password_reset", "suspend"]);
  assert.deepEqual(staffView({ status: "suspended", registered_at: "x", accepted_at: "y" }, now).actions, ["rename", "reactivate"]);
  for (const s of ["invited", "active", "suspended"] as const) assert.ok(!(staffView({ status: s, registered_at: "2026-11-20T00:00:00Z", accepted_at: s === "invited" ? null : "y" }, now).actions as string[]).includes("delete"));
});
test("一覧の解析: 想定外の形は null", () => {
  assert.equal(parseStaffList({}), null); assert.equal(parseStaffList([{ status: "x" }]), null);
  assert.equal(parseStaffList([])?.length, 0);
});
test("DB例外文→画面文言（内部の文は出さない）", () => {
  assert.match(rpcErrorMessage("responsible admin required", "x"), /責任者/);
  assert.equal(rpcErrorMessage("select from secret_table failed", "FB"), "FB");
});

// ---- 認証管理APIの接続 ----
function svc(users: Array<{ id: string; email: string; meta?: Record<string, unknown> }>, opt: { hashed?: string | null } = {}) {
  const calls: string[] = [];
  const api: ServiceAuthAdmin = {
    async listUsers({ page }) { calls.push("list" + page); return { data: { users: page === 1 ? users.map((u) => ({ id: u.id, email: u.email, user_metadata: u.meta })) : [] }, error: null }; },
    async createUser(p) { calls.push("create:" + p.email_confirm); return { data: { user: { id: "NEW" } }, error: null }; },
    async generateLink(p) { calls.push("gen:" + p.type); return { data: { properties: opt.hashed === null ? {} : { hashed_token: opt.hashed ?? TOK } }, error: null }; },
    async deleteUser() { calls.push("del"); return { error: null }; },
  };
  return { api, calls };
}
test("認証接続: 作成はメール未確認・メタ付き／リンクは自サイトURL（Supabaseのaction_linkは使わない）", async () => {
  const s = svc([]); const a = createStaffAuthAdmin(s.api, SITE);
  assert.equal(await a.findByEmail("A@x.test"), null);
  assert.deepEqual(await a.createUser("a@x.test", "R1"), { id: "NEW" });
  assert.ok(s.calls.includes("create:false"));
  assert.ok((await a.generateLink("a@x.test")).link.startsWith("https://staging.example.test/auth/staff-invite?token_hash="));
});
test("認証接続: 既存検索は大文字小文字無視・メタ取得／トークン無しはエラー", async () => {
  const a = createStaffAuthAdmin(svc([{ id: "U1", email: "Ab@X.test", meta: { invite_request_id: "R9" } }]).api, SITE);
  assert.deepEqual(await a.findByEmail("ab@x.test"), { id: "U1", inviteRequestId: "R9" });
  await assert.rejects(() => createStaffAuthAdmin(svc([], { hashed: null }).api, SITE).generateLink("a@x.test"), /auth_link_failed/);
});

// ---- 管理操作の中身 ----
function deps(over: Partial<{ rpc: RpcFn; sent: Array<{ k: string; to: string; link: string; name?: string }>; mailFail: boolean }> = {}) {
  const sent: Array<{ k: string; to: string; link: string; name?: string }> = over.sent ?? [];
  const rpcLog: Array<{ n: string; a: Record<string, unknown> }> = [];
  const rpc: RpcFn = over.rpc ?? (async (n, a) => {
    rpcLog.push({ n, a });
    if (n === "admin_staff_invite_begin") return { data: { status: "started", action: "create_auth" }, error: null };
    if (n === "admin_staff_invite_mark_auth_created") return { data: { ok: true }, error: null };
    if (n === "admin_staff_password_reset_begin") return { data: { ok: true, email: "s@x.test", display_name: "再設定さん" }, error: null };
    if (n === "admin_staff_invite_resend") return { data: { ok: true, status: "invited", email: "reg@x.test", display_name: "登録名" }, error: null };
    return { data: { ok: true, changed: true }, error: null };
  });
  const d: ManageDeps = {
    rpc,
    auth: { findByEmail: async () => null, createUser: async () => ({ id: "NEW" }), generateLink: async () => ({ link: "https://l/x" }), deleteUser: async () => {} },
    mailer: {
      sendInvite: async (to, link, name) => { if (over.mailFail) throw new Error("smtp"); sent.push({ k: "invite", to, link, name }); },
      sendPasswordReset: async (to, link, name) => { if (over.mailFail) throw new Error("smtp"); sent.push({ k: "reset", to, link, name }); },
    },
  };
  return { d, sent, rpcLog };
}
const RID = "11111111-1111-4111-8111-111111111111", UID = "22222222-2222-4222-8222-222222222222";
test("招待: 入力検証→招待→メール。成功文言にリンク・パスワードを含めない", async () => {
  const { d, sent } = deps();
  const r = await inviteCore(d, { requestId: RID, email: " S@X.test ", displayName: "山田" });
  assert.equal(r.ok, true); assert.equal(sent.length, 1); assert.equal(sent[0].to, "s@x.test");
  assert.ok(!r.message.includes("https://"));
  assert.equal((await inviteCore(d, { requestId: "bad", email: "x", displayName: "" })).ok, false);
});
test("招待: メール失敗は登録済み＋再招待案内", async () => {
  const r = await inviteCore(deps({ mailFail: true }).d, { requestId: RID, email: "s@x.test", displayName: "山田" });
  assert.equal(r.ok, false); assert.match(r.message, /再招待/);
});
test("停止/再開/改名: 引数検査・文言", async () => {
  const { d } = deps();
  assert.match((await setStatusCore(d.rpc, UID, "suspended")).message, /停止しました/);
  assert.match((await setStatusCore(d.rpc, UID, "active")).message, /再開しました/);
  assert.equal((await setStatusCore(d.rpc, UID, "deleted")).ok, false);
  assert.equal((await renameCore(d.rpc, UID, "  ")).ok, false);
  assert.equal((await renameCore(d.rpc, UID, "新名")).ok, true);
  const no = await setStatusCore(async () => ({ data: null, error: { message: "responsible admin required" } }), UID, "suspended");
  assert.equal(no.ok, false); assert.match(no.message, /責任者/);
});
test("パスワード再設定: DB許可（有効スタッフのみ・回数制限）を先に、メールは本人宛て、責任者へはリンクを返さない", async () => {
  const { d, sent, rpcLog } = deps();
  const r = await passwordResetCore(d, UID);
  assert.equal(r.ok, true); assert.equal(sent[0].k, "reset"); assert.equal(sent[0].to, "s@x.test"); assert.equal(sent[0].name, "再設定さん", "宛名はDBの登録名");
  assert.equal(rpcLog[0].n, "admin_staff_password_reset_begin");
  assert.ok(!JSON.stringify(r).includes("https://"));
  const lim = await passwordResetCore(deps({ rpc: async () => ({ data: null, error: { message: "too many resets" } }) }).d, UID);
  assert.equal(lim.ok, false); assert.match(lim.message, /1時間/);
  const inv = await passwordResetCore(deps({ rpc: async () => ({ data: null, error: { message: "only an active staff can be reset" } }) }).d, UID);
  assert.match(inv.message, /承諾済み/);
});
test("再招待: 不正な対象は拒否", async () => {
  assert.equal((await resendCore(deps().d, "bad")).ok, false);
});
test("再招待: 宛先はDBが返した登録済みメール。画面から別人のメールを渡しても使われない", async () => {
  const { d, sent } = deps();
  const r = await (resendCore as unknown as (d: ManageDeps, u: unknown, e: unknown) => Promise<{ ok: boolean }>)(d, UID, "victim@x.test");
  assert.equal(r.ok, true); assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "reg@x.test"); assert.equal(sent[0].name, "登録名");
  assert.ok(!sent.some((x) => x.to.includes("victim")));
});
test("招待: 宛名は登録した名前＋様／結果の区切り(settled)と入力欄クリア(clear)", async () => {
  const { d, sent } = deps();
  const r = await inviteCore(d, { requestId: RID, email: "s@x.test", displayName: "山田" });
  assert.equal(sent[0].name, "山田"); assert.equal(r.settled, true); assert.equal(r.clear, true);
  const f = await inviteCore(deps({ mailFail: true }).d, { requestId: RID, email: "s@x.test", displayName: "山田" });
  assert.equal(f.settled, true); assert.equal(f.clear, true); assert.match(f.message, /二重には登録されません/);
  const bad = await inviteCore(d, { requestId: "bad", email: "x", displayName: "" });
  assert.notEqual(bad.settled, true);
  const thrown = await inviteCore(deps({ rpc: async () => ({ data: null, error: { message: "boom" } }) }).d, { requestId: RID, email: "s@x.test", displayName: "山田" });
  assert.notEqual(thrown.settled, true, "想定外の失敗は同じ requestId で再試行できる");
});

// ---- 送信の窓口: 本番相当の無効/保存/外部の区別 ----
test("メール窓口: capture はファイルのみ・disabled は送らない（外部送信なし）", async () => {
  const disabled: MailProvider = { name: "disabled", send: async () => ({ kind: "rejected", error: "disabled" }) };
  await assert.rejects(() => createStaffMailer(disabled).sendInvite("a@x.test", "https://l", "山田"), /mail_rejected/);
  const { mkdtemp, readdir, readFile } = await import("node:fs/promises"); const os = await import("node:os"); const path = await import("node:path");
  const dir = await mkdtemp(path.join(os.tmpdir(), "cap-"));
  await createStaffMailer(new CaptureProvider(dir)).sendPasswordReset("a@x.test", "https://l/z", "山田");
  const f = await readdir(dir); assert.equal(f.length, 1);
  assert.ok(JSON.parse(await readFile(path.join(dir, f[0]), "utf8")).text.includes("https://l/z"));
});
