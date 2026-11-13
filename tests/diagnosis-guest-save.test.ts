/* eslint-disable @typescript-eslint/no-explicit-any */
import test, { after as afterAll } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import {
  isUserCreatedBySignUp,
  issueSignUpBinding,
  verifySignUpBinding,
} from "../lib/diagnosis-handoff/new-account";
import { CLAIM_BINDING_COOKIE, CLAIM_TOKEN_COOKIE, GUEST_NOT_CARRIED_NOTICE_COOKIE, GUEST_SIGNUP_UNVERIFIED_COOKIE } from "../lib/diagnosis-handoff/constants";

process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key-for-hmac";
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
  confirmation_sent_at?: string | null;
  user_metadata: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
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
type Result = { id: string; user_id: string; mode?: string; answers: number[]; created_at: string; source_pending_id: string | null; type_id: string };

const env = {
  users: new Map<string, AuthUser>(),
  sessionUserId: null as string | null,
  cookies: new Map<string, string>(),
  pendings: [] as Pending[],
  results: [] as Result[],
  codes: new Map<string, string>(), // 確認コード -> user id
  omitTimestamps: false, // 実Authが確認メール送信時刻・確認時刻を返さない場合の再現
  signUpMode: "confirm" as "confirm" | "auto" | "existing" | "unconfirmed",
  adminFail: false,
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
  env.omitTimestamps = false;
}
const tick = () => new Date(Date.UTC(2026, 10, 13, 0, 0, 0) + ++env.clock * 1000).toISOString();

class RedirectSignal extends Error {
  constructor(public url: string) {
    super(`redirect:${url}`);
  }
}

function makeUser(email: string, opts: { ageMs?: number; confirmedAgoMs?: number | null; meta?: Record<string, unknown>; noConfirmationSent?: boolean } = {}): AuthUser {
  const now = Date.now();
  const u: AuthUser = {
    id: randomUUID(),
    email,
    created_at: new Date(now - (opts.ageMs ?? 400 * 24 * 3600 * 1000)).toISOString(),
    email_confirmed_at: opts.confirmedAgoMs === null ? null : new Date(now - (opts.confirmedAgoMs ?? 399 * 24 * 3600 * 1000)).toISOString(),
    user_metadata: opts.meta ?? {},
    app_metadata: {},
  } as AuthUser;
  // Supabase は作成時に確認メール送信時刻を付ける（確認不要の設定では付かない想定）
  u.confirmation_sent_at = opts.noConfirmationSent ? null : u.created_at;
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
    const filters: Record<string, unknown> = {};
    const b: any = {
      select: () => b,
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return b;
      },
      limit: async () => ({
        data: table === "diagnosis_results" ? env.results.filter((r: any) => Object.entries(filters).every(([k, v]) => (r as any)[k] === v)) : [],
        error: null,
      }),
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
        if (env.signUpMode === "unconfirmed") {
          // 確認待ち（未確認）の既存ユーザーで再登録: Supabaseは既存ユーザーを返し（作成時刻は過去のまま・identitiesあり）、
          // 送られたメタデータで上書きして確認メールを再送する。
          const old = [...env.users.values()].find((x) => x.email === email)!;
          old.user_metadata = { ...old.user_metadata, ...options.data };
          old.confirmation_sent_at = new Date().toISOString(); // 確認メールの再送時刻だけが今に更新される（作成時刻は古いまま）
          return { data: { user: { ...old, identities: [{ id: "i" }] }, session: null }, error: null };
        }
        const u = makeUser(email, { ageMs: 1000, confirmedAgoMs: env.signUpMode === "auto" ? 1000 : null, meta: options.data, noConfirmationSent: env.signUpMode === "auto" });
        if (env.signUpMode === "auto") env.sessionUserId = u.id;
        if (env.omitTimestamps) { u.confirmation_sent_at = null; u.email_confirmed_at = null; }
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
    auth: {
      admin: {
        updateUserById: async (id: string, attrs: any) => {
          if (env.adminFail) return { data: null, error: { message: "admin down" } };
          const u = [...env.users.values()].find((x: any) => x.id === id);
          if (u) u.app_metadata = { ...(u.app_metadata ?? {}), ...(attrs.app_metadata ?? {}) };
          return { data: { user: u }, error: null };
        },
      },
    },
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
                mode: row.mode,
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
  env.results.push({ id: randomUUID(), user_id: x.id, mode: "stylist", answers: A, created_at: "2026-01-01T00:00:00.000Z", source_pending_id: null, type_id: "A" });
  return x;
}

