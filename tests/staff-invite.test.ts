import test from "node:test";
import assert from "node:assert/strict";
import { inviteStaff, resendStaffInvite, type AuthAdmin, type Deps, type Mailer, type RpcFn } from "../lib/admin/staff-invite";

// DBの招待RPCの状態機械を模した偽物（本物のSQLは verify_staff_v2.py で検証済み。ここは手順の分岐と順序を検証する）
function world(opts: { existing?: { id: string; inviteRequestId: string | null }; usedBeforeRegister?: boolean; crashAfter?: "create" | "mark" | "register"; mailFails?: boolean; deleteFails?: boolean; unsafeAdopt?: boolean } = {}) {
  const log: string[] = [];
  const db = { status: null as null | string, authId: null as null | string, authExists: false };
  let auth: { id: string; inviteRequestId: string | null } | null = opts.existing ?? null;
  const rpc: RpcFn = async (name, args) => {
    log.push("rpc:" + name);
    const ok = (data: unknown) => ({ data, error: null });
    switch (name) {
      case "admin_staff_invite_begin": {
        if (db.status === null) { db.status = "started"; return ok({ status: "started", action: "create_auth" }); }
        const action = ({ started: "create_auth", auth_created: "register", registered: "done", compensating: "compensate", compensation_failed: "compensate" } as Record<string, string>)[db.status] ?? "terminal";
        return ok({ status: db.status, action });
      }
      case "admin_staff_invite_mark_auth_created": {
        if (opts.unsafeAdopt) { db.status = "aborted"; return ok({ ok: false, status: "aborted", may_delete: false }); }
        db.status = "auth_created"; db.authId = String(args.p_auth_user_id); return ok({ ok: true, status: "auth_created" });
      }
      case "admin_staff_invite_register":
        if (opts.usedBeforeRegister) return { data: null, error: { message: "auth user is no longer unused" } };
        db.status = "registered"; return ok({ ok: true, status: "registered" });
      case "admin_staff_invite_compensation_begin":
        if (opts.usedBeforeRegister) { db.status = "compensation_failed"; return ok({ may_delete: false, status: "compensation_failed", reason: "not_deletable" }); }
        db.status = "compensating"; return ok({ may_delete: true, status: "compensating", auth_user_id: db.authId });
      case "admin_staff_invite_compensation_done":
        if (args.p_deleted === true && !auth) { db.status = "compensated"; return ok({ status: "compensated" }); }
        db.status = "compensation_failed"; return ok({ status: "compensation_failed" });
      case "admin_staff_invite_resend": return ok({ ok: true, status: "invited", email: "registered@example.invalid", display_name: "登録名" });
    }
    return { data: null, error: { message: "unknown rpc " + name } };
  };
  const authApi: AuthAdmin = {
    async findByEmail() { log.push("auth:find"); return auth; },
    async createUser(_e, req) { log.push("auth:create"); auth = { id: "AUTH1", inviteRequestId: req }; db.authExists = true; if (opts.crashAfter === "create") throw new Error("crash"); return { id: "AUTH1" }; },
    async generateLink() { log.push("auth:link"); return { link: "https://example.invalid/link" }; },
    async deleteUser() { log.push("auth:delete"); if (opts.deleteFails) throw new Error("delete boom"); auth = null; },
  };
  const mailer: Mailer = { async sendInvite(to, _l, name) { log.push("mail:send"); log.push(`mail:to:${to}:${name}`); if (opts.mailFails) throw new Error("smtp"); } };
  const deps: Deps = { rpc, auth: authApi, mailer };
  return { deps, log, db };
}
const A = { requestId: "11111111-1111-4111-8111-111111111111", email: " Staff@Example.invalid ", displayName: "山田" };
const idx = (log: string[], s: string) => log.indexOf(s);

