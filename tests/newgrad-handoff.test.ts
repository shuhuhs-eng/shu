/* eslint-disable @typescript-eslint/no-explicit-any */
import test, { after as afterAll, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key-for-hmac";
process.env.NEWGRAD_ENTRY_ENABLED = "true"; // 新卒の入口は既定で無効。このテストは明示的に有効にして確認する（無効時の挙動は個別のテストで確認）
import { CLAIM_TOKEN_COOKIE } from "../lib/diagnosis-handoff/constants";
import { hashClaimToken, issueSignUpBinding } from "../lib/diagnosis-handoff/new-account";
import { Q_NEWGRAD } from "../lib/diagnosis/newgrad-questions";
import { Q } from "../lib/diagnosis/questions";
import { NEWGRAD_VERSION, questionIdsOf } from "../lib/diagnosis/newgrad";
import { DIAGNOSIS_VERSION } from "../lib/diagnosis/version";

/**
 * 新卒版の引き継ぎ（ゲスト診断の保存→新規登録での取り込み）を、疑似Supabaseで確認する。
 * ★疑似DB・疑似Authでの確認であり、実Supabaseでの確認ではない（実環境の確認は未確認）。
 * 確認すること: 版名の保存／サーバーが版を決める／保存された版で検証・計算／版不明・一時障害でCookieを捨てない／再試行で取り込める／期限を延ばさない／経験者は無変更。
 */
const require = createRequire(__filename);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require("node:module");

type Pending = { id: string; claim_token: string; mode: "stylist" | "salon"; answers: number[]; diagnosis_version: string; created_at: string; expires_at: string; claim_status: string; claimed_by: string | null };
const env = {
  userId: "", cookies: new Map<string, string>(), pendings: [] as Pending[], results: [] as any[],
  startFailures: [] as Array<{ code?: string; message: string }>, // 次の start 呼び出しで順に返す失敗
  startCalls: 0,
  commitFailures: [] as Array<{ code?: string; message: string }>,
  completeFailures: [] as Array<{ code?: string; message: string }>,
};
const cookieStore = {
  get: (name: string) => (env.cookies.has(name) ? { name, value: env.cookies.get(name)! } : undefined),
  set: (name: string, value: string) => void env.cookies.set(name, value),
  delete: (name: string) => void env.cookies.delete(name),
};
const fakeSupabase = () => ({
  auth: { getUser: async () => ({ data: { user: { id: env.userId } }, error: null }), getSession: async () => ({ data: { session: null } }) },
  from: (table: string) => {
    const f: Record<string, unknown> = {};
    const b: any = {
      select: () => b, eq: (c: string, v: unknown) => ((f[c] = v), b),
      limit: async () => ({ data: table === "diagnosis_results" ? env.results.filter((r) => Object.entries(f).every(([k, v]) => r[k] === v)) : [], error: null }),
      maybeSingle: async () => ({ data: table === "diagnosis_results" ? env.results.find((r) => Object.entries(f).every(([k, v]) => r[k] === v)) ?? null : null, error: null }),
    };
    return b;
  },
  rpc: async (name: string, args: any) => {
    if (name === "start_pending_diagnosis_claim") {
      env.startCalls++;
      const fail = env.startFailures.shift();
      if (fail) return { data: null, error: fail };
      const row = env.pendings.find((p) => p.claim_token === args.p_claim_token && p.claim_status === "PENDING" && Date.parse(p.expires_at) > Date.now());
      if (row) { row.claim_status = "PROCESSING"; row.claimed_by = env.userId; return { data: row, error: null }; } // 期限(expires_at)は触らない（実SQLと同じ）
      const again = env.pendings.find((p) => p.claim_token === args.p_claim_token && p.claim_status === "PROCESSING" && p.claimed_by === env.userId);
      if (again) return { data: again, error: null };
      return { data: null, error: { code: "P0001", message: "pending diagnosis not found, claimed by someone else, already completed, or expired" } };
    }
    if (name === "complete_pending_diagnosis_claim") {
      const cf = env.completeFailures.shift();
      if (cf) return { data: null, error: cf };
      const row = env.pendings.find((p) => p.id === args.p_pending_id);
      if (!row || !env.results.some((r) => r.source_pending_id === row.id)) return { data: null, error: { message: "no result" } };
      row.claim_status = "COMPLETED"; return { data: row, error: null };
    }
    return { data: {}, error: null };
  },
});
const fakeService = () => ({
  rpc: async (name: string, a: any) => {
    if (name !== "commit_diagnosis_result") return { data: null, error: { code: "PGRST202", message: "Could not find the function public." + name } };
    const cmf = env.commitFailures.shift();
    if (cmf) return { data: null, error: cmf };
    if (env.results.some((r) => r.user_id === a.p_user_id && r.mode === a.p_mode && r.source_pending_id !== a.p_source_pending_id)) return { data: null, error: { message: "diagnosis_already_saved" } };
    const prior = env.results.find((r) => r.source_pending_id === a.p_source_pending_id);
    if (prior) return { data: { action: "initial", replay: true, result_id: prior.id, locked_until: null }, error: null };
    const r = { id: randomUUID(), user_id: a.p_user_id, mode: a.p_mode, answers: a.p_answers, diagnosis_version: a.p_diagnosis_version, market_value: a.p_market_value, salary_band: a.p_salary_band, source_pending_id: a.p_source_pending_id };
    env.results.push(r);
    return { data: { action: "initial", replay: false, result_id: r.id, locked_until: null }, error: null };
  },
  from: (table: string) => ({ insert: (row: any) => ({ select: () => ({ single: async () => {
    if (table !== "pending_diagnoses") return { data: null, error: { message: "unknown table" } };
    const p: Pending = { id: randomUUID(), claim_token: randomUUID(), mode: row.mode, answers: row.answers, diagnosis_version: row.diagnosis_version, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(), claim_status: "PENDING", claimed_by: null };
    env.pendings.push(p); return { data: p, error: null };
  } }) }) }),
});
const mocks: Record<string, unknown> = {
  "next/headers": { cookies: async () => cookieStore, headers: async () => new Headers() },
  "@/lib/supabase/server": { createClient: async () => fakeSupabase() },
  "@/lib/supabase/service": { createServiceClient: () => fakeService() },
  "@/lib/supabase/token-client": { createTokenClient: () => fakeSupabase() },
  "@/lib/ai/generate-diagnosis-narrative": { generateDiagnosisNarrative: async () => null },
  "@/lib/rate-limit/shared-rate-limiter": { checkSharedRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }) },
};
const originalLoad = Module._load;
Module._load = function (request: string, ...rest: unknown[]) {
  if (request in mocks) return mocks[request];
  if (request === "next/server") { const real = originalLoad.call(this, request, ...rest); return { ...real, after: () => undefined }; }
  return originalLoad.call(this, request, ...rest);
};
afterAll(() => { Module._load = originalLoad; });
const { POST: guestPOST } = require("../app/api/diagnosis/guest/route");
const { claimPendingDiagnosisForNewAccount } = require("../lib/diagnosis-handoff/claim");