// ------------------------------------------------------------------ 純粋な判定
test("新規登録の印: サーバー署名つき。作成直後のユーザーにだけ発行され、ユーザーID・トークン・期限が合うときだけ有効", () => {
  const token = randomUUID();
  const now = Date.now();
  const created = (over: Record<string, unknown> = {}) => ({
    id: "user-1",
    created_at: new Date(now - 5_000).toISOString(),
    confirmation_sent_at: new Date(now - 5_000).toISOString(),
    identities: [{ id: "i" }],
    ...over,
  });
  // 発行条件
  const started = now - 6_000; // この要求の開始時刻（作成は要求の1秒後）
  assert.equal(isUserCreatedBySignUp(created(), started, now), true);
  assert.equal(isUserCreatedBySignUp(created({ identities: [] }), started, now), false, "登録済みメールの再登録（identities空）");
  assert.equal(isUserCreatedBySignUp(created({ created_at: new Date(now - 10 * 60_000).toISOString() }), started, now), false, "作成時刻が要求より前（確認待ちの再登録）");
  assert.equal(isUserCreatedBySignUp(created({ created_at: new Date(now - 90_000).toISOString() }), started, now), false, "90秒前に作られた未確認アカウントへの再登録（2分以内でも不可）");
  assert.equal(isUserCreatedBySignUp(created({ app_metadata: { diagnosis_claim_binding_issued_at: "x" } }), started, now), false, "既に印を発行済みのアカウントには発行しない");
  // 要求の1秒前・4秒前に作られた確認待ちアカウントへの再登録（5秒の許容の内側）: 確認メール送信時刻だけが今に更新される
  for (const agoMs of [1_000, 4_000]) {
    const st = now - 100; // この要求の開始
    const reRegistered = created({ created_at: new Date(st - agoMs).toISOString(), confirmation_sent_at: new Date(st + 300).toISOString() });
    assert.equal(isUserCreatedBySignUp(reRegistered, st, now), false, `${agoMs / 1000}秒前に作られた未確認アカウントへの再登録は、5秒の許容内でも新規扱いしない`);
  }
  // 時刻が足りない応答は発行しない（安全側）／確認不要の設定では確認時刻で自己整合を見る
  assert.equal(isUserCreatedBySignUp(created({ confirmation_sent_at: null }), started, now), false, "確認メール送信時刻も確認時刻も無い");
  assert.equal(isUserCreatedBySignUp(created({ confirmation_sent_at: null, email_confirmed_at: new Date(now - 5_000).toISOString() }), started, now), true, "自動確認: 確認時刻が作成と同時");
  assert.equal(isUserCreatedBySignUp(created({ confirmation_sent_at: null, email_confirmed_at: new Date(now - 60_000).toISOString() }), started, now), false, "確認時刻が作成と離れている");
  // 発行済みの記録が無い古い既存アカウント（確認済み・作成時刻が古い）
  assert.equal(isUserCreatedBySignUp(created({ created_at: new Date(now - 400 * 86400_000).toISOString(), confirmation_sent_at: new Date(now - 400 * 86400_000).toISOString() }), started, now), false, "記録のない古い既存アカウント");
  assert.equal(issueSignUpBinding(created({ created_at: new Date(now - 3600_000).toISOString() }), token, started, now), null);
  assert.equal(issueSignUpBinding(created(), undefined, started, now), null, "ゲスト診断なし");
  const b = issueSignUpBinding(created(), token, started, now)!;
  assert.ok(b);
  const mark = (t: string) => ({ diagnosis_claim_binding_for: createHash("sha256").update(t).digest("hex") });
  // 検証は「署名」＋「サーバー側の記録が今のゲスト診断を指す」の両方が必要
  const withMark = { id: "user-1", app_metadata: mark(token) };
  assert.equal(verifySignUpBinding(b, { id: "user-1" }, token, now + 1000), false, "記録が無ければ署名だけでは無効");
  assert.ok(!b.includes(token), "トークンそのものは含まない");
  // 検証
  assert.equal(verifySignUpBinding(b, withMark, token, now + 1000), true);
  assert.equal(verifySignUpBinding(b, { id: "other-user", app_metadata: mark(token) }, token, now + 1000), false, "別のユーザーID");
  assert.equal(verifySignUpBinding(b, withMark, randomUUID(), now + 1000), false, "別のゲスト診断");
  assert.equal(verifySignUpBinding(b, withMark, token, now + 25 * 3600_000), false, "24時間超");
  assert.equal(verifySignUpBinding(undefined, { id: "user-1" }, token, now), false);
  assert.equal(verifySignUpBinding(`${now}.${"0".repeat(64)}`, { id: "user-1" }, token, now), false, "偽造した署名");
  assert.equal(verifySignUpBinding("garbage", { id: "user-1" }, token, now), false);
  // 秘密鍵が無ければ発行も検証もできない（安全側）
  const saved = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert.equal(issueSignUpBinding(created(), token, started, now), null);
  assert.equal(verifySignUpBinding(b, { id: "user-1" }, token, now), false);
  process.env.SUPABASE_SERVICE_ROLE_KEY = saved;
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
  assert.ok(env.cookies.has(CLAIM_BINDING_COOKIE), "サーバー署名の印が発行される");
  assert.deepEqual(Object.keys(created.user_metadata).sort(), ["display_name", "role"], "利用者が書き換えられるメタデータには印を入れない");

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

  // (c) 作成から時間がたった既存ユーザー（印の発行条件を満たさない）には、サーバーは印を発行しない。
  //     確認が遅れた新規会員が24時間を過ぎた場合も、印は無効（ログインして診断をやり直す）。
  resetEnv();
  await guestTakes(D);
  env.signUpMode = "confirm";
  await signUpAction({}, form({ displayName: "L", email: "late@example.test", password: "password-1234", confirmPassword: "password-1234" }));
  const late = [...env.users.values()].find((u) => u.email === "late@example.test")!;
  const realNow = Date.now;
  Date.now = () => realNow() + 25 * 3600_000;
  try {
    env.codes.set("code-late", late.id);
    env.sessionUserId = null;
    await callback("code-late");
  } finally {
    Date.now = realNow;
  }
  assert.equal(resultsOf(late.id).length, 0, "印の有効期限（24時間）を過ぎた新規会員には自動では保存しない");
  assert.ok(env.cookies.has(GUEST_NOT_CARRIED_NOTICE_COOKIE), "引き継げなかったことを、マイページで案内するための目印が付く");

  // (d) パスワード再設定リンク（next あり）では、有効な印があっても引き継がない
  resetEnv();
  await guestTakes(D);
  env.signUpMode = "confirm";
  await signUpAction({}, form({ displayName: "R", email: "reset@example.test", password: "password-1234", confirmPassword: "password-1234" }));
  const fresh = [...env.users.values()].find((u) => u.email === "reset@example.test")!;
  env.codes.set("code-reset", fresh.id);
  env.sessionUserId = null;
  await callback("code-reset", "/update-password");
  assert.equal(resultsOf(fresh.id).length, 0);

  // (e) 既存会員が自分のメタデータを書き換えても（旧方式の印）、引き継がれない
  resetEnv();
  const x2 = makeUser("x2@example.test", { meta: {} });
  await guestTakes(B);
  x2.user_metadata["diagnosis_claim_hash"] = createHash("sha256").update(env.pendings[0].claim_token).digest("hex");
  env.codes.set("code-x2", x2.id);
  env.sessionUserId = null;
  await callback("code-x2");
  assert.equal(resultsOf(x2.id).length, 0);

  // (f) 作成直後の既存会員（作成1秒・確認直後）が、印をメタデータに書き込んでも、引き継がれない
  //     （旧方式では 48時間/10分の窓の中ならすり抜けた）。
  resetEnv();
  const y = makeUser("y@example.test", { ageMs: 1000, confirmedAgoMs: 0, meta: {} });
  await guestTakes(B);
  y.user_metadata["diagnosis_claim_hash"] = createHash("sha256").update(env.pendings[0].claim_token).digest("hex");
  env.codes.set("code-y", y.id);
  env.sessionUserId = null;
  await callback("code-y");
  assert.equal(resultsOf(y.id).length, 0, "メタデータを書き換えても、サーバー署名がないので取り込まれない");
  assert.equal(env.pendings[0].claim_status, "PENDING");

  // (g) 利用者がCookieを自作・他人の印を流用しても、取り込まれない
  resetEnv();
  const z = makeUser("z@example.test", { ageMs: 1000, confirmedAgoMs: 0, meta: {} });
  await guestTakes(B);
  env.cookies.set(CLAIM_BINDING_COOKIE, `${Date.now()}.${"a".repeat(64)}`);
  env.codes.set("code-z", z.id);
  env.sessionUserId = null;
  await callback("code-z");
  assert.equal(resultsOf(z.id).length, 0, "偽造した署名");
  // 別の新規会員Nに発行された本物の印を、既存会員Zが使っても無効
  resetEnv();
  await guestTakes(D);
  env.signUpMode = "confirm";
  await signUpAction({}, form({ displayName: "N", email: "nn@example.test", password: "password-1234", confirmPassword: "password-1234" }));
  const z2 = makeUser("z2@example.test", { ageMs: 1000, confirmedAgoMs: 0, meta: {} });
  env.codes.set("code-z2", z2.id);
  env.sessionUserId = null;
  await callback("code-z2");
  assert.equal(resultsOf(z2.id).length, 0, "他人（新規会員N）の印は、別ユーザーIDには無効");

  // (h) 確認待ち（未確認）のメールでゲスト診断後に再登録しても、取り込まれない（メタデータが上書きされても）
  resetEnv();
  env.signUpMode = "confirm";
  await signUpAction({}, form({ displayName: "U", email: "u@example.test", password: "password-1234", confirmPassword: "password-1234" })); // ゲスト診断なしで先に登録（未確認）
  const u1 = [...env.users.values()].find((u) => u.email === "u@example.test")!;
  u1.created_at = new Date(Date.now() - 3600_000).toISOString(); // 1時間前に作られた確認待ちの会員
  await guestTakes(B);
  env.signUpMode = "unconfirmed";
  await signUpAction({}, form({ displayName: "U", email: "u@example.test", password: "password-1234", confirmPassword: "password-1234" }));
  assert.ok(!env.cookies.has(CLAIM_BINDING_COOKIE), "新しく作られていないので印は発行されない");
  env.codes.set("code-u", u1.id);
  env.sessionUserId = null;
  await callback("code-u");
  assert.equal(resultsOf(u1.id).length, 0, "未確認メールでの再登録では取り込まない");
  assert.equal(env.pendings[0].claim_status, "PENDING");
});

