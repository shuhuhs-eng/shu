import test from "node:test";
import assert from "node:assert/strict";
import { cancelIssuance, issueSalonAccount, resendSetPassword, type IssueDeps } from "../lib/admin/salon-issue";

const RID = "11111111-1111-4111-8111-111111111111";
function fake(opts: { beginStatus?: string; attachError?: string; beginError?: string; mailFail?: boolean; unused?: boolean; list?: unknown[]; cancelData?: unknown } = {}) {
  const calls: string[] = [];
  const d: IssueDeps = {
    rpc: async (n, a) => {
      calls.push("rpc:" + n);
      if (n === "admin_salon_issue_begin") return opts.beginError ? { data: null, error: { message: opts.beginError } } : { data: { status: opts.beginStatus ?? "pending" }, error: null };
      if (n === "admin_salon_issue_attach") return opts.attachError ? { data: null, error: { message: opts.attachError } } : { data: { status: "issued" }, error: null };
      if (n === "admin_salon_issuances_list") return { data: opts.list ?? [], error: null };
      if (n === "admin_salon_issue_cancel") return { data: opts.cancelData ?? { status: "cancelled", auth_user_id: "u-1", repeated: false }, error: null };
      throw new Error("unexpected " + n + JSON.stringify(a));
    },
    auth: { createUser: async (e, m, a) => { calls.push("create:" + e + ":" + m.role); if (a.salon_issue_request_id !== m.issue_request_id) throw new Error("app_metadata mismatch"); return { id: "u-1" }; }, deleteUser: async (id) => { calls.push("delete:" + id); }, isUnused: async () => opts.unused ?? true },
    mailer: { sendSetPassword: async (e) => { calls.push("mail:" + e); if (opts.mailFail) throw new Error("x"); } },
  };
  return { d, calls };
}
const input = { requestId: RID, email: " Owner@Example.COM ", displayName: "サロンA", plan: "campaign" };

test("発行: 記録→アカウント作成(role=salon)→ID記録→メール の順。メールは小文字化、区分の文言を返す", async () => {
  const f = fake(); const r = await issueSalonAccount(f.d, input);
  assert.deepEqual(f.calls, ["rpc:admin_salon_issue_begin", "create:owner@example.com:salon", "rpc:admin_salon_issue_attach", "mail:owner@example.com"]);
  assert.equal(r.ok, true); assert.match(r.message, /キャンペーン登録/); assert.match(r.message, /本部が直接徴収/);
});
test("発行: 入力が不正なら何も呼ばない（区分・メール・サロン名）", async () => {
  for (const bad of [{ ...input, plan: "free" }, { ...input, email: "x" }, { ...input, displayName: "" }, { ...input, requestId: "nope" }]) { const f = fake(); const r = await issueSalonAccount(f.d, bad); assert.equal(r.ok, false); assert.deepEqual(f.calls, []); }
});
test("発行: DBが既存アカウント・手続き中を拒否したら、アカウントを作らない", async () => {
  const f = fake({ beginError: "an account already exists for this email" }); const r = await issueSalonAccount(f.d, input);
  assert.equal(r.ok, false); assert.match(r.message, /既にあります/); assert.deepEqual(f.calls, ["rpc:admin_salon_issue_begin"]);
});
test("発行: ID記録に失敗したら、作ったばかりの未使用アカウントを削除し、メールは送らない", async () => {
  const f = fake({ attachError: "boom" }); const r = await issueSalonAccount(f.d, input);
  assert.equal(r.ok, false); assert.ok(f.calls.includes("delete:u-1")); assert.ok(!f.calls.some((c) => c.startsWith("mail:")));
});
test("発行: メール送信に失敗しても発行は残り、再送を案内する（アカウントは削除しない）", async () => {
  const f = fake({ mailFail: true }); const r = await issueSalonAccount(f.d, input);
  assert.equal(r.ok, false); assert.equal(r.settled, false); assert.match(r.message, /再送/); assert.ok(!f.calls.some((c) => c.startsWith("delete:")));
});
test("発行: 記録済み(issued)の再実行はアカウントを再作成せず、続きのメールだけ送る。取消済み・登録済みは何もしない", async () => {
  const f = fake({ beginStatus: "issued" }); const r = await issueSalonAccount(f.d, input);
  assert.deepEqual(f.calls, ["rpc:admin_salon_issue_begin", "mail:owner@example.com"]); assert.equal(r.ok, true);
  for (const s of ["cancelled", "linked"]) { const g = fake({ beginStatus: s }); await issueSalonAccount(g.d, input); assert.deepEqual(g.calls, ["rpc:admin_salon_issue_begin"]); }
});
test("再送: 宛先は発行の記録から取る（入力から取らない）。会社登録後・取消済みには送らない", async () => {
  const f = fake({ list: [{ request_id: RID, status: "issued", email: "owner@example.com" }] }); assert.equal((await resendSetPassword(f.d, RID)).ok, true); assert.ok(f.calls.includes("mail:owner@example.com"));
  for (const s of ["linked", "cancelled", "pending"]) { const g = fake({ list: [{ request_id: RID, status: s, email: "o@example.com" }] }); assert.equal((await resendSetPassword(g.d, RID)).ok, false); assert.ok(!g.calls.some((c) => c.startsWith("mail:"))); }
});
test("取消: 理由が必須。未使用のアカウントだけ削除し、使用済みは削除しない", async () => {
  assert.equal((await cancelIssuance(fake().d, { requestId: RID, reason: "" })).ok, false);
  const a = fake({ unused: true }); assert.equal((await cancelIssuance(a.d, { requestId: RID, reason: "入力ミス" })).ok, true); assert.ok(a.calls.includes("delete:u-1"));
  const b = fake({ unused: false }); const r = await cancelIssuance(b.d, { requestId: RID, reason: "入力ミス" }); assert.ok(!b.calls.some((c) => c.startsWith("delete:"))); assert.match(r.message, /削除していません/);
});
