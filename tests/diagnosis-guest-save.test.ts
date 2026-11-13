/* eslint-disable @typescript-eslint/no-explicit-any */
import test, { after as afterAll } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  hashClaimToken,
  isFreshAccountBoundToClaimToken,
  type AuthUserForClaim,
} from "../lib/diagnosis-handoff/new-account";
import { CLAIM_BINDING_METADATA_KEY, CLAIM_TOKEN_COOKIE } from "../lib/diagnosis-handoff/constants";
import { Q } from "../lib/diagnosis/questions";

/**
 * ゲスト診断の保存条件（実際の signInAction / signUpAction / auth callback / ゲストAPI / ログイン中の保存を、
 * 実Supabaseの代わりにメモリ上の疑似DB・疑似Authで動かして確認する）。
 *
 * ★これは疑似Auth・疑似DBでの確認であり、実際のSupabase Authのメール確認・Cookie・RLSでの確認ではない。
 */

const require = createRequire(__filename);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require("node:module");

// ------------------------------------------------------------------ 疑似環境
type AuthUser = {
  id: string;
  email: string;
  created_at: string;
  email_confirmed_at: string | null;
  user_metadata: Record<string, unknown>;
};
type Pending = {
  id: string;
  claim_token: string;
  mode: "stylist" | "salon";
  answers: number[];
  created_at: string;
  expires_at: string;
  claim_status: "PENDING" | "PROCESSING" | "COMPLETED";
  claimed_by: string | null;
};
type Result = { id: string; user_id: string; answers: number[]; created_at: string; source_pending_id: string | null; type_id: string };

const env = {
  users: new Map<string, AuthUser>(),
  sessionUserId: null as string | null,
  cookies: new Map<string, string>(),
  pendings: [] as Pending[],
  results: [] as Result[],
  codes: new Map<string, string>(), // 確認コード -> user id
  signUpMode: "confirm" as "confirm" | "auto" | "existing",
  failResultInsert: false,
  clock: 0, // 結果の created_at を単調増加させるための刻み
};

function resetEnv() {
  env.users.clear();
  env.sessionUserId = null;
  env.cookies.clear();
  env.pendings.length = 0;
  env.results.length = 0;
  env.codes.clear();
  env.signUpMode = "confirm";
  env.failResultInsert = false;
}
const tick = () => new Date(Date.UTC(2026, 10, 13, 0, 0, 0) + ++env.clock * 1000).toISOString();

class RedirectSignal extends Error {
  constructor(public url: string) {
    super(`redirect:${url}`);
  }
}

function makeUser(email: string, opts: { ageMs?: number; confirmedAgoMs?: number | null; meta?: Record<string, unknown> } = {}): AuthUser {
  const now = Date.now();
  const u: AuthUser = {
    id: randomUUID(),
    email,
    created_at: new Date(now - (opts.ageMs ?? 400 * 24 * 3600 * 1000)).toISOString(),
    email_confirmed_at: opts.confirmedAgoMs === null ? null : new Date(now - (opts.confirmedAgoMs ?? 399 * 24 * 3600 * 1000)).toISOString(),
    user_metadata: opts.meta ?? {},
  };
  env.users.set(u.id, u);
  return u;
}

const cookieStore = {
  get: (name: string) => (env.cookies.has(name) ? { name, value: env.cookies.get(name)! } : undefined),
  set: (name: string, value: string) => void env.cookies.set(name, value),
  delete: (name: string) => void env.cookies.delete(name),
};

