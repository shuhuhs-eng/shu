import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import Module from "node:module";

// server-only を無効化して data 層を読み込む
const orig = (Module as unknown as { _load: (...a: unknown[]) => unknown })._load;
(Module as unknown as { _load: (...a: unknown[]) => unknown })._load = function (req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return {};
  return orig.call(this, req, ...rest);
};
let dir: typeof import("../lib/admin/directory");
test.before(async () => { dir = await import("../lib/admin/directory"); });

type Call = { fn: string; args?: unknown };
function client(opts: { admin: boolean | "error"; rpcResult?: { data?: unknown; error?: { message: string } | null } }) {
  const calls: Call[] = [];
  return {
    calls,
    rpc: async (fn: string, args?: unknown) => {
      calls.push({ fn, args });
      if (fn === "is_platform_admin") return opts.admin === "error" ? { data: null, error: { message: "x" } } : { data: opts.admin, error: null };
      return { data: opts.rpcResult?.data ?? null, error: opts.rpcResult?.error ?? null };
    },
  };
}
const mkBase = () => ({ q: "", area: dir.parseArea({}), visibility: "", usage: "", page: 1 });

test("運営者でない人は、データ取得のRPCが呼ばれない（forbidden）", async () => {
  for (const admin of [false, "error"] as const) {
    const c = client({ admin });
    const r = await dir.listOrganizations(c as never, mkBase());
    assert.deepEqual(r, { ok: false, reason: "forbidden" });
    assert.ok(c.calls.every((x) => x.fn === "is_platform_admin"), "管理用RPCを呼んでいない");
    assert.deepEqual(await dir.listStylists(c as never, { q: "", residence: mkBase().area, desired: mkBase().area, visibility: "", page: 1 }), { ok: false, reason: "forbidden" });
    assert.deepEqual(await dir.getStylist(c as never, "00000000-0000-0000-0000-00000000e201"), { ok: false, reason: "forbidden" });
    assert.deepEqual(await dir.getOrganization(c as never, "00000000-0000-0000-0000-0000000e0a01"), { ok: false, reason: "forbidden" });
  }
});

test("DBが拒否・失敗した場合は 0件 ではなく ok:false", async () => {
  assert.deepEqual(await dir.listOrganizations(client({ admin: true, rpcResult: { error: { message: "admin access required" } } }) as never, mkBase()), { ok: false, reason: "forbidden" });
  assert.deepEqual(await dir.listOrganizations(client({ admin: true, rpcResult: { error: { message: "boom" } } }) as never, mkBase()), { ok: false, reason: "error" });
  assert.deepEqual(await dir.getOrganization(client({ admin: true, rpcResult: { error: { message: "organization not found" } } }) as never, "00000000-0000-0000-0000-0000000e0a01"), { ok: false, reason: "not_found" });
  const throwing = { rpc: async (fn: string) => { if (fn === "is_platform_admin") return { data: true, error: null }; throw new Error("network"); } };
  assert.deepEqual(await dir.listOrganizations(throwing as never, mkBase()), { ok: false, reason: "error" });
});

test("不正なIDはRPCに渡さず not_found", async () => {
  const c = client({ admin: true });
  assert.deepEqual(await dir.getStylist(c as never, "x'; drop table"), { ok: false, reason: "not_found" });
  assert.equal(c.calls.length, 0);
});

test("地域ブロックは都道府県に展開され、都道府県指定が優先・未設定は別扱い", () => {
  const kanto = dir.parseArea({ region: "関東" });
  assert.equal(kanto.prefectures?.length, 7);
  assert.ok(kanto.prefectures?.includes("神奈川県"));
  assert.deepEqual(dir.parseArea({ region: "関東", pref: "大阪府" }).prefectures, ["大阪府"]);
  assert.deepEqual(dir.parseArea({ pref: "unset" }), { prefectures: null, includeUnset: true, region: "", prefecture: "unset" });
  assert.deepEqual(dir.parseArea({ pref: "どこか", region: "どこか" }).prefectures, null, "表にない値は無視（推測しない）");
  assert.equal(dir.parsePage({ page: "0" }), 1);
  assert.equal(dir.parsePage({ page: "abc" }), 1);
  assert.equal(dir.parsePage({ page: "3" }), 3);
});

