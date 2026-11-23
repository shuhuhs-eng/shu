import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import { renderToStaticMarkup } from "react-dom/server";

// ---- server-only と admin ガードを差し替える（ページを実際に描画して挙動を確認する） ----
type Rpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
const state: { rpc: Rpc; calls: Array<{ fn: string; args?: Record<string, unknown> }>; guard: "admin" | "forbidden" } = {
  rpc: async () => ({ data: null, error: null }), calls: [], guard: "admin",
};
const fakeSupabase = {
  rpc: async (fn: string, args?: Record<string, unknown>) => { state.calls.push({ fn, args }); return state.rpc(fn, args); },
};
const orig = (Module as unknown as { _load: (...a: unknown[]) => unknown })._load;
(Module as unknown as { _load: (...a: unknown[]) => unknown })._load = function (req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return {};
  if (typeof req === "string" && /lib\/admin\/(operator-)?guard$/.test(req)) {
    const enter = async (p: string) => {
      if (state.guard !== "admin") { const e = new Error("NEXT_REDIRECT:/mypage"); (e as { digest?: string }).digest = "NEXT_REDIRECT"; throw e; }
      void p; return { supabase: fakeSupabase, user: { id: "u" }, state: "responsible" };
    };
    return { requireAdminPage: enter, requireAdminOperator: enter };
  }
  return orig.call(this, req, ...rest);
};

type Ops = typeof import("../lib/admin/operations");
let ops: Ops;
test.before(async () => { ops = await import("../lib/admin/operations"); });

function client(rpc: Rpc) {
  const calls: Array<{ fn: string; args?: Record<string, unknown> }> = [];
  return { calls, rpc: async (fn: string, args?: Record<string, unknown>) => { calls.push({ fn, args }); return fn === "is_admin_operator" ? { data: true, error: null } : rpc(fn, args); } };
}
const emptyHiring = { as_of: "2026-11-19T01:00:00Z", total: 0, rows: [] };

// ---------- 期間・条件の解釈 ----------
test("期間: 日本時間の日付。終了日は含め（翌日0時未満）、不正な日付は無視、逆順は invalid", () => {
  const p = ops.parsePeriod({ from: "2026-11-01", to: "2026-11-30" });
  assert.equal(p.from, "2026-11-01T00:00:00+09:00");
  assert.equal(p.to, "2026-12-01T00:00:00+09:00");
  assert.equal(p.invalid, false);
  assert.equal(ops.parsePeriod({ to: "2026-12-31" }).to, "2027-01-01T00:00:00+09:00");
  assert.deepEqual([ops.parsePeriod({ from: "2026-02-30" }).from, ops.parsePeriod({ from: "abc" }).from, ops.parsePeriod({}).from], [null, null, null]);
  assert.equal(ops.parsePeriod({ from: "2026-11-05", to: "2026-11-01" }).invalid, true);
  assert.equal(ops.parsePeriod({ from: "2026-11-05", to: "2026-11-05" }).invalid, false, "同じ日は有効（その日1日）");
});
test("検索条件: 不正な値は既定に戻る。ページは1〜1000", () => {
  assert.equal(ops.parseHiringView({ view: "x" }), "interview_elapsed_not_updated");
  assert.equal(ops.parseHiringView({ view: "all" }), "all");
  assert.equal(ops.parseHiringStatus({ status: "bogus" }), "");
  assert.equal(ops.parseInterestProgress({ progress: "replied" }), "", "「返信済み」という状態は存在しない");
  assert.equal(ops.parseCultureState({ state: "x" }), "");
  assert.equal(ops.parseCultureVisibility({}), "PUBLIC");
  assert.equal(ops.parseCultureVisibility({ vis: "ALL" }), "ALL");
  assert.deepEqual([ops.parseOpsPage({}), ops.parseOpsPage({ page: "0" }), ops.parseOpsPage({ page: "3" }), ops.parseOpsPage({ page: "99999" })], [1, 1, 3, 1]);
});