function fakeSupabase() {
  const current = () => (env.sessionUserId ? env.users.get(env.sessionUserId) ?? null : null);
  const builder = (table: string) => {
    const b: any = {
      select: () => b,
      eq: () => b,
      single: async () => (table === "profiles" ? { data: { id: env.sessionUserId, role: "stylist", onboarding_step: 4 }, error: null } : { data: null, error: null }),
      maybeSingle: async () => ({ data: null, error: null }),
    };
    return b;
  };
  return {
    auth: {
      getUser: async () => ({ data: { user: current() }, error: null }),
      getSession: async () => ({ data: { session: current() ? { access_token: "tok" } : null } }),
      signInWithPassword: async ({ email }: { email: string }) => {
        const u = [...env.users.values()].find((x) => x.email === email);
        if (!u) return { error: { message: "invalid" } };
        env.sessionUserId = u.id;
        return { error: null };
      },
      exchangeCodeForSession: async (code: string) => {
        const id = env.codes.get(code);
        const u = id ? env.users.get(id) : undefined;
        if (!u) return { error: { message: "bad code" } };
        if (!u.email_confirmed_at) u.email_confirmed_at = new Date().toISOString(); // 初回確認はこの瞬間
        env.sessionUserId = u.id;
        return { error: null };
      },
      signUp: async ({ email, options }: { email: string; options: { data: Record<string, unknown> } }) => {
        if (env.signUpMode === "existing") {
          // 登録済みメールでの再登録: 新しいユーザーは作られず、identities は空
          return { data: { user: { id: randomUUID(), identities: [], user_metadata: options.data }, session: null }, error: null };
        }
        const u = makeUser(email, { ageMs: 1000, confirmedAgoMs: env.signUpMode === "auto" ? 0 : null, meta: options.data });
        if (env.signUpMode === "auto") env.sessionUserId = u.id;
        const user = { ...u, identities: [{ id: "i" }] };
        return { data: { user, session: env.signUpMode === "auto" ? { access_token: "tok" } : null }, error: null };
      },
    },
    from: builder,
    rpc: async (name: string, args: any) => {
      const uid = env.sessionUserId;
      if (!uid) return { data: null, error: { message: "not authenticated" } };
      if (name === "start_pending_diagnosis_claim") {
        const row = env.pendings.find((p) => p.claim_token === args.p_claim_token && p.claim_status === "PENDING" && Date.parse(p.expires_at) > Date.now());
        if (row) {
          row.claim_status = "PROCESSING";
          row.claimed_by = uid;
          return { data: row, error: null };
        }
        const again = env.pendings.find((p) => p.claim_token === args.p_claim_token && p.claim_status === "PROCESSING" && p.claimed_by === uid);
        if (again) return { data: again, error: null };
        return { data: null, error: { message: "pending diagnosis not found" } };
      }
      if (name === "complete_pending_diagnosis_claim") {
        const row = env.pendings.find((p) => p.id === args.p_pending_id && p.claimed_by === uid);
        if (!row || !env.results.some((r) => r.source_pending_id === row.id && r.user_id === uid)) return { data: null, error: { message: "no result" } };
        row.claim_status = "COMPLETED";
        return { data: row, error: null };
      }
      if (name === "save_core_type_result") return { data: {}, error: null };
      return { data: null, error: null };
    },
  };
}

function fakeService() {
  return {
    from: (table: string) => ({
      insert: (row: any) => ({
        select: () => ({
          single: async () => {
            if (table === "pending_diagnoses") {
              const p: Pending = {
                id: randomUUID(),
                claim_token: randomUUID(),
                mode: row.mode,
                answers: row.answers,
                created_at: tick(),
                expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
                claim_status: "PENDING",
                claimed_by: null,
              };
              env.pendings.push(p);
              return { data: p, error: null };
            }
            if (table === "diagnosis_results") {
              if (env.failResultInsert) return { data: null, error: { message: "boom" } };
              const r: Result = {
                id: randomUUID(),
                user_id: row.user_id,
                answers: row.answers,
                created_at: row.created_at ?? tick(),
                source_pending_id: row.source_pending_id ?? null,
                type_id: row.type_id,
              };
              env.results.push(r);
              return { data: r, error: null };
            }
            return { data: null, error: { message: "unknown table" } };
          },
        }),
      }),
    }),
  };
}