test("再登録の穴: 直前に作られた未確認アカウントへ別のゲスト診断で再登録しても、印は発行されず取り込まれない／印は同じアカウントへ2回出ない", async () => {
  // (i) 30秒前に作られた未確認アカウント（旧方式の「作成2分以内」では印が出てしまう）
  resetEnv();
  env.signUpMode = "confirm";
  await signUpAction({}, form({ displayName: "V", email: "v@example.test", password: "password-1234", confirmPassword: "password-1234" }));
  const v1 = [...env.users.values()].find((u) => u.email === "v@example.test")!;
  v1.created_at = new Date(Date.now() - 30_000).toISOString();
  await guestTakes(D);
  env.signUpMode = "unconfirmed";
  await signUpAction({}, form({ displayName: "V", email: "v@example.test", password: "password-1234", confirmPassword: "password-1234" }));
  assert.ok(!env.cookies.has(CLAIM_BINDING_COOKIE), "既存アカウントには署名を発行しない");
  env.codes.set("code-v", v1.id);
  env.sessionUserId = null;
  await callback("code-v");
  assert.equal(resultsOf(v1.id).length, 0);
  assert.equal(env.pendings[0].claim_status, "PENDING");

  // (j) サーバーだけが書ける記録（app_metadata）を残せないときは、印を出さない（安全側）
  resetEnv();
  await guestTakes(B);
  env.adminFail = true;
  env.signUpMode = "confirm";
  await signUpAction({}, form({ displayName: "W", email: "w@example.test", password: "password-1234", confirmPassword: "password-1234" }));
  assert.ok(!env.cookies.has(CLAIM_BINDING_COOKIE));
  env.adminFail = false;

  // (k) 新規作成の正常系では、印の発行と同時に app_metadata に記録される
  resetEnv();
  await guestTakes(B);
  env.signUpMode = "confirm";
  await signUpAction({}, form({ displayName: "X", email: "x9@example.test", password: "password-1234", confirmPassword: "password-1234" }));
  const x9 = [...env.users.values()].find((u) => u.email === "x9@example.test")!;
  assert.ok(env.cookies.has(CLAIM_BINDING_COOKIE));
  assert.ok((x9 as any).app_metadata.diagnosis_claim_binding_issued_at, "発行済みの記録が残る");
});