// ---------- 取得: 権限・失敗・0件の区別 ----------
test("運営者でない: RPCを呼ばず forbidden", async () => {
  const c = { calls: [] as string[], rpc: async (fn: string) => { c.calls.push(fn); return { data: false, error: null }; } };
  const r = await ops.listHiringProcesses(c as never, { view: "all", status: "", period: ops.parsePeriod({}), page: 1 });
  assert.deepEqual(r, { ok: false, reason: "forbidden" });
  assert.deepEqual(c.calls, ["is_admin_operator"]);
});
test("DB側が 'admin access required' を返したら forbidden", async () => {
  const c = client(async () => ({ data: null, error: { message: "admin access required" } }));
  assert.deepEqual(await ops.listStoreInterests(c as never, { progress: "", period: ops.parsePeriod({}), page: 1 }), { ok: false, reason: "forbidden" });
});
test("新RPCが存在しない（PGRST202／42883）: unavailable。0件とは区別する", async () => {
  for (const e of [{ code: "PGRST202", message: "Could not find the function public.admin_list_hiring_processes" }, { code: "42883", message: "function public.x does not exist" }]) {
    const c = client(async () => ({ data: null, error: e }));
    assert.deepEqual(await ops.listHiringProcesses(c as never, { view: "all", status: "", period: ops.parsePeriod({}), page: 1 }), { ok: false, reason: "unavailable" });
  }
});
test("RPCのエラー・想定外の戻り値は error（空の一覧にしない）。正常な空は ok で total=0", async () => {
  const bad = [null, {}, { total: 1 }, { total: 0, rows: "x" }, { total: -1, rows: [] }, { total: 1, rows: [{ process_id: 1 }] }];
  for (const d of bad) {
    const c = client(async () => ({ data: d, error: null }));
    assert.deepEqual(await ops.listHiringProcesses(c as never, { view: "all", status: "", period: ops.parsePeriod({}), page: 1 }), { ok: false, reason: "error" }, JSON.stringify(d));
  }
  const c1 = client(async () => ({ data: null, error: { message: "boom" } }));
  assert.deepEqual(await ops.listCultureReadiness(c1 as never, { state: "", visibility: "PUBLIC", page: 1 }), { ok: false, reason: "error" });
  const c2 = client(async () => { throw new Error("network"); });
  assert.deepEqual(await ops.listStoreInterests(c2 as never, { progress: "", period: ops.parsePeriod({}), page: 1 }), { ok: false, reason: "error" });
  const ok = client(async () => ({ data: emptyHiring, error: null }));
  const r = await ops.listHiringProcesses(ok as never, { view: "all", status: "", period: ops.parsePeriod({}), page: 1 });
  assert.equal(r.ok && r.data.total, 0);
});
test("RPCへ渡す条件: ページ→offset、期間、状態は all のときだけ、PUBLIC/ALL の変換", async () => {
  const c = client(async () => ({ data: emptyHiring, error: null }));
  await ops.listHiringProcesses(c as never, { view: "interview_scheduled", status: "contacting", period: ops.parsePeriod({ from: "2026-11-01", to: "2026-11-02" }), page: 3 });
  const a = c.calls.find((x) => x.fn === "admin_list_hiring_processes")!.args!;
  assert.deepEqual([a.p_view, a.p_status, a.p_from, a.p_to, a.p_limit, a.p_offset], ["interview_scheduled", null, "2026-11-01T00:00:00+09:00", "2026-11-03T00:00:00+09:00", 30, 60]);
  await ops.listHiringProcesses(c as never, { view: "all", status: "hired", period: ops.parsePeriod({}), page: 1 });
  assert.equal(c.calls.filter((x) => x.fn === "admin_list_hiring_processes")[1].args!.p_status, "hired");
  const c2 = client(async () => ({ data: { as_of: "x", total: 0, summary: { stores: 0, no_culture_row: 0, not_completed: 0, completed_match_unready: 0, completed_type_unready: 0, ready: 0 }, rows: [] }, error: null }));
  await ops.listCultureReadiness(c2 as never, { state: "", visibility: "ALL", page: 2 });
  const b = c2.calls.find((x) => x.fn === "admin_list_store_culture_readiness")!.args!;
  assert.deepEqual([b.p_visibility, b.p_state, b.p_offset], [null, null, 30]);
});
test("ダッシュボードの件数: 取得できないものは null（0にしない）。取得できて0件は 0", async () => {
  const c = client(async (fn) => {
    if (fn === "admin_list_hiring_processes") return { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
    if (fn === "admin_list_store_interests") return { data: { as_of: "x", total: 0, legacy_rows_without_store: 0, rows: [] }, error: null };
    return { data: { as_of: "x", total: 3, summary: { stores: 5, no_culture_row: 1, not_completed: 1, completed_match_unready: 1, completed_type_unready: 0, ready: 2 }, rows: [] }, error: null };
  });
  assert.deepEqual(await ops.countOperations(c as never), { elapsedNotUpdated: null, interestsNotCreated: 0, cultureNotReady: 3 });
});

// ---------- ページの描画 ----------
const html = (el: unknown) => renderToStaticMarkup(el as never);
async function render(path: string, sp: Record<string, string> = {}) {
  const mod = await import(path);
  return html(await mod.default({ searchParams: Promise.resolve(sp) }));
}
const hiringRow = {
  process_id: "p1", status: "interview_scheduled", source: "scout", store_id: "s1", store_name: "渋谷店", organization_id: "o1", organization_name: "A社",
  stylist_user_id: "u1", stylist_public_name: "さくら", stylist_full_name: null, interview_at: "2026-11-10T01:00:00Z", interview_type: "online", interview_location: null,
  interview_elapsed_not_updated: true, created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-02T00:00:00Z", hired_at: null, closed_at: null, last_event_at: null,
};

test("面接一覧: 経過・結果未更新の行と、既存の連絡機能・詳細へのリンク。『実施済み』とは書かない", async () => {
  state.guard = "admin";
  state.rpc = async (fn) => (fn === "is_admin_operator" ? { data: true, error: null } : { data: { as_of: "2026-11-19T01:00:00Z", total: 1, rows: [hiringRow] }, error: null });
  const out = await render("../app/admin/interviews/page");
  assert.match(out, /さくら/);
  assert.match(out, /面接予定日時を過ぎて結果が未更新/);
  assert.match(out, /\/admin\/messages\/new\?audience=stylist&amp;recipient=u1/);
  assert.match(out, /\/admin\/messages\/new\?audience=salon&amp;org=o1&amp;store=s1/);
  assert.match(out, /\/admin\/stylists\/u1/);
  assert.match(out, /\/admin\/salons\/o1/);
  assert.ok(!/実施済み/.test(out.replace(/実施されたという意味ではありません/g, "")));
});
test("面接一覧: 0件・取得失敗・RPC不在・非管理者・期間の誤り・ページ送り", async () => {
  state.guard = "admin";
  state.rpc = async (fn) => (fn === "is_admin_operator" ? { data: true, error: null } : { data: emptyHiring, error: null });
  let out = await render("../app/admin/interviews/page");
  assert.match(out, /条件に合う進捗はありません/);
  assert.ok(!/取得できませんでした/.test(out), "正常な0件を取得失敗とは言わない");
  state.rpc = async (fn) => (fn === "is_admin_operator" ? { data: true, error: null } : { data: null, error: { message: "boom" } });
  out = await render("../app/admin/interviews/page");
  assert.match(out, /取得できませんでした/); assert.ok(!/条件に合う進捗はありません/.test(out));
  state.rpc = async (fn) => (fn === "is_admin_operator" ? { data: true, error: null } : { data: null, error: { code: "PGRST202", message: "Could not find the function" } });
  out = await render("../app/admin/interviews/page");
  assert.match(out, /取得できませんでした/); assert.match(out, /まだ使えない状態/); assert.ok(!/条件に合う進捗はありません/.test(out));
  // 期間の誤り: DBを呼ばず入力の誤りを表示（0件とも言わない）
  state.calls = [];
  out = await render("../app/admin/interviews/page", { from: "2026-11-05", to: "2026-11-01" });
  assert.match(out, /開始日が終了日より後です/); assert.ok(!state.calls.some((c) => c.fn === "admin_list_hiring_processes")); assert.ok(!/条件に合う進捗はありません/.test(out));
  // 非管理者: ガードが拒否し、データRPCを呼ばない
  state.guard = "forbidden"; state.calls = [];
  await assert.rejects(() => render("../app/admin/interviews/page"), /NEXT_REDIRECT/);
  await assert.rejects(() => render("../app/admin/interests/page"), /NEXT_REDIRECT/);
  await assert.rejects(() => render("../app/admin/culture-readiness/page"), /NEXT_REDIRECT/);
  assert.equal(state.calls.length, 0);
  // ページ送り: 70件・2ページ目 → 前へ／次へ、期間は引き継ぐ
  state.guard = "admin";
  state.rpc = async (fn) => (fn === "is_admin_operator" ? { data: true, error: null } : { data: { as_of: "2026-11-19T01:00:00Z", total: 70, rows: [hiringRow] }, error: null });
  out = await render("../app/admin/interviews/page", { page: "2", from: "2026-11-01", to: "2026-11-30", view: "interview_scheduled" });
  assert.match(out, /70件中 2 \/ 3 ページ/);
  assert.match(out, /page=1/); assert.match(out, /page=3/);
  assert.match(out, /from=2026-11-01/); assert.match(out, /to=2026-11-30/);
});
test("関心一覧: 進捗未作成／作成済み。『返信済み』を使わない。旧形式の件数・0件・失敗の区別", async () => {
  state.guard = "admin";
  const row = (id: string, ps: "created" | "not_created") => ({ interest_id: id, created_at: "2026-11-15T01:00:00Z", stylist_user_id: "u" + id, stylist_public_name: "名" + id, stylist_full_name: null,
    store_id: "s1", store_name: "渋谷店", organization_id: "o1", organization_name: "A社", progress_state: ps, process_id: ps === "created" ? "p" + id : null, process_status: ps === "created" ? "contacting" : null, process_source: ps === "created" ? "scout" : null });
  state.rpc = async (fn) => (fn === "is_admin_operator" ? { data: true, error: null } : { data: { as_of: "x", total: 2, legacy_rows_without_store: 4, rows: [row("1", "not_created"), row("2", "created")] }, error: null });
  let out = await render("../app/admin/interests/page");
  assert.match(out, /進捗未作成/); assert.match(out, /進捗作成済み/); assert.ok(!/返信済み/.test(out));
  assert.match(out, /旧形式の直接希望が 4件/);
  assert.match(out, /スカウトへの返信/, "進捗の起点を表示（起点がスカウトでも作成済み）");
  assert.match(out, /\/admin\/messages\/new\?audience=stylist&amp;recipient=u1/);
  state.rpc = async (fn) => (fn === "is_admin_operator" ? { data: true, error: null } : { data: { as_of: "x", total: 0, legacy_rows_without_store: 0, rows: [] }, error: null });
  out = await render("../app/admin/interests/page");
  assert.match(out, /条件に合う直接希望はありません/);
  state.rpc = async (fn) => (fn === "is_admin_operator" ? { data: true, error: null } : { data: null, error: { code: "PGRST202", message: "Could not find the function" } });
  out = await render("../app/admin/interests/page");
  assert.match(out, /取得できませんでした/); assert.ok(!/条件に合う直接希望はありません/.test(out));
});
test("診断状況: 状態の内訳・8項目と12項目を別に表示・数値は出さない・失敗の区別", async () => {
  state.guard = "admin";
  const ax = (o: object) => ({ axes_state: "object", absent_keys: [], json_null_keys: [], wrong_type_keys: [], out_of_range_keys: [], unusable_keys: [], ...o });
  const rows = [
    { store_id: "s1", store_name: "S4店", organization_id: "o1", organization_name: "A社", visibility: "PUBLIC", culture_row_exists: true, culture_status: "completed", culture_updated_at: "2026-11-01T00:00:00Z", state: "completed_type_unready",
      match_axes: ax({}), type_axes: ax({ absent_keys: ["premium_value"], unusable_keys: ["premium_value"] }) },
    { store_id: "s2", store_name: "S5店", organization_id: "o1", organization_name: "A社", visibility: "PUBLIC", culture_row_exists: true, culture_status: "completed", culture_updated_at: null, state: "completed_match_unready",
      match_axes: ax({ wrong_type_keys: ["education_support"], unusable_keys: ["education_support"] }), type_axes: ax({ wrong_type_keys: ["education_support"], unusable_keys: ["education_support"] }) },
  ];
  state.rpc = async (fn) => (fn === "is_admin_operator" ? { data: true, error: null } : { data: { as_of: "x", total: 2, summary: { stores: 5, no_culture_row: 1, not_completed: 1, completed_match_unready: 1, completed_type_unready: 1, ready: 1 }, rows }, error: null });
  let out = await render("../app/admin/culture-readiness/page");
  assert.match(out, /対象の店舗 5店/);
  assert.match(out, /相性（8項目）: 問題なし/);
  assert.match(out, /店舗タイプ（12項目）: 使えない項目 1件/);
  assert.match(out, /項目なし: 高付加価値志向/);
  assert.match(out, /数値でない値: 教育への支援/);
  assert.ok(!/premium_value|education_support/.test(out), "内部のキー名は出さない");
  state.rpc = async (fn) => (fn === "is_admin_operator" ? { data: true, error: null } : { data: null, error: { message: "boom" } });
  out = await render("../app/admin/culture-readiness/page");
  assert.match(out, /取得できませんでした/); assert.ok(!/条件に合う店舗はありません/.test(out));
});
test("ダッシュボード: 面接・関心・診断カードは未適用でも残り『取得できませんでした』。0件とは別", async () => {
  const cards = await import("../lib/admin/dashboard-cards");
  const miss = cards.buildOperationCards({ elapsedNotUpdated: null, interestsNotCreated: 0, cultureNotReady: null });
  assert.deepEqual(miss.map((c) => c.value), [null, 0, null]);
  assert.deepEqual(miss.map((c) => c.href), ["/admin/interviews?view=interview_elapsed_not_updated", "/admin/interests?progress=not_created", "/admin/culture-readiness"]);
  assert.equal(cards.cardValueText(miss[0].value), "取得できませんでした");
  assert.equal(cards.cardValueText(miss[1].value), "0件");
});

// ---------- 静的な保証 ----------
const strip = (f: string) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/.*$/gm, "");
test("3画面は運営ガード付き・読み取り専用。連絡の送信・状態変更・通知を持たない", () => {
  for (const f of ["app/admin/interviews/page.tsx", "app/admin/interests/page.tsx", "app/admin/culture-readiness/page.tsx"]) {
    const s = strip(f);
    assert.match(s, /requireAdmin(Page|Operator)\(/, f);
    assert.ok(!/["']use server["']/.test(s), f);
    assert.ok(!/createThreadAction|sendMessage|insert\(|update\(|delete\(|\.from\(/.test(s), f);
    assert.ok(!/返信済み/.test(s), f);
  }
  const lib = strip("lib/admin/operations.ts");
  assert.ok(!/\.from\(|insert\(|update\(|delete\(/.test(lib));
  assert.deepEqual([...new Set([...lib.matchAll(/"(admin_[a-z_]+)"/g)].map((m) => m[1]))].sort(), ["admin_list_hiring_processes", "admin_list_store_culture_readiness", "admin_list_store_interests"]);
});
test("運営ナビ・ダッシュボードから3画面へ到達でき、スカウト消費の処理に触れていない", () => {
  const nav = readFileSync("components/admin/admin-nav.tsx", "utf8");
  for (const h of ["/admin/interviews", "/admin/interests", "/admin/culture-readiness"]) { assert.ok(nav.includes(h), h); assert.ok(readFileSync("app/admin/page.tsx", "utf8").includes(h), h); }
  assert.match(readFileSync("app/admin/page.tsx", "utf8"), /countOperations\(supabase\)/);
  assert.ok(!/scout/i.test(strip("lib/admin/operations.ts").replace(/process_source/g, "")), "スカウトの消費・残高に関する処理を持たない");
});