const mocks: Record<string, unknown> = {
  "next/headers": { cookies: async () => cookieStore, headers: async () => new Headers() },
  "next/navigation": {
    redirect: (url: string) => {
      throw new RedirectSignal(url);
    },
  },
  "@/lib/supabase/server": { createClient: async () => fakeSupabase() },
  "@/lib/supabase/service": { createServiceClient: () => fakeService() },
  "@/lib/supabase/token-client": { createTokenClient: () => fakeSupabase() },
  "@/lib/ai/generate-diagnosis-narrative": { generateDiagnosisNarrative: async () => null },
  "@/lib/rate-limit/shared-rate-limiter": { checkSharedRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }) },
  "@/lib/auth/signup-rate-limit": {
    checkSignupRateLimit: async () => ({ allowed: true, settle: async () => undefined }),
    signupRateLimitMessage: () => "",
  },
  "@/lib/security/bot-protection": {
    requireCaptchaToken: () => ({ ok: true, captchaToken: undefined }),
    CAPTCHA_REQUIRED_MESSAGE: "captcha",
  },
  "@/lib/site-url": { getSiteUrl: () => "https://example.test" },
};

const originalLoad = Module._load;
Module._load = function (request: string, ...rest: unknown[]) {
  if (request in mocks) return mocks[request];
  if (request === "next/server") {
    const real = originalLoad.call(this, request, ...rest);
    return { ...real, after: () => undefined };
  }
  return originalLoad.call(this, request, ...rest);
};
afterAll(() => {
  Module._load = originalLoad;
});

// 対象（モックを仕込んだ後に読み込む）
const { signInAction, signUpAction } = require("../lib/auth/actions");
const { GET: callbackGET } = require("../app/auth/callback/route");
const { POST: guestPOST } = require("../app/api/diagnosis/guest/route");
const { submitDiagnosisForLoggedInUser } = require("../lib/diagnosis-handoff/submit-logged-in");

// ------------------------------------------------------------------ 補助
const n = Q.length; // 30問
const answersOf = (v: number): number[] => Array.from({ length: n }, () => v);
const A = answersOf(0);
const B = answersOf(1);
const C = answersOf(2);
const D = answersOf(3);

const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};

async function guestTakes(answers: number[]) {
  env.sessionUserId = null;
  const res = await guestPOST(
    new Request("https://example.test/api/diagnosis/guest", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4" },
      body: JSON.stringify({ mode: "stylist", answers }),
    }),
  );
  assert.equal(res.status, 200);
}

async function login(email: string) {
  try {
    await signInAction({}, form({ email, password: "password-1234" }));
  } catch (e) {
    if (!(e instanceof RedirectSignal)) throw e;
    return e.url;
  }
  throw new Error("redirect expected");
}

async function callback(code: string, next?: string) {
  const url = `https://example.test/auth/callback?code=${code}${next ? `&next=${encodeURIComponent(next)}` : ""}`;
  return callbackGET(new Request(url));
}

/** マイページと同じ規則: 最新(created_at降順)1件 */
const latest = (userId: string) =>
  env.results.filter((r) => r.user_id === userId).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
const resultsOf = (userId: string) => env.results.filter((r) => r.user_id === userId);

function seedExistingMemberWithResultA() {
  const x = makeUser("x@example.test");
  env.results.push({ id: randomUUID(), user_id: x.id, answers: A, created_at: "2026-01-01T00:00:00.000Z", source_pending_id: null, type_id: "A" });
  return x;
}

// ------------------------------------------------------------------ 純粋な判定
test("新規アカウント判定: 印・作成直後・確認直後がそろった場合だけ true。既存・古い・別トークン・印なしは false", () => {
  const token = randomUUID();
  const fresh = (over: Partial<AuthUserForClaim> = {}): AuthUserForClaim => ({
    id: "u",
    created_at: new Date(Date.now() - 60_000).toISOString(),
    email_confirmed_at: new Date(Date.now() - 5_000).toISOString(),
    user_metadata: { [CLAIM_BINDING_METADATA_KEY]: hashClaimToken(token) },
    ...over,
  });
  assert.equal(isFreshAccountBoundToClaimToken(fresh(), token), true);
  assert.equal(isFreshAccountBoundToClaimToken(fresh(), randomUUID()), false, "別のトークン");
  assert.equal(isFreshAccountBoundToClaimToken(fresh(), undefined), false, "Cookieなし");
  assert.equal(isFreshAccountBoundToClaimToken(fresh({ user_metadata: {} }), token), false, "登録時の印なし（既存アカウント）");
  assert.equal(
    isFreshAccountBoundToClaimToken(fresh({ email_confirmed_at: new Date(Date.now() - 3 * 3600_000).toISOString() }), token),
    false,
    "確認が10分より前（再ログイン・再設定リンク）",
  );
  assert.equal(isFreshAccountBoundToClaimToken(fresh({ email_confirmed_at: null }), token), false, "未確認");
  assert.equal(
    isFreshAccountBoundToClaimToken(fresh({ created_at: new Date(Date.now() - 3 * 24 * 3600_000).toISOString() }), token),
    false,
    "作成から3日",
  );
  assert.ok(!JSON.stringify(fresh().user_metadata).includes(token), "トークンそのものはメタデータに入れない");
});