test("再登録の穴(2): 1秒前・4秒前に作られた未確認アカウント／記録のない既存アカウント／同時要求でも、有効な印は1つだけ", async () => {
  // (l) 要求の1秒前・4秒前（5秒の許容の内側）に作られた確認待ちアカウントへ、別のゲスト診断で再登録
  for (const agoMs of [1_000, 4_000]) {
    resetEnv();
    env.signUpMode = "confirm";
    await signUpAction({}, form({ displayName: "P", email: `p${agoMs}@example.test`, password: "password-1234", confirmPassword: "password-1234" }));
    const p1 = [...env.users.values()].find((u) => u.email === `p${agoMs}@example.test`)!;
    p1.created_at = new Date(Date.now() - agoMs).toISOString(); // 要求の直前に作られた
    p1.app_metadata = {}; // 記録も無い状態（記録による防御に頼らず、時刻だけで弾けること）
    await guestTakes(D);
    env.signUpMode = "unconfirmed";
    await signUpAction({}, form({ displayName: "P", email: `p${agoMs}@example.test`, password: "password-1234", confirmPassword: "password-1234" }));
    assert.ok(!env.cookies.has(CLAIM_BINDING_COOKIE), `${agoMs / 1000}秒前に作られた未確認アカウントには印を発行しない`);
    env.codes.set("code-p", p1.id);
    env.sessionUserId = null;
    await callback("code-p");
    assert.equal(resultsOf(p1.id).length, 0);
  }
  // (m) 記録（app_metadata）の無い既存アカウント（確認済み・古い）: 再登録は identities が空になり、印は出ない／印を持ち込んでも無効
  resetEnv();
  const old = makeUser("old@example.test", { meta: {} });
  await guestTakes(B);
  env.signUpMode = "existing";
  await signUpAction({}, form({ displayName: "O", email: "old@example.test", password: "password-1234", confirmPassword: "password-1234" }));
  assert.ok(!env.cookies.has(CLAIM_BINDING_COOKIE));
  env.codes.set("code-old", old.id);
  env.sessionUserId = null;
  await callback("code-old");
  assert.equal(resultsOf(old.id).length, 0);
  // (n) 同時要求: 同じ新規アカウントに対し2つの要求が「未発行確認」を両方通り、印をA・Bの2つ発行。記録は最後に書かれたBだけ → Bの印だけが有効
  const tokenA = randomUUID();
  const tokenB = randomUUID();
  const now = Date.now();
  const snap = { id: "race-user", created_at: new Date(now - 1000).toISOString(), confirmation_sent_at: new Date(now - 1000).toISOString(), identities: [{ id: "i" }], app_metadata: {} };
  const bindA = issueSignUpBinding(snap, tokenA, now - 2000, now)!;
  const bindB = issueSignUpBinding(snap, tokenB, now - 2000, now)!;
  assert.ok(bindA && bindB, "両方とも未発行の状態を見て発行できてしまう（競合）");
  const stored = { diagnosis_claim_binding_for: createHash("sha256").update(tokenB).digest("hex") }; // 後から書いた方が残る
  assert.equal(verifySignUpBinding(bindA, { id: "race-user", app_metadata: stored }, tokenA, now + 1000), false, "先に書いた側の印は無効");
  assert.equal(verifySignUpBinding(bindB, { id: "race-user", app_metadata: stored }, tokenB, now + 1000), true, "最後に書かれた1つだけが有効");
  assert.equal(verifySignUpBinding(bindA, { id: "race-user", app_metadata: stored }, tokenB, now + 1000), false, "Aの印をBのトークンに流用しても無効");
});

