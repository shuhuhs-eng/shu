import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveMypagePath } from "../lib/auth/mypage-path";
import { getAdminStatus } from "../lib/admin/is-admin";

type Rpc = () => Promise<{ data: unknown; error: unknown }>;
function fake(rpc: Rpc, roles: { data?: { role: string }[] | null; error?: unknown } | "throw" = { data: [] }) {
  const calls: string[] = [];
  return {
    calls,
    rpc: async (fn: string) => { calls.push(fn); return rpc(); },
    from: (t: string) => { calls.push(`from:${t}`); return { select: () => ({ eq: async () => { if (roles === "throw") throw new Error("net"); return { data: roles.data ?? null, error: roles.error ?? null }; } }) }; },
  };
}
const admin: Rpc = async () => ({ data: true, error: null });
const notAdmin: Rpc = async () => ({ data: false, error: null });
const path = async (c: ReturnType<typeof fake>) => resolveMypagePath(c as never, "u1");

test("管理者: サロン用・美容師用どちらのroleの行があっても /admin（roleの行は読まず、書き換えない）", async () => {
  for (const roles of [[], [{ role: "salon" }], [{ role: "stylist" }]]) {
    const c = fake(admin, { data: roles });
    assert.deepEqual(await path(c), { ok: true, path: "/admin" });
    assert.ok(!c.calls.includes("from:user_roles"));
  }
});

test("一般の美容師・サロンは従来どおりのマイページへ", async () => {
  assert.deepEqual(await path(fake(notAdmin, { data: [{ role: "stylist" }] })), { ok: true, path: "/stylist/mypage" });
  assert.deepEqual(await path(fake(notAdmin, { data: [{ role: "salon" }] })), { ok: true, path: "/salon/mypage" });
  assert.deepEqual(await path(fake(notAdmin, { data: [{ role: "salon" }, { role: "stylist" }] })), { ok: true, path: "/stylist/mypage" });
  assert.deepEqual(await path(fake(notAdmin, { data: [] })), { ok: true, path: "/onboarding" });
});

test("管理者権限の確認失敗は『美容師』『オンボーディング』にせず、再試行できるエラー", async () => {
  for (const rpc of [async () => ({ data: null, error: { message: "x" } }), async () => { throw new Error("net"); }, async () => ({ data: null, error: null }), async () => ({ data: "yes", error: null })] as Rpc[]) {
    const c = fake(rpc, { data: [{ role: "stylist" }] });
    assert.deepEqual(await path(c), { ok: false, reason: "admin_check_failed" });
    assert.ok(!c.calls.includes("from:user_roles"));
  }
  assert.equal(await getAdminStatus(fake(async () => ({ data: true, error: { message: "x" } })) as never), "error");
});

test("roleの取得失敗も、オンボーディングへ送らずエラー", async () => {
  assert.deepEqual(await path(fake(notAdmin, { error: { message: "x" } })), { ok: false, reason: "role_check_failed" });
  assert.deepEqual(await path(fake(notAdmin, "throw")), { ok: false, reason: "role_check_failed" });
});

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("メール文字列では判定しない／権限確認は共通処理（is_platform_admin）", () => {
  for (const f of ["lib/auth/mypage-path.ts", "lib/admin/is-admin.ts"]) assert.doesNotMatch(src(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""), /email|@beautyreach|profiles/i, f);
  assert.match(src("lib/admin/is-admin.ts"), /is_platform_admin/);
});

test("/mypage とホームは共通処理を使い、確認失敗は再試行できる表示", () => {
  const m = src("app/mypage/page.tsx");
  assert.match(m, /resolveMypagePath/); assert.match(m, /もう一度試す/);
  assert.doesNotMatch(m, /getUserRoles/);
  const h = src("app/page.tsx");
  assert.match(h, /getAdminStatus/); assert.match(h, /href="\/mypage"/); assert.match(h, /adminCheckFailed/);
  // 役割の判定は「管理者でも確認失敗でもない」場合だけ。確認できなければ別の役割と推測しない（view="check_failed"）
  assert.match(h, /if \(adminStatus === "error"\) view = "check_failed"/);
  assert.match(h, /else if \(isAdmin\) view = "admin"/);
  assert.match(h, /if \(roleError\) view = "check_failed"/);
});

test("管理画面の入口の権限確認は従来どおり（確認できなければ入れない）", () => {
  assert.match(src("lib/admin/is-admin.ts"), /return !error && data === true/);
  assert.match(src("app/admin/page.tsx"), /if \(!isAdmin\) redirect\("\/mypage"\)/);
});