// ------------------------------------------------------------------ シナリオ
test("シナリオ1: 結果Aが保存済みの会員が、未ログインで別の結果Bを出してからログインしても、Aのまま（再読み込み・再ログイン後も）", async () => {
  resetEnv();
  const x = seedExistingMemberWithResultA();

  await guestTakes(B);
  assert.equal(env.pendings.length, 1);
  assert.ok(env.cookies.has(CLAIM_TOKEN_COOKIE), "ゲスト診断の保留Cookieが発行される");

  const dest = await login("x@example.test");
  assert.ok(dest.startsWith("/"), "ログインは通常どおり完了する");
  assert.equal(resultsOf(x.id).length, 1, "結果は増えない");
  assert.deepEqual(latest(x.id).answers, A, "最新の結果はAのまま");
  assert.equal(env.pendings[0].claim_status, "PENDING", "ゲスト診断は取り込まれていない");
  assert.equal(env.pendings[0].claimed_by, null);
  assert.ok(!env.cookies.has(CLAIM_TOKEN_COOKIE), "保留Cookieは破棄される（後日の遅延保存を防ぐ）");

  // 再読み込み相当（再取得）と、再ログイン
  assert.deepEqual(latest(x.id).answers, A);
  env.sessionUserId = null;
  await login("x@example.test");
  assert.deepEqual(latest(x.id).answers, A);
  assert.equal(resultsOf(x.id).length, 1);

  // 古いCookieが残っていた場合（破棄前の状態を再現）でも、メール確認コールバック経由で取り込まれない
  env.cookies.set(CLAIM_TOKEN_COOKIE, env.pendings[0].claim_token);
  env.codes.set("code-x", x.id);
  env.sessionUserId = null;
  const res = await callback("code-x");
  assert.equal(res.status, 307);
  assert.equal(resultsOf(x.id).length, 1);
  assert.deepEqual(latest(x.id).answers, A);
  assert.equal(env.pendings[0].claim_status, "PENDING");
});

test("シナリオ1b: 診断結果が無い既存アカウントでも、ログインだけでは保存されない（ログインを同意として扱わない）", async () => {
  resetEnv();
  const y = makeUser("y@example.test");
  await guestTakes(B);
  await login("y@example.test");
  assert.equal(resultsOf(y.id).length, 0);
  assert.equal(env.pendings[0].claim_status, "PENDING");
  assert.ok(!env.cookies.has(CLAIM_TOKEN_COOKIE));
});

test("シナリオ2: ログイン中に受け直して結果Cを保存すると、Cに更新される。保存失敗時は以前の結果のまま失敗を返す", async () => {
  resetEnv();
  const x = seedExistingMemberWithResultA();
  env.sessionUserId = x.id;

  const ok = await submitDiagnosisForLoggedInUser("stylist", C);
  assert.equal(ok.success, true);
  assert.equal(resultsOf(x.id).length, 2);
  assert.deepEqual(latest(x.id).answers, C, "最新の結果はCになる");

  // 再読み込み後（再取得）も、再ログイン後もC
  assert.deepEqual(latest(x.id).answers, C);
  env.sessionUserId = null;
  await login("x@example.test");
  assert.deepEqual(latest(x.id).answers, C);

  // 保存失敗: 以前の結果（C）が維持され、失敗が返る
  env.sessionUserId = x.id;
  env.failResultInsert = true;
  const ng = await submitDiagnosisForLoggedInUser("stylist", D);
  assert.deepEqual(ng, { success: false, error: "save_failed" });
  assert.equal(resultsOf(x.id).length, 2);
  assert.deepEqual(latest(x.id).answers, C);

  // 未ログインでは保存しない
  env.failResultInsert = false;
  env.sessionUserId = null;
  const na = await submitDiagnosisForLoggedInUser("stylist", D);
  assert.deepEqual(na, { success: false, error: "not_authenticated" });
});