test("会社一覧の検索条件が、そのままRPCの引数になる（居住地と勤務希望は別引数）", async () => {
  const c = client({ admin: true, rpcResult: { data: { total: 0, rows: [] } } });
  await dir.listOrganizations(c as never, { q: "渋谷", area: dir.parseArea({ region: "近畿" }), visibility: "PUBLIC", usage: "x", page: 2 });
  const a = c.calls[1].args as Record<string, unknown>;
  assert.equal(a.p_q, "渋谷");
  assert.equal((a.p_prefectures as string[]).length, 7);
  assert.equal(a.p_visibility, "PUBLIC");
  assert.equal(a.p_usage, null, "不正な値はnull");
  assert.equal(a.p_offset, dir.PAGE_SIZE);
  const c2 = client({ admin: true, rpcResult: { data: { total: 0, rows: [] } } });
  await dir.listStylists(c2 as never, { q: "", residence: dir.parseArea({ rpref: "東京都" }, "rpref", "rregion"), desired: dir.parseArea({ dpref: "大阪府" }, "dpref", "dregion"), visibility: "", page: 1 });
  const b = c2.calls[1].args as Record<string, unknown>;
  assert.deepEqual(b.p_residence_prefectures, ["東京都"]);
  assert.deepEqual(b.p_desired_prefectures, ["大阪府"]);
});

function walk(d: string): string[] {
  return readdirSync(d).flatMap((n) => { const p = `${d}/${n}`; return statSync(p).isDirectory() ? walk(p) : [p]; });
}
test("新しい運営ページは、すべて requireAdminPage を最初に呼び、データ取得は lib/admin/directory 経由", () => {
  for (const f of ["app/admin/salons/unassigned/page.tsx", "app/admin/salons/page.tsx", "app/admin/salons/[organizationId]/page.tsx", "app/admin/stylists/page.tsx", "app/admin/stylists/[userId]/page.tsx"]) {
    const s = readFileSync(f, "utf8");
    assert.match(s, /requireAdminPage\(/, f);
    assert.ok(s.indexOf("requireAdminPage(") < s.search(/listOrganizations\(|getOrganization\(|listStylists\(|getStylist\(|listSalonRegistrants\(/), f + ": 権限確認が先");
    assert.ok(!/from\("/.test(s) && !/service/i.test(s), f + ": 直接のテーブル参照・service roleを使わない");
  }
});

test("新しい運営の取得処理は service role を使わず、書き込みもしない", () => {
  const s = readFileSync("lib/admin/directory.ts", "utf8");
  assert.ok(!/createServiceClient|service_role|\.insert\(|\.update\(|\.delete\(/.test(s));
  for (const f of walk("app/admin").filter((x) => /salons|stylists/.test(x))) assert.ok(!/"use server"|\.insert\(|\.update\(/.test(readFileSync(f, "utf8")), f);
});

test("既存の運営ページ（companies・contracts・stripe 等）が残っている", () => {
  for (const p of ["companies", "contracts", "success-fees", "stripe", "issuer-settings", "integrity", "evidence", "legal"]) assert.ok(statSync(`app/admin/${p}/page.tsx`).isFile() || p === "stripe", p);
  const nav = readFileSync("components/admin/admin-nav.tsx", "utf8");
  for (const h of ["/admin/companies", "/admin/contracts", "/admin/success-fees", "/admin/stripe", "/admin/integrity", "/admin/evidence", "/admin/legal", "/admin/salons", "/admin/stylists"]) assert.ok(nav.includes(h), h);
});

test("美容師一覧: 登録状態は許可値だけRPCに渡り、会社未作成の登録者も同じ権限確認を通る", async () => {
  const c = client({ admin: true, rpcResult: { data: { total: 0, rows: [] } } });
  await dir.listStylists(c as never, { q: "", residence: mkBase().area, desired: mkBase().area, visibility: "", state: "in_progress", page: 1 });
  assert.equal((c.calls[1].args as Record<string, unknown>).p_state, "in_progress");
  const c2 = client({ admin: true, rpcResult: { data: { total: 0, rows: [] } } });
  await dir.listStylists(c2 as never, { q: "", residence: mkBase().area, desired: mkBase().area, visibility: "", state: "'; drop", page: 1 });
  assert.equal((c2.calls[1].args as Record<string, unknown>).p_state, null, "不正な値はnull");
  for (const admin of [false, "error"] as const) {
    const c3 = client({ admin });
    assert.deepEqual(await dir.listSalonRegistrants(c3 as never, 1), { ok: false, reason: "forbidden" });
    assert.ok(c3.calls.every((x) => x.fn === "is_platform_admin"));
  }
  const c4 = client({ admin: true, rpcResult: { data: { total: 0, rows: [] } } });
  await dir.listSalonRegistrants(c4 as never, 2);
  assert.equal(c4.calls[1].fn, "admin_list_salon_registrants_without_company");
});