test("正常: begin → 作成 → 記録 → 登録 → リンク発行 → メール。リンクは登録の後", async () => {
  const w = world(); const r = await inviteStaff(w.deps, A);
  assert.deepEqual(r, { status: "registered", mailed: true });
  assert.ok(idx(w.log, "rpc:admin_staff_invite_register") < idx(w.log, "auth:link"), "リンクは登録の後に発行");
  assert.ok(idx(w.log, "auth:link") < idx(w.log, "mail:send"));
  assert.equal(w.log.filter((x) => x === "auth:create").length, 1);
});
test("ID未記録の中断（作成直後に切れた）: 再実行で既存を見つけて引き継ぎ、二重に作らない", async () => {
  const w = world({ crashAfter: "create" });
  await assert.rejects(() => inviteStaff(w.deps, A), /crash/);
  assert.equal(w.db.status, "started"); assert.equal(w.db.authId, null);          // DBはまだ未記録
  const w2 = { ...w };                                                              // 同じ世界で再実行（crash 設定だけ外す）
  const again = world({ existing: { id: "AUTH1", inviteRequestId: A.requestId } });
  again.db.status = "started";
  const r = await inviteStaff(again.deps, A);
  assert.equal(r.status, "registered");
  assert.equal(again.log.filter((x) => x === "auth:create").length, 0, "既存を引き継ぐので作らない");
  assert.equal(again.db.authId, "AUTH1");
  void w2;
});
test("同じメールの既存アカウントが本操作のものでなければ、採用も削除もせず停止", async () => {
  for (const inviteRequestId of [null, "99999999-9999-4999-8999-999999999999"]) {
    const w = world({ existing: { id: "OTHER", inviteRequestId } });
    const r = await inviteStaff(w.deps, A);
    assert.deepEqual(r, { status: "stopped_unsafe", reason: "existing_user" });
    assert.ok(!w.log.includes("auth:delete") && !w.log.includes("auth:create") && !w.log.includes("rpc:admin_staff_invite_mark_auth_created"));
  }
});
test("DBが採用を拒否（使用済み・証明できない）: 削除せず停止", async () => {
  const w = world({ existing: { id: "X", inviteRequestId: A.requestId }, unsafeAdopt: true });
  w.db.status = "started";
  const r = await inviteStaff(w.deps, A);
  assert.deepEqual(r, { status: "stopped_unsafe", reason: "unsafe_adopt" });
  assert.ok(!w.log.includes("auth:delete") && !w.log.includes("auth:link") && !w.log.includes("mail:send"));
});
test("リンクの先行使用（登録前にログインされた）: 登録失敗→削除せず手動確認。メールは送らない", async () => {
  const w = world({ usedBeforeRegister: true });
  const r = await inviteStaff(w.deps, A);
  assert.deepEqual(r, { status: "compensation_failed", reason: "not_deletable" });
  assert.ok(!w.log.includes("auth:delete") && !w.log.includes("auth:link") && !w.log.includes("mail:send"));
});
test("登録前の失敗で、未使用の作成物は安全に片付く（削除はDBの許可後・結果もDBへ記録）", async () => {
  const w = world();
  const orig = w.deps.rpc;
  let first = true;
  w.deps.rpc = async (n, a) => (n === "admin_staff_invite_register" && first ? ((first = false), { data: null, error: { message: "transient" } }) : orig(n, a));
  const r = await inviteStaff(w.deps, A);
  assert.deepEqual(r, { status: "compensated" });
  assert.ok(idx(w.log, "rpc:admin_staff_invite_compensation_begin") < idx(w.log, "auth:delete"));
  assert.ok(idx(w.log, "auth:delete") < idx(w.log, "rpc:admin_staff_invite_compensation_done"));
});
test("削除に失敗しても完了にしない（DBへ失敗を記録）", async () => {
  const w = world({ deleteFails: true });
  const orig = w.deps.rpc; let first = true;
  w.deps.rpc = async (n, a) => (n === "admin_staff_invite_register" && first ? ((first = false), { data: null, error: { message: "transient" } }) : orig(n, a));
  const r = await inviteStaff(w.deps, A);
  assert.equal(r.status, "compensation_failed");
});
test("登録後にメールだけ失敗: 登録は残り、再送で回復できる（再実行はdone→リンクだけ再送）", async () => {
  const w = world({ mailFails: true });
  const r = await inviteStaff(w.deps, A);
  assert.equal(r.status, "registered_mail_failed");
  assert.equal(w.db.status, "registered");
  const ok = world(); ok.db.status = "registered";
  const r2 = await inviteStaff(ok.deps, A);
  assert.equal(r2.status, "registered");
  assert.ok(!ok.log.includes("auth:create") && !ok.log.includes("rpc:admin_staff_invite_register"));
});
test("終了済みの招待は何もしない（terminal）。補償中の再実行は補償を再開する", async () => {
  const t = world(); t.db.status = "aborted"; assert.deepEqual(await inviteStaff(t.deps, A), { status: "terminal" });
  assert.ok(!t.log.includes("auth:create") && !t.log.includes("mail:send"));
  const c = world(); c.db.status = "compensation_failed"; c.db.authId = "AUTH1";
  const r = await inviteStaff(c.deps, A); assert.ok(r.status === "compensation_failed" || r.status === "compensated");
  assert.ok(c.log.includes("rpc:admin_staff_invite_compensation_begin"));
});
test("再送: DBで期限を更新してから新しいリンクを送る。メール失敗は回復可能な結果として返す", async () => {
  const w = world();
  const r = await resendStaffInvite(w.deps, { userId: "U1" });
  assert.deepEqual(r, { status: "registered", mailed: true });
  assert.ok(w.log.includes("mail:to:registered@example.invalid:登録名"), "宛先と宛名はDBが返した登録済みの値");
  assert.ok(idx(w.log, "rpc:admin_staff_invite_resend") < idx(w.log, "auth:link"));
  const f = world({ mailFails: true });
  assert.equal((await resendStaffInvite(f.deps, { userId: "U1" })).status, "registered_mail_failed");
  const bad = world(); bad.deps.rpc = async () => ({ data: null, error: { message: "only a pending invitation can be resent" } });
  await assert.rejects(() => resendStaffInvite(bad.deps, { userId: "U1" }), /only a pending/);
  assert.ok(!bad.log.includes("mail:send"));
});
test("再送: 画面から別人のメールを渡しても無視される（型でも受け取らない）。DBがメールを返さなければ送らない", async () => {
  const w = world();
  await resendStaffInvite(w.deps, { userId: "U1", email: "victim@example.invalid" } as never);
  assert.ok(!w.log.some((x) => x.includes("victim@example.invalid")));
  assert.ok(w.log.includes("mail:to:registered@example.invalid:登録名"));
  const noMail = world(); const base = noMail.deps.rpc;
  noMail.deps.rpc = async (n, a) => (n === "admin_staff_invite_resend" ? { data: { ok: true }, error: null } : base(n, a));
  await assert.rejects(() => resendStaffInvite(noMail.deps, { userId: "U1" }), /no email/);
  assert.ok(!noMail.log.includes("auth:link") && !noMail.log.includes("mail:send"));
});
test("初回招待メールの宛名は登録した名前", async () => {
  const w = world(); await inviteStaff(w.deps, A);
  assert.ok(w.log.includes("mail:to:staff@example.invalid:山田"));
});
test("DBの失敗(想定外)は握りつぶさず上へ投げる（黙って成功にしない）", async () => {
  const w = world(); w.deps.rpc = async () => ({ data: null, error: { message: "boom" } });
  await assert.rejects(() => inviteStaff(w.deps, A), /boom/);
});