test("シナリオ3a: ゲスト診断から新規登録（確認メールあり）した新しい会員に、その初回結果が引き継がれる", async () => {
  resetEnv();
  await guestTakes(D);
  env.signUpMode = "confirm";
  const r = await signUpAction({}, form({ displayName: "新規", email: "new@example.test", password: "password-1234", confirmPassword: "password-1234" }));
  assert.ok(r.success, "確認メール送信の成功");
  const created = [...env.users.values()].find((u) => u.email === "new@example.test")!;
  assert.equal(resultsOf(created.id).length, 0, "確認前は保存されない");
  assert.equal(created.user_metadata[CLAIM_BINDING_METADATA_KEY], hashClaimToken(env.pendings[0].claim_token));

  // 同じブラウザで確認リンクを開く
  env.codes.set("code-new", created.id);
  env.sessionUserId = null;
  const res = await callback("code-new");
  assert.equal(res.status, 307);
  assert.equal(resultsOf(created.id).length, 1);
  assert.deepEqual(latest(created.id).answers, D, "新しい会員の初回結果はゲスト診断D");
  assert.equal(env.pendings[0].claim_status, "COMPLETED");
  assert.equal(env.pendings[0].claimed_by, created.id);
  assert.ok(!env.cookies.has(CLAIM_TOKEN_COOKIE), "完了後にCookieは消える");
});

test("シナリオ3b: メール確認が不要な設定（登録直後にセッションができる）でも、新規アカウントの初回結果として引き継がれる", async () => {
  resetEnv();
  await guestTakes(D);
  env.signUpMode = "auto";
  await signUpAction({}, form({ displayName: "新規", email: "auto@example.test", password: "password-1234", confirmPassword: "password-1234" }));
  const created = [...env.users.values()].find((u) => u.email === "auto@example.test")!;
  assert.equal(resultsOf(created.id).length, 1);
  assert.deepEqual(latest(created.id).answers, D);
  assert.equal(env.pendings[0].claim_status, "COMPLETED");
});