const ngAnswers = (): number[] => Q_NEWGRAD.map((q, i) => (i === 0 ? 4 : i % q.opts.length));
const exAnswers = (): number[] => Q.map((q, i) => (i === 0 ? 1 : i % q.opts.length));
const post = (body: unknown) => guestPOST(new Request("https://x.test/api/diagnosis/guest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
const ngDecl = () => ({ setVersion: NEWGRAD_VERSION, questionIds: questionIdsOf("newgrad") });
const exDecl = () => ({ setVersion: DIAGNOSIS_VERSION, questionIds: questionIdsOf("experienced") });

/** 新規登録の直後の状態を作る（印の発行まで）。返り値は claim に渡すユーザーと印。 */
function signedUp(claimToken: string) {
  env.userId = randomUUID();
  const now = Date.now(); const t = new Date(now - 100).toISOString();
  const user = { id: env.userId, created_at: t, confirmation_sent_at: t, identities: [{ id: "i" }], app_metadata: { diagnosis_claim_binding_for: hashClaimToken(claimToken) } };
  const binding = issueSignUpBinding(user as any, claimToken, now - 1000, now)!;
  assert.ok(binding);
  return { user: { id: user.id, created_at: t, app_metadata: user.app_metadata }, binding };
}
const token = () => env.cookies.get(CLAIM_TOKEN_COOKIE)!;
beforeEach(() => { env.cookies.clear(); env.pendings.length = 0; env.results.length = 0; env.startFailures.length = 0; env.startCalls = 0; env.commitFailures.length = 0; env.completeFailures.length = 0; });

test("ゲスト保存: 新卒版は版名 stylist_newgrad_30_v1 で保存し、プレビューの市場価値・年収は null", async () => {
  const res = await post({ mode: "stylist", answers: ngAnswers(), ...ngDecl() });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(env.pendings.length, 1);
  assert.equal(env.pendings[0].diagnosis_version, NEWGRAD_VERSION);
  assert.equal(j.preview.diagnosisVersion, NEWGRAD_VERSION);
  assert.equal(j.preview.marketValueScore, null);
  assert.equal(j.preview.salaryBand, null);
  assert.ok(env.cookies.get(CLAIM_TOKEN_COOKIE));
});

test("ゲスト保存: 経験者版は従来どおり版 1.0.0・市場価値あり。古い画面（申告なし）の送信も受け付ける", async () => {
  for (const decl of [exDecl(), {}]) {
    env.pendings.length = 0;
    const res = await post({ mode: "stylist", answers: exAnswers(), ...decl });
    assert.equal(res.status, 200);
    assert.equal(env.pendings[0].diagnosis_version, DIAGNOSIS_VERSION);
    assert.notEqual((await res.json()).preview.marketValueScore, null);
  }
});

test("ゲスト保存: 版・質問IDの申告がサーバーの決めた並びと違う送信（セットの混在）は保存しない", async () => {
  const bad: Array<[string, unknown]> = [
    ["新卒の回答に経験者の申告", { mode: "stylist", answers: ngAnswers(), ...exDecl() }],
    ["経験者の回答に新卒の申告", { mode: "stylist", answers: exAnswers(), ...ngDecl() }],
    ["新卒の回答で申告なし", { mode: "stylist", answers: ngAnswers() }],
    ["版は新卒・質問IDは経験者", { mode: "stylist", answers: ngAnswers(), setVersion: NEWGRAD_VERSION, questionIds: questionIdsOf("experienced") }],
    ["質問IDの順が違う", { mode: "stylist", answers: ngAnswers(), setVersion: NEWGRAD_VERSION, questionIds: [...questionIdsOf("newgrad")].reverse() }],
  ];
  for (const [name, body] of bad) { const r = await post(body); assert.equal(r.status, 400, name); assert.equal((await r.json()).error, "set_mismatch", name); }
  assert.equal(env.pendings.length, 0, "どれも保存されない");
  // 回答そのものが不正（添字が範囲外・問数違い・1問目が範囲外）は invalid_answers
  for (const answers of [[...ngAnswers().slice(0, 29)], ngAnswers().map((a, i) => (i === 3 ? 9 : a)), ngAnswers().map((a, i) => (i === 0 ? 5 : a))]) {
    const r = await post({ mode: "stylist", answers, ...ngDecl() }); assert.equal(r.status, 400); assert.equal((await r.json()).error, "invalid_answers");
  }
});

test("引き継ぎ: 新卒版は保存された版で検証・計算され、diagnosis_results に新卒の版名・市場価値null で保存される", async () => {
  await post({ mode: "stylist", answers: ngAnswers(), ...ngDecl() });
  const { user, binding } = signedUp(token());
  const r = await claimPendingDiagnosisForNewAccount(user, { binding });
  assert.equal(r.claimed, true);
  assert.equal(env.results.length, 1);
  assert.equal(env.results[0].diagnosis_version, NEWGRAD_VERSION);
  assert.equal(env.results[0].market_value, null);
  assert.equal(env.results[0].salary_band, null);
  assert.equal(env.pendings[0].claim_status, "COMPLETED");
  assert.equal(env.cookies.has(CLAIM_TOKEN_COOKIE), false, "完了したのでCookieを消す");
});

test("引き継ぎ: 経験者版は従来どおり（版1.0.0・市場価値あり）", async () => {
  await post({ mode: "stylist", answers: exAnswers(), ...exDecl() });
  const { user, binding } = signedUp(token());
  assert.equal((await claimPendingDiagnosisForNewAccount(user, { binding })).claimed, true);
  assert.equal(env.results[0].diagnosis_version, DIAGNOSIS_VERSION);
  assert.notEqual(env.results[0].market_value, null);
});

test("引き継ぎ: 版が不明（このコードが知らない版）は、Cookie・保留データ・期限を保ち、版に対応したあとの再試行で取り込める", async () => {
  await post({ mode: "stylist", answers: ngAnswers(), ...ngDecl() });
  const p = env.pendings[0]; const expiresBefore = p.expires_at; const tok = token();
  p.diagnosis_version = "stylist_newgrad_30_v2"; // 新しい版で保存された（このコードは知らない）
  const { user, binding } = signedUp(tok);
  const first = await claimPendingDiagnosisForNewAccount(user, { binding });
  assert.equal(first.claimed, false);
  assert.equal(env.cookies.get(CLAIM_TOKEN_COOKIE), tok, "Cookieを捨てない");
  assert.equal(env.results.length, 0, "何も保存しない（既定の版で決めつけて計算しない）");
  assert.equal(p.expires_at, expiresBefore, "期限を延ばさない");
  assert.notEqual(p.claim_status, "COMPLETED");
  // 版に対応したコードが入った状態を再現し、同じ Cookie・同じ印で再試行
  p.diagnosis_version = NEWGRAD_VERSION;
  const retry = await claimPendingDiagnosisForNewAccount(user, { binding });
  assert.equal(retry.claimed, true, "再試行で取り込める");
  assert.equal(env.results.length, 1);
  assert.equal(p.claim_status, "COMPLETED");
  assert.equal(p.expires_at, expiresBefore);
});

test("引き継ぎ: 版名が無い・空の保留データも、回答の破損とは決めつけない（Cookieを保つ）", async () => {
  await post({ mode: "stylist", answers: ngAnswers(), ...ngDecl() });
  env.pendings[0].diagnosis_version = "";
  const { user, binding } = signedUp(token());
  assert.equal((await claimPendingDiagnosisForNewAccount(user, { binding })).claimed, false);
  assert.ok(env.cookies.get(CLAIM_TOKEN_COOKIE));
});

test("引き継ぎ: 版は分かるのに回答がその版の質問に合わない（破損）は、Cookieを消して取り込まない", async () => {
  for (const answers of [ngAnswers().slice(0, 29), ngAnswers().map((a, i) => (i === 3 ? 9 : a)), exAnswers()]) {
    env.cookies.clear(); env.pendings.length = 0; env.results.length = 0;
    await post({ mode: "stylist", answers: ngAnswers(), ...ngDecl() });
    env.pendings[0].answers = answers; // 版は新卒のまま、回答だけ壊れている（経験者の回答＝1問目が新卒でない場合も破損）
    const { user, binding } = signedUp(token());
    assert.equal((await claimPendingDiagnosisForNewAccount(user, { binding })).claimed, false);
    assert.equal(env.cookies.has(CLAIM_TOKEN_COOKIE), false, "破損は回復しないので消す");
    assert.equal(env.results.length, 0);
  }
});

const NOT_FOUND = "pending diagnosis not found, claimed by someone else, already completed, or expired";

test("引き継ぎ: 開始の失敗が、障害（関数未反映・権限不足・認証の不整合・通信・タイムアウト・不明）の間はCookieを残し、解消後の再試行で、同じ回答が重複なく取り込まれる", async () => {
  const failures: Array<{ code?: string; message: string }> = [
    { code: "PGRST202", message: "Could not find the function public.start_pending_diagnosis_claim(p_claim_token)" },
    { code: "42883", message: "function public.start_pending_diagnosis_claim does not exist" },
    { code: "42501", message: "permission denied for function start_pending_diagnosis_claim" },
    { code: "P0001", message: "not authenticated" },
    { message: "TypeError: fetch failed" },
    { code: "57014", message: "canceling statement due to statement timeout" },
    { code: "XX000", message: "internal error" },
  ];
  await post({ mode: "stylist", answers: ngAnswers(), ...ngDecl() });
  const tok = token(); const { user, binding } = signedUp(tok);
  const p = env.pendings[0]; const expires = p.expires_at;
  for (const f of failures) {
    env.startFailures.push(f);
    const r = await claimPendingDiagnosisForNewAccount(user, { binding });
    assert.equal(r.claimed, false, JSON.stringify(f));
    assert.equal(env.cookies.get(CLAIM_TOKEN_COOKIE), tok, `Cookieを残す: ${JSON.stringify(f)}`);
    assert.equal(env.results.length, 0);
    assert.equal(p.expires_at, expires, "期限は延びない");
  }
  // 障害が解消した → 同じCookie・同じ印で再試行。1件だけ保存される
  assert.equal((await claimPendingDiagnosisForNewAccount(user, { binding })).claimed, true);
  assert.equal(env.results.length, 1, "重複しない");
  assert.equal(env.results[0].source_pending_id, p.id);
  assert.equal(p.claim_status, "COMPLETED");
  assert.equal(env.cookies.has(CLAIM_TOKEN_COOKIE), false);
  // 完了後の再実行（Cookieは無いので何もしない）／Cookieを戻して再実行しても、増えない
  env.cookies.set(CLAIM_TOKEN_COOKIE, tok);
  await claimPendingDiagnosisForNewAccount(user, { binding });
  assert.equal(env.results.length, 1);
});

test("引き継ぎ: 保存（commit）の失敗・完了通知の失敗でもCookieを残し、再試行で重複なく完了する", async () => {
  await post({ mode: "stylist", answers: ngAnswers(), ...ngDecl() });
  const tok = token(); const { user, binding } = signedUp(tok);
  // 保存の失敗（権限不足・関数未反映・通信）→ 何も保存されず、Cookieは残る
  for (const f of [{ code: "42501", message: "permission denied" }, { code: "PGRST202", message: "Could not find the function public.commit_diagnosis_result" }, { message: "fetch failed" }]) {
    env.commitFailures.push(f);
    assert.equal((await claimPendingDiagnosisForNewAccount(user, { binding })).claimed, false);
    assert.equal(env.cookies.get(CLAIM_TOKEN_COOKIE), tok);
  }
  assert.equal(env.results.length, 0);
  // 保存は成功したが、完了通知が失敗 → 結果は1件・Cookieは残る
  env.completeFailures.push({ code: "42501", message: "permission denied for function complete_pending_diagnosis_claim" });
  const first = await claimPendingDiagnosisForNewAccount(user, { binding });
  assert.equal(first.claimed, true);
  assert.equal(env.results.length, 1);
  assert.equal(env.cookies.get(CLAIM_TOKEN_COOKIE), tok, "完了できていないので残す");
  assert.notEqual(env.pendings[0].claim_status, "COMPLETED");
  // 解消後の再試行: 保存済みの行を再利用して完了する（重複しない）
  const second = await claimPendingDiagnosisForNewAccount(user, { binding });
  assert.equal(second.claimed, true);
  assert.equal(env.results.length, 1, "重複しない");
  assert.equal(env.pendings[0].claim_status, "COMPLETED");
  assert.equal(env.cookies.has(CLAIM_TOKEN_COOKIE), false);
});

test("引き継ぎ: Cookieを消すのは、期限切れ・他人が処理中・完了済みなどが明確なときだけ（開始がその例外を返したとき）", async () => {
  // 期限切れ（実SQLと同じ例外）
  await post({ mode: "stylist", answers: ngAnswers(), ...ngDecl() });
  const s1 = signedUp(token());
  env.pendings[0].expires_at = new Date(Date.now() - 1000).toISOString();
  assert.equal((await claimPendingDiagnosisForNewAccount(s1.user, { binding: s1.binding })).claimed, false);
  assert.equal(env.cookies.has(CLAIM_TOKEN_COOKIE), false, "期限切れは消す");
  assert.equal(env.results.length, 0);
  // 他のユーザーが処理中・完了済み → 同じ例外 → 消す
  env.cookies.clear(); env.pendings.length = 0;
  await post({ mode: "stylist", answers: ngAnswers(), ...ngDecl() });
  const s2 = signedUp(token());
  env.pendings[0].claim_status = "PROCESSING"; env.pendings[0].claimed_by = randomUUID();
  assert.equal((await claimPendingDiagnosisForNewAccount(s2.user, { binding: s2.binding })).claimed, false);
  assert.equal(env.cookies.has(CLAIM_TOKEN_COOKIE), false);
  // 例外の本文が違う（'not authenticated' など）P0001 は消さない
  env.cookies.clear(); env.pendings.length = 0;
  await post({ mode: "stylist", answers: ngAnswers(), ...ngDecl() });
  const t = token(); const s3 = signedUp(t);
  env.startFailures.push({ code: "P0001", message: NOT_FOUND.replace("pending", "other") });
  await claimPendingDiagnosisForNewAccount(s3.user, { binding: s3.binding });
  assert.equal(env.cookies.get(CLAIM_TOKEN_COOKIE), t);
});

test("入口が無効（NEWGRAD_ENTRY_ENABLED 未設定＝既定）: 新卒の新規送信だけを拒否し、経験者の送信と、保存済みの新卒保留データの引き継ぎは続く", async () => {
  await post({ mode: "stylist", answers: ngAnswers(), ...ngDecl() }); // 停止前に保存された新卒の保留データ
  const tok = token(); const s = signedUp(tok);
  delete process.env.NEWGRAD_ENTRY_ENABLED; // 無効（既定）
  try {
    const stopped = await post({ mode: "stylist", answers: ngAnswers(), ...ngDecl() });
    assert.equal(stopped.status, 400);
    assert.equal((await stopped.json()).error, "newgrad_disabled");
    assert.equal(env.pendings.length, 1, "停止中の新卒の送信は保存されない");
    assert.equal((await post({ mode: "stylist", answers: exAnswers(), ...exDecl() })).status, 200, "経験者は通常どおり");
    env.cookies.set(CLAIM_TOKEN_COOKIE, tok);
    const r = await claimPendingDiagnosisForNewAccount(s.user, { binding: s.binding });
    assert.equal(r.claimed, true, "停止前に保存した新卒の保留データは、停止中でも取り込める");
    assert.equal(env.results[0].diagnosis_version, NEWGRAD_VERSION);
  } finally { process.env.NEWGRAD_ENTRY_ENABLED = "true"; }
});