test("同時要求の順序: Aの取り込みが完了した後にBの記録が更新されても、初回結果は2件にならない（アプリ側のガード。DB側の保証は0058の回数制限SQL）", async () => {
  resetEnv();
  await guestTakes(D);
  env.signUpMode = "confirm";
  await signUpAction({}, form({ displayName: "N", email: "seq@example.test", password: "password-1234", confirmPassword: "password-1234" }));
  const n = [...env.users.values()].find((u) => u.email === "seq@example.test")!;
  // Aの取り込みを開始・完了
  env.codes.set("code-seq", n.id);
  env.sessionUserId = null;
  await callback("code-seq");
  assert.equal(resultsOf(n.id).length, 1);
  assert.equal(env.pendings[0].claim_status, "COMPLETED");
  // その後に、同時に走っていたBの要求が記録を更新し、Bの印を発行した（別ブラウザのCookieを再現）
  await guestTakes(B);
  const tokenB = env.pendings[1].claim_token;
  const snap = { id: n.id, created_at: new Date(Date.now() - 1000).toISOString(), confirmation_sent_at: new Date(Date.now() - 1000).toISOString(), identities: [{ id: "i" }], app_metadata: {} };
  const bindB = issueSignUpBinding(snap, tokenB, Date.now() - 2000, Date.now())!;
  assert.ok(bindB);
  n.app_metadata = { diagnosis_claim_binding_issued_at: new Date().toISOString(), diagnosis_claim_binding_for: createHash("sha256").update(tokenB).digest("hex") };
  env.cookies.set(CLAIM_BINDING_COOKIE, bindB);
  env.codes.set("code-seq2", n.id);
  env.sessionUserId = null;
  await callback("code-seq2");
  assert.equal(resultsOf(n.id).length, 1, "既に結果がある会員には、Bの診断を追加しない");
  assert.deepEqual(latest(n.id).answers, D, "初回結果はAのまま");
  assert.notEqual(env.pendings[1].claim_status, "COMPLETED");
});