test("シナリオ4: 別アカウント・古い保留結果・再登録・再設定リンクでは、引き継がれない／混ざらない", async () => {
  resetEnv();
  const x = seedExistingMemberWithResultA();

  // (a) 登録済みメールでの再登録は、新規アカウント扱いにしない（何も作られず、保存もされない）
  await guestTakes(B);
  env.signUpMode = "existing";
  const again = await signUpAction({}, form({ displayName: "x", email: "x@example.test", password: "password-1234", confirmPassword: "password-1234" }));
  assert.ok(again.error, "すでに登録済みの案内");
  assert.equal(resultsOf(x.id).length, 1);
  assert.deepEqual(latest(x.id).answers, A);
  assert.equal(env.pendings[0].claim_status, "PENDING");

  // (b) 新規登録Nを作ったが、確認は別のブラウザで行った（このブラウザにはCookieが残る）。
  //     その後、このブラウザで別アカウントMがログイン／確認コールバックを通っても、Nの結果は誰にも紐づかない。
  resetEnv();
  await guestTakes(D);
  env.signUpMode = "confirm";
  await signUpAction({}, form({ displayName: "N", email: "n@example.test", password: "password-1234", confirmPassword: "password-1234" }));
  const nUser = [...env.users.values()].find((u) => u.email === "n@example.test")!;
  const m = makeUser("m@example.test");
  env.codes.set("code-m", m.id);
  env.sessionUserId = null;
  await callback("code-m");
  assert.equal(resultsOf(m.id).length, 0, "別アカウントMには紐づかない");
  assert.equal(env.pendings[0].claim_status, "PENDING", "保留結果は他人に処理されない");
  env.sessionUserId = null;
  await login("m@example.test");
  assert.equal(resultsOf(m.id).length, 0);
  assert.equal(resultsOf(nUser.id).length, 0, "Nへもログインでは保存されない（遅れて自動保存されない）");

  // (c) 作成から3日たった「新規」アカウント（確認が遅れた）は引き継がない
  resetEnv();
  await guestTakes(D);
  const token = env.pendings[0].claim_token;
  const stale = makeUser("stale@example.test", { ageMs: 3 * 24 * 3600_000, confirmedAgoMs: null, meta: { [CLAIM_BINDING_METADATA_KEY]: hashClaimToken(token) } });
  env.cookies.set(CLAIM_TOKEN_COOKIE, token);
  env.codes.set("code-stale", stale.id);
  env.sessionUserId = null;
  await callback("code-stale");
  assert.equal(resultsOf(stale.id).length, 0);

  // (d) パスワード再設定リンク（next あり）では、新規直後で印が一致していても引き継がない
  resetEnv();
  await guestTakes(D);
  const t2 = env.pendings[0].claim_token;
  const fresh = makeUser("reset@example.test", { ageMs: 1000, confirmedAgoMs: null, meta: { [CLAIM_BINDING_METADATA_KEY]: hashClaimToken(t2) } });
  env.codes.set("code-reset", fresh.id);
  env.sessionUserId = null;
  await callback("code-reset", "/update-password");
  assert.equal(resultsOf(fresh.id).length, 0);

  // (e) 既存会員が、他人の保留トークンのハッシュを自分のメタデータに入れても、確認済み（古い）なので引き継がれない
  resetEnv();
  const x2 = makeUser("x2@example.test", { meta: {} });
  await guestTakes(B);
  x2.user_metadata[CLAIM_BINDING_METADATA_KEY] = hashClaimToken(env.pendings[0].claim_token);
  env.codes.set("code-x2", x2.id);
  env.sessionUserId = null;
  await callback("code-x2");
  assert.equal(resultsOf(x2.id).length, 0);
});

// ------------------------------------------------------------------ 構造・文言
test("構造: ログイン処理は引き継ぎを呼ばずCookieを破棄する。引き継ぎの呼び出しは新規登録直後とメール確認だけ", () => {
  const actions = readFileSync("lib/auth/actions.ts", "utf8");
  const signIn = actions.slice(actions.indexOf("export async function signInAction"), actions.indexOf("export async function requestPasswordResetAction"));
  assert.ok(!signIn.includes("claimPendingDiagnosisForNewAccount"));
  assert.ok(signIn.includes("discardGuestDiagnosisCookie()"));
  const claimCalls = actions.match(/claimPendingDiagnosisForNewAccount\(/g) ?? [];
  assert.equal(claimCalls.length, 1, "actions.ts では signUp 直後の1か所だけ");
  const cb = readFileSync("app/auth/callback/route.ts", "utf8");
  assert.match(cb, /confirmedUser && !next/);
  // 古い（無条件の）引き継ぎ関数が残っていない
  for (const f of ["lib/auth/actions.ts", "app/auth/callback/route.ts", "lib/diagnosis-handoff/claim.ts"]) {
    assert.ok(!readFileSync(f, "utf8").includes("claimPendingDiagnosisIfPresent("), f);
  }
});

test("文言: 結果画面に、仕様と食い違う『ログインして今回の結果を保存』の案内が残っていない", () => {
  const page = readFileSync("app/diagnosis/result/page.tsx", "utf8");
  assert.ok(!page.includes("ログインして今回の診断結果を保存"));
  assert.ok(page.includes("ログインしても、今回の結果は保存されません"));
  assert.ok(page.includes("無料登録して診断結果をすべて見る"), "新規登録の導線は維持");
  assert.ok(page.includes("この結果は、あなたのアカウントには保存されていません"));
});