test("新規登録の応答が想定と違い、新規作成を確認できなかった場合: 取り込まず、案内は「期限切れ」ではなく「登録の状況を確認できなかった」になる", async () => {
  // 確認メールあり: 登録時に確認できず印なし → 確認リンク後のマイページ案内は unverified
  resetEnv();
  env.omitTimestamps = true;
  await guestTakes(D);
  env.signUpMode = "confirm";
  await signUpAction({}, form({ displayName: "Q", email: "q@example.test", password: "password-1234", confirmPassword: "password-1234" }));
  env.omitTimestamps = false;
  const q = [...env.users.values()].find((u) => u.email === "q@example.test")!;
  assert.ok(!env.cookies.has(CLAIM_BINDING_COOKIE), "印は出ない");
  assert.ok(env.cookies.has(GUEST_SIGNUP_UNVERIFIED_COOKIE), "確認できなかった目印");
  assert.ok(!env.cookies.has(GUEST_NOT_CARRIED_NOTICE_COOKIE), "確認メール待ちの間はまだ案内を出さない");
  env.codes.set("code-q", q.id);
  env.sessionUserId = null;
  await callback("code-q");
  assert.equal(resultsOf(q.id).length, 0, "誤取り込みはしない");
  assert.equal(env.cookies.get(GUEST_NOT_CARRIED_NOTICE_COOKIE), "unverified", "期限切れと誤表示しない");
  assert.ok(!env.cookies.has(GUEST_SIGNUP_UNVERIFIED_COOKIE));

  // 確認メール不要（登録直後にセッションあり）: 登録の時点で unverified の案内になる
  resetEnv();
  env.omitTimestamps = true;
  await guestTakes(D);
  env.signUpMode = "auto";
  await signUpAction({}, form({ displayName: "R", email: "r@example.test", password: "password-1234", confirmPassword: "password-1234" }));
  env.omitTimestamps = false;
  const r = [...env.users.values()].find((u) => u.email === "r@example.test")!;
  assert.equal(resultsOf(r.id).length, 0);
  assert.equal(env.cookies.get(GUEST_NOT_CARRIED_NOTICE_COOKIE), "unverified");

  // 印が出たのに24時間後に確認した場合は、従来どおり expired
  resetEnv();
  await guestTakes(D);
  env.signUpMode = "confirm";
  await signUpAction({}, form({ displayName: "S", email: "s@example.test", password: "password-1234", confirmPassword: "password-1234" }));
  const sUser = [...env.users.values()].find((u) => u.email === "s@example.test")!;
  env.cookies.delete(CLAIM_BINDING_COOKIE); // Cookieの24時間の期限切れ
  env.codes.set("code-s", sUser.id);
  env.sessionUserId = null;
  await callback("code-s");
  assert.equal(resultsOf(sUser.id).length, 0);
  assert.equal(env.cookies.get(GUEST_NOT_CARRIED_NOTICE_COOKIE), "expired");
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

test("期限切れ案内: マイページは、結果がまだ無いときだけ案内を出す（表示専用で、判定には使わない）", () => {
  const page = readFileSync(new URL("../app/stylist/mypage/page.tsx", import.meta.url), "utf8");
  assert.ok(page.includes("GUEST_NOT_CARRIED_NOTICE_COOKIE"));
  assert.ok(page.includes("!latest && guestNotCarried"));
  assert.ok(page.includes("登録の確認までに時間がたったため、保存できませんでした"));
  const claim = readFileSync(new URL("../lib/diagnosis-handoff/claim.ts", import.meta.url), "utf8");
  assert.ok(!claim.includes("GUEST_NOT_CARRIED_NOTICE_COOKIE"), "目印は引き継ぎ判定に使わない");
});
