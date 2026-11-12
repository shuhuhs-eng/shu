import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  checkTurnstileToken,
  isBotProtectionBypassed,
  requireCaptchaToken,
  verifyBotProtection,
  TURNSTILE_VERIFY_URL,
} from "../lib/security/bot-protection";
import { resolveSiteUrl, SiteUrlError, siteUrlProblem } from "../lib/site-url";
import { collectEnvProblems, formatEnvFailure } from "../lib/env/validate";
import { checkSharedRateLimit, hashRateLimitKey } from "../lib/rate-limit/shared-rate-limiter";
import { getClientIpFromHeaders } from "../lib/rate-limit/memory-rate-limiter";
import { verifyCronAuth } from "../lib/cron/auth";
import { classifyCaptchaProbe } from "../lib/security/captcha-probe";

const fd = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};
const okFetch = (success: boolean, calls: { url: string; body: string }[] = []) =>
  (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body) });
    return new Response(JSON.stringify({ success }), { status: 200 });
  }) as unknown as typeof fetch;

// ---- B. Bot対策: production でトークン無しは拒否 / fail-closed ----------------------------------
test("B: production でトークン無しは拒否（secretがあっても）", async () => {
  const env = { NODE_ENV: "production", TURNSTILE_SECRET_KEY: "s" };
  const r = await checkTurnstileToken(null, "1.1.1.1", { env, fetchImpl: okFetch(true) });
  assert.deepEqual(r, { ok: false, reason: "missing_token" });
  assert.equal((await checkTurnstileToken("   ", null, { env, fetchImpl: okFetch(true) })).ok, false);
  assert.equal((await checkTurnstileToken("x".repeat(3000), null, { env, fetchImpl: okFetch(true) })).ok, false);
});
test("B: production で secret 未設定は拒否（fail-open禁止）", async () => {
  const r = await checkTurnstileToken("tok", null, { env: { NODE_ENV: "production" }, fetchImpl: okFetch(true) });
  assert.deepEqual(r, { ok: false, reason: "not_configured" });
});
test("B: siteverify の成功だけ通す。失敗・非200・ネットワーク断・不正JSONは拒否", async () => {
  const env = { NODE_ENV: "production", TURNSTILE_SECRET_KEY: "sec" };
  const calls: { url: string; body: string }[] = [];
  assert.equal((await checkTurnstileToken("tok", "9.9.9.9", { env, fetchImpl: okFetch(true, calls) })).ok, true);
  assert.equal(calls[0]!.url, TURNSTILE_VERIFY_URL);
  assert.ok(calls[0]!.body.includes("secret=sec") && calls[0]!.body.includes("response=tok") && calls[0]!.body.includes("remoteip=9.9.9.9"));
  assert.deepEqual(await checkTurnstileToken("tok", null, { env, fetchImpl: okFetch(false) }), { ok: false, reason: "rejected" });
  const non200 = (async () => new Response("x", { status: 500 })) as unknown as typeof fetch;
  assert.deepEqual(await checkTurnstileToken("tok", null, { env, fetchImpl: non200 }), { ok: false, reason: "unreachable" });
  const boom = (async () => { throw new Error("net"); }) as unknown as typeof fetch;
  assert.deepEqual(await checkTurnstileToken("tok", null, { env, fetchImpl: boom }), { ok: false, reason: "unreachable" });
  const badJson = (async () => new Response("not json", { status: 200 })) as unknown as typeof fetch;
  assert.deepEqual(await checkTurnstileToken("tok", null, { env, fetchImpl: badJson }), { ok: false, reason: "unreachable" });
  // success が true 以外（"true" 文字列など）は通さない
  const strTrue = (async () => new Response(JSON.stringify({ success: "true" }), { status: 200 })) as unknown as typeof fetch;
  assert.equal((await checkTurnstileToken("tok", null, { env, fetchImpl: strTrue })).ok, false);
});
test("B: 開発bypassは明示フラグ(true)のときだけ。productionでは絶対に無効", async () => {
  assert.equal(isBotProtectionBypassed({ NODE_ENV: "development", BOT_PROTECTION_DEV_BYPASS: "true" }), true);
  assert.equal(isBotProtectionBypassed({ NODE_ENV: "development" }), false);
  assert.equal(isBotProtectionBypassed({ NODE_ENV: "development", BOT_PROTECTION_DEV_BYPASS: "1" }), false);
  assert.equal(isBotProtectionBypassed({ NODE_ENV: "production", BOT_PROTECTION_DEV_BYPASS: "true" }), false);
  // production + bypass フラグがあっても、トークン無し・secret無しは拒否される
  const prodBypass = { NODE_ENV: "production", BOT_PROTECTION_DEV_BYPASS: "true" };
  assert.equal((await checkTurnstileToken(null, null, { env: prodBypass })).ok, false);
  assert.equal((await checkTurnstileToken("tok", null, { env: prodBypass })).ok, false);
  // 開発のbypassは通る / bypassなしの開発でsecret無しは拒否
  assert.equal((await checkTurnstileToken(null, null, { env: { NODE_ENV: "development", BOT_PROTECTION_DEV_BYPASS: "true" } })).ok, true);
  assert.equal((await checkTurnstileToken(null, null, { env: { NODE_ENV: "development" } })).ok, false);
});
test("B: requireCaptchaToken（Supabase Authへ渡す前のチェック）", () => {
  const prod = { NODE_ENV: "production" };
  assert.deepEqual(requireCaptchaToken(fd({}), prod), { ok: false });
  assert.deepEqual(requireCaptchaToken(fd({ "cf-turnstile-response": "  " }), prod), { ok: false });
  assert.deepEqual(requireCaptchaToken(fd({ "cf-turnstile-response": "abc" }), prod), { ok: true, captchaToken: "abc" });
  assert.deepEqual(requireCaptchaToken(fd({}), { NODE_ENV: "production", BOT_PROTECTION_DEV_BYPASS: "true" }), { ok: false });
  assert.deepEqual(requireCaptchaToken(fd({}), { NODE_ENV: "development", BOT_PROTECTION_DEV_BYPASS: "true" }), { ok: true, captchaToken: undefined });
  assert.deepEqual(requireCaptchaToken(fd({}), { NODE_ENV: "development" }), { ok: false });
});
test("B: verifyBotProtection は拒否時に secret/token をログへ出さない", async () => {
  const out: unknown[][] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => { out.push(a); };
  try {
    await verifyBotProtection("TOKEN-VALUE", "1.1.1.1", { env: { NODE_ENV: "production", TURNSTILE_SECRET_KEY: "SECRET-VALUE" }, fetchImpl: (async () => { throw new Error("net"); }) as unknown as typeof fetch });
  } finally { console.error = orig; }
  assert.ok(!JSON.stringify(out).includes("SECRET-VALUE") && !JSON.stringify(out).includes("TOKEN-VALUE"));
});

// ---- M / N. production URL ------------------------------------------------------------------------
test("M: production で NEXT_PUBLIC_SITE_URL が 未設定/localhost/不正/http は fail-fast", () => {
  const prod = { NODE_ENV: "production" } as const;
  for (const bad of [undefined, "", "   ", "http://localhost:3000", "https://localhost", "https://127.0.0.1", "https://0.0.0.0", "https://app.localhost", "not a url", "http://example.com", "https://u:p@example.com"]) {
    assert.throws(() => resolveSiteUrl({ ...prod, NEXT_PUBLIC_SITE_URL: bad }), SiteUrlError, String(bad));
  }
  assert.equal(resolveSiteUrl({ ...prod, NEXT_PUBLIC_SITE_URL: "https://app.example.com/" }), "https://app.example.com");
  assert.equal(resolveSiteUrl({ ...prod, NEXT_PUBLIC_SITE_URL: "https://app.example.com" }), "https://app.example.com");
  assert.equal(siteUrlProblem("https://app.example.com"), null);
});
test("N: development では localhost を許可（未設定ならフォールバック）", () => {
  assert.equal(resolveSiteUrl({ NODE_ENV: "development" }), "http://localhost:3000");
  assert.equal(resolveSiteUrl({ NODE_ENV: "development", NEXT_PUBLIC_SITE_URL: "http://localhost:4000/" }), "http://localhost:4000");
  assert.equal(resolveSiteUrl({ NODE_ENV: "test" }), "http://localhost:3000");
});

// ---- E. env fail-fast / Stripe Test/Live ----------------------------------------------------------
const GOOD_PROD = {
  NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "svc",
  NEXT_PUBLIC_SITE_URL: "https://app.example.com",
  CRON_SECRET: "c",
  ANTHROPIC_API_KEY: "a",
  LEGAL_OPERATOR_NAME: "n",
  LEGAL_OPERATOR_ADDRESS: "a",
  LEGAL_CONTACT_EMAIL: "e@example.com",
  LEGAL_EFFECTIVE_DATE: "2026-12-01",
  STRIPE_SECRET_KEY: "sk_live_abc",
  STRIPE_WEBHOOK_SECRET: "whsec_abc",
  STRIPE_ALLOW_LIVE_MODE: "true",
  TURNSTILE_SECRET_KEY: "t",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "k",
};
test("E: 正しい本番設定は問題なし", () => {
  assert.deepEqual(collectEnvProblems(GOOD_PROD, true).filter((p) => p.level === "error"), []);
});
test("E: 本番の必須環境変数の不足は error（6つ+Turnstile）", () => {
  for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SITE_URL", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "TURNSTILE_SECRET_KEY", "NEXT_PUBLIC_TURNSTILE_SITE_KEY"]) {
    const env = { ...GOOD_PROD } as Record<string, string | undefined>;
    delete env[key];
    const errors = collectEnvProblems(env, true).filter((p) => p.level === "error");
    assert.ok(errors.some((p) => p.key === key), key);
  }
});
test("E: 本番でBOT_PROTECTION_DEV_BYPASSが設定されていたら error / 開発では問題なし", () => {
  assert.ok(collectEnvProblems({ ...GOOD_PROD, BOT_PROTECTION_DEV_BYPASS: "true" }, true).some((p) => p.key === "BOT_PROTECTION_DEV_BYPASS" && p.level === "error"));
  assert.ok(!collectEnvProblems({ BOT_PROTECTION_DEV_BYPASS: "true" }, false).some((p) => p.level === "error"));
});
test("E: Test/Live鍵の混在・Live安全装置(P)", () => {
  // P: live鍵は STRIPE_ALLOW_LIVE_MODE=true が無ければ error（安全装置を維持）
  const noFlag = { ...GOOD_PROD } as Record<string, string | undefined>;
  delete noFlag.STRIPE_ALLOW_LIVE_MODE;
  assert.ok(collectEnvProblems(noFlag, true).some((p) => p.key === "STRIPE_ALLOW_LIVE_MODE" && p.level === "error"));
  // 混在: Test鍵 + ALLOW_LIVE_MODE=true
  assert.ok(collectEnvProblems({ ...GOOD_PROD, STRIPE_SECRET_KEY: "sk_test_abc" }, true).some((p) => p.key === "STRIPE_SECRET_KEY" && /混在/.test(p.message)));
  // Test鍵のみ（Test Mode）は問題なし（O）
  const testMode = { ...GOOD_PROD, STRIPE_SECRET_KEY: "sk_test_abc" } as Record<string, string | undefined>;
  delete testMode.STRIPE_ALLOW_LIVE_MODE;
  assert.deepEqual(collectEnvProblems(testMode, true).filter((p) => p.level === "error"), []);
  // 公開可能キーは拒否
  assert.ok(collectEnvProblems({ ...GOOD_PROD, STRIPE_SECRET_KEY: "pk_live_abc" }, true).some((p) => p.key === "STRIPE_SECRET_KEY" && p.level === "error"));
});
test("E: エラー文・起動失敗メッセージに秘密値を含めない", () => {
  const env = { ...GOOD_PROD, STRIPE_SECRET_KEY: "sk_live_SECRET-VALUE", STRIPE_WEBHOOK_SECRET: "bad-SECRET-VALUE", SUPABASE_SERVICE_ROLE_KEY: "svc-SECRET-VALUE", NEXT_PUBLIC_SITE_URL: "http://localhost:3000" };
  const errors = collectEnvProblems(env, true).filter((p) => p.level === "error");
  assert.ok(errors.length > 0);
  assert.ok(errors.every((p) => !p.message.includes("SECRET-VALUE")));
  assert.ok(!formatEnvFailure(errors).includes("SECRET-VALUE"));
});

// ---- A. 共有レート制限 ----------------------------------------------------------------------------
test("A: 共有レート制限 — RPCの結果に従い、キーはSHA-256化して送る（生値を送らない）", async () => {
  const sent: { p_key_hash: string; p_limit: number; p_window_seconds: number }[] = [];
  const mk = (allowed: boolean, retry: number) => async (_fn: "check_rate_limit", args: { p_key_hash: string; p_limit: number; p_window_seconds: number }) => {
    sent.push(args);
    return { data: [{ allowed, retry_after_seconds: retry }], error: null };
  };
  const ok = await checkSharedRateLimit("signup:email:a@b.example", 3, 3_600_000, { rpc: mk(true, 0) });
  assert.deepEqual(ok, { allowed: true, retryAfterSeconds: 0 });
  const ng = await checkSharedRateLimit("signup:email:a@b.example", 3, 3_600_000, { rpc: mk(false, 120) });
  assert.deepEqual(ng, { allowed: false, retryAfterSeconds: 120 });
  assert.equal(sent[0]!.p_key_hash, hashRateLimitKey("signup:email:a@b.example"));
  assert.ok(!JSON.stringify(sent).includes("a@b.example"));
  assert.equal(sent[0]!.p_window_seconds, 3600);
  assert.notEqual(hashRateLimitKey("a"), hashRateLimitKey("b"));
});
test("A: 共有レート制限 — DB障害時はメモリ制限へ縮退（無制限にしない）", async () => {
  const errs: unknown[][] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => { errs.push(a); };
  try {
    const fail = async () => ({ data: null, error: { message: "db down" } });
    const key = `fallback-${Math.random()}`;
    assert.equal((await checkSharedRateLimit(key, 2, 60_000, { rpc: fail })).allowed, true);
    assert.equal((await checkSharedRateLimit(key, 2, 60_000, { rpc: fail })).allowed, true);
    assert.equal((await checkSharedRateLimit(key, 2, 60_000, { rpc: fail })).allowed, false);
    const weird = async () => ({ data: [{ nope: 1 }] as never, error: null });
    assert.equal((await checkSharedRateLimit(`w-${Math.random()}`, 1, 60_000, { rpc: weird })).allowed, true);
  } finally { console.error = orig; }
  assert.ok(errs.length >= 3);
});
test("A: クライアントIPはホスティングが付け替えるヘッダを優先", () => {
  const h = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null });
  assert.equal(getClientIpFromHeaders(h({ "x-vercel-forwarded-for": "5.5.5.5", "x-forwarded-for": "6.6.6.6" })), "5.5.5.5");
  assert.equal(getClientIpFromHeaders(h({ "x-real-ip": "7.7.7.7", "x-forwarded-for": "6.6.6.6" })), "7.7.7.7");
  assert.equal(getClientIpFromHeaders(h({ "x-forwarded-for": "6.6.6.6, 1.1.1.1" })), "6.6.6.6");
});

// ---- C. cron -----------------------------------------------------------------------------------------
test("K/L: cron認証 — 未認証・不一致は拒否、CRON_SECRET未設定は実行しない、正しいBearerだけ通す", () => {
  assert.equal(verifyCronAuth(null, "s3cret"), "unauthorized");
  assert.equal(verifyCronAuth("", "s3cret"), "unauthorized");
  assert.equal(verifyCronAuth("Bearer wrong", "s3cret"), "unauthorized");
  assert.equal(verifyCronAuth("s3cret", "s3cret"), "unauthorized");
  assert.equal(verifyCronAuth("Bearer s3cret ", "s3cret"), "unauthorized");
  assert.equal(verifyCronAuth("Bearer s3cret", "s3cret"), "ok");
  assert.equal(verifyCronAuth("Bearer s3cret", undefined), "not_configured");
  assert.equal(verifyCronAuth("Bearer ", ""), "not_configured");
});
test("C: cronルートはGETとPOSTの両方に同じ認証付きハンドラ。vercel.json は同じパスをスケジュール", () => {
  const route = readFileSync("app/api/cron/cleanup-pending-diagnoses/route.ts", "utf8");
  assert.match(route, /export const GET = run;/);
  assert.match(route, /export const POST = run;/);
  assert.match(route, /verifyCronAuth/);
  // 認証より前にDBへ触らない
  assert.ok(route.indexOf("verifyCronAuth(") < route.indexOf("createServiceClient()"));
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] };
  assert.ok(vercel.crons.some((c) => c.path === "/api/cron/cleanup-pending-diagnoses" && /^\S+ \S+ \S+ \S+ \S+$/.test(c.schedule)));
  // cronが削除してよいのは pending_diagnoses と rate_limit_counters だけ（課金・監査・同意・採用・請求・診断結果は触らない）
  assert.ok(!/from\("(hiring|success|subscription|invoice|stripe|user_legal|store_hiring|diagnosis_results|organization_)/.test(route));
  assert.deepEqual([...route.matchAll(/\.rpc\("([a-z_]+)"/g)].map((m) => m[1]).sort(), ["cleanup_expired_pending_diagnoses", "cleanup_rate_limit_counters"]);
});

// ---- Auth CAPTCHA 確認スクリプトの判定 -----------------------------------------------------------
test("verify:auth-captcha の判定", () => {
  assert.equal(classifyCaptchaProbe(400, '{"error_code":"captcha_failed","msg":"captcha verification process failed"}'), "enabled");
  assert.equal(classifyCaptchaProbe(200, "{}"), "disabled");
  assert.equal(classifyCaptchaProbe(429, "rate"), "unknown");
  assert.equal(classifyCaptchaProbe(400, "other error"), "unknown");
});

// ---- B/I. legacy RPC: 本番UI・Server Actionから呼ばれない + migration ------------------------------
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
test("I: アプリ（app/lib/components）から旧RPCを呼ばない。新UIは店舗版(v2)を使う", () => {
  const files = [...walk("app"), ...walk("lib"), ...walk("components")];
  const src = files.map((f) => ({ f, s: readFileSync(f, "utf8") }));
  for (const rpc of ["send_scout", "create_salary_offer", "set_salon_interest"]) {
    const re = new RegExp(`rpc\\(\\s*"${rpc}"`);
    assert.deepEqual(src.filter((x) => re.test(x.s)).map((x) => x.f), [], `${rpc} がアプリから呼ばれている`);
  }
  for (const rpc of ["send_scout_v2", "create_salary_offer_v2", "set_store_interest"]) {
    assert.ok(src.some((x) => new RegExp(`rpc\\(\\s*"${rpc}"`).test(x.s)), `${rpc} の呼び出し元が無い`);
  }
  // 旧Server Actionのexportが残っていない
  assert.ok(!src.some((x) => /export async function (sendScout|createSalaryOffer|setSalonInterestAction)\b/.test(x.s)));
});
test("D: diagnosis_results への直接INSERTは service role（サーバー）経由のみ", () => {
  const files = [...walk("app"), ...walk("lib"), ...walk("components")];
  const inserters = files.filter((f) => /from\("diagnosis_results"\)\s*\.insert\(|createServiceClient\(\)\s*\.from\("diagnosis_results"\)\s*\.insert\(/.test(readFileSync(f, "utf8").replace(/\n\s*/g, "")));
  for (const f of inserters) assert.match(readFileSync(f, "utf8"), /createServiceClient\(\)\s*\.from\("diagnosis_results"\)/, f);
  assert.ok(inserters.length >= 2);
  // クライアントコンポーネントから直接INSERTしない
  assert.ok(!walk("components").some((f) => /from\("diagnosis_results"\)\s*\.insert/.test(readFileSync(f, "utf8"))));
});
test("0053: 旧RPCのrevoke・diagnosis_results INSERT廃止・rate limit がmigrationに含まれる。既存migrationは変更しない", () => {
  const sql = readFileSync("supabase/migrations/0053_security_production_hardening.sql", "utf8");
  assert.match(sql, /revoke execute on function public\.send_scout\(uuid, text, text\) from public, anon, authenticated/);
  assert.match(sql, /revoke execute on function public\.create_salary_offer\(uuid, integer, integer, integer, text, text\) from public, anon, authenticated/);
  assert.match(sql, /revoke execute on function public\.set_salon_interest\(uuid, boolean\) from public, anon, authenticated/);
  assert.match(sql, /drop policy if exists diagnosis_results_insert_own/);
  assert.match(sql, /grant execute on function public\.check_rate_limit\(text, integer, integer\) to service_role/);
  // 関数定義そのものは削除しない / テーブルを削除しない / データを消さない
  assert.ok(!/drop function|drop table|truncate table|delete from public\.(?!rate_limit_counters)/i.test(sql));
});

import { describeAuthError } from "../lib/auth/errors";
test("describeAuthError: codeで分類し、ログへmessage本文を出さない", () => {
  const logs: unknown[][] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => { logs.push(a); };
  try {
    const msg = describeAuthError("signup", { message: "captcha verification process failed for a@b.com", code: "captcha_failed", status: 400, name: "AuthApiError" });
    assert.match(msg, /確認に失敗/);
    assert.match(describeAuthError("signup", { message: "boom" }), /^エラーが発生しました。しばらくしてから再度お試しください。（エラーコード: reason=other/);
    assert.match(describeAuthError("signup", { message: "Error sending confirmation email", code: "unexpected_failure", status: 500 }), /エラーコード: unexpected_failure \/ 500/);
    assert.ok(!JSON.stringify(logs).includes("a@b.com"));
    assert.ok(JSON.stringify(logs[0]).includes("captcha_failed"));
  } finally { console.error = orig; }
});

import { classifyAuthMessage } from "../lib/auth/errors";
test("classifyAuthMessage: 許可リストのラベルのみ返し、生のmessageは返さない", () => {
  assert.equal(classifyAuthMessage("Database error saving new user"), "db_error_saving_new_user");
  assert.equal(classifyAuthMessage("Error sending confirmation email"), "email_send_failed");
  assert.equal(classifyAuthMessage("{}"), "empty_body");
  assert.equal(classifyAuthMessage("something about a@b.com"), "other");
  const out = describeAuthError("signup", { message: "Database error saving new user for a@b.com", status: 500, name: "AuthRetryableFetchError" });
  assert.match(out, /reason=db_error_saving_new_user/);
  assert.ok(!out.includes("a@b.com"));
});

test("美容師ログイン画面には新規登録・診断の案内が無い。サロン・共通ログインは従来どおり", () => {
  const src = readFileSync(join(process.cwd(), "app/(auth)/login/login-form.tsx"), "utf8");
  assert.match(src, /signupHref: null,\s*signupLabel: null/);
  assert.ok(!src.includes("初めての方は無料診断へ"));
  assert.match(src, /mode === "stylist" \? null/);
  assert.match(src, /signupHref: "\/signup\/salon",\s*signupLabel: "新規登録はこちら"/);
  assert.match(src, /copy\?\.signupHref \?\? "\/signup"/);
  assert.ok(readFileSync(join(process.cwd(), "app/(auth)/signup/page.tsx"), "utf8").includes("新規登録"));
  const result = readFileSync(join(process.cwd(), "app/diagnosis/result/page.tsx"), "utf8");
  assert.match(result, /const signupHref = isSalon \? "\/signup\/salon" : "\/signup"/);
});

test("再診断フロー: 結果画面のログイン中表示・引き継ぎの時刻保持・保存成功時のみ保存済み表示", () => {
  const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  const result = read("app/diagnosis/result/page.tsx");
  // ログイン中は登録・ログイン案内を出さずマイページへ案内する。ゲストは今回の結果を保存・表示する目的が分かるログイン案内。
  assert.match(result, /isMember \? \(\s*<MemberResultNotice[^>]*mypageHref="\/stylist\/mypage"/);
  assert.match(result, /\/stylist\/login\?next=\/stylist\/mypage/);
  assert.ok(result.includes("ログインして今回の診断結果を保存・表示する"));
  assert.ok(result.includes("無料登録して診断結果をすべて見る")); // ゲスト向けの登録導線は維持
  // 保存成功後にだけ「保存済み」を書き、回答のたびに前回分を消す。
  const quiz = read("components/diagnosis/diagnosis-quiz.tsx");
  const savedWrite = quiz.indexOf("sessionStorage.setItem(DIAGNOSIS_SAVED_STORAGE_KEY");
  assert.ok(savedWrite > quiz.indexOf("if (!result.success)"));
  assert.ok(quiz.includes("sessionStorage.removeItem(DIAGNOSIS_SAVED_STORAGE_KEY)"));
  assert.ok(quiz.includes("今回の回答でもう一度保存する"));
  // 古い保留結果の引き継ぎが、後から受けた診断を巻き戻さない（診断を受けた時刻を使う）。
  assert.match(read("lib/diagnosis-handoff/claim.ts"), /created_at: pending\.created_at/);
  // マイページの8タイプは最新診断の判定（履歴）を優先する。
  assert.match(read("app/stylist/mypage/page.tsx"), /stylist_core_type_history[\s\S]*eq\("diagnosis_result_id", latest\.id\)/);
  // 戻り先は既存の安全な内部パス検証を維持。
  assert.ok(read("lib/auth/actions.ts").includes('safeInternalPath(formData.get("next"))'));
});

test("再診断・表示速度: マイページは独立した取得を並列化し、8タイプは最新診断を使う。認証確認は省略しない", () => {
  const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  const mypage = read("app/stylist/mypage/page.tsx");
  assert.match(mypage, /await Promise\.all\(\[\s*hasCompletedRole\(supabase, user\.id, "stylist"\)/);
  assert.ok(mypage.includes("await supabase.auth.getUser()")); // 認証確認は残す
  assert.ok(mypage.includes('redirect("/onboarding")')); // 役割確認は残す
  assert.ok(!mypage.includes("stylist_core_type_assignments")); // 古い初回確定タイプを表示に使わない
  assert.ok(mypage.includes("calculateCoreType("));
  // ミドルウェア: 同意確認とrole確認を並列開始しつつ、判定の優先順（同意 → role）と認証必須は維持。
  const mw = read("lib/supabase/middleware.ts");
  assert.match(mw, /await Promise\.all\(\[\s*needsLegalCheck \? checkLegalAcceptance\(supabase\)/);
  assert.ok(mw.indexOf("legalGateDecision(pathname, legalCheck)") < mw.indexOf("isStylistOnlyPath && oppositeRoleDone"));
  assert.ok(mw.includes("if (requiresAuth && !user)"));
  // 結果画面: 「保存済み」の印が無い限りログイン中の表示にしない。印はクイズが保存成功後にだけ書く。
  const result = read("app/diagnosis/result/page.tsx");
  assert.match(result, /setAuth\(hasSaved \? "member" : "guest"\)/);
  assert.ok(result.includes("useLinkStatus"));
  assert.ok(result.includes("マイページを開いています..."));
});

import { checkSignupRateLimit, signupRateLimitMessage, type SignupLimitResult } from "../lib/auth/signup-rate-limit";
import { SIGNUP_RATE_LIMITS } from "../lib/rate-limit/config";
import { reserveSlot, type SlotDeps } from "../lib/rate-limit/shared-rate-limiter";
import { reserveMemorySlot } from "../lib/rate-limit/memory-rate-limiter";

/**
 * 0055（予約ID方式）と同じ規則の検査用DB。1要求=1行、状態は pending → confirmed / released の一方向、
 * 使用数は行の状態から数える。判定と挿入は同期的（DB側のアドバイザリロックによる直列化に相当）。
 * ★これはモックであり、実DBの検証ではない（実DBはローカルPostgresで別に検証）。
 */
function fakeSlotDb(clock: { t: number }) {
  type Row = { id: string; key: string; windowStart: number; state: "pending" | "confirmed" | "released"; expiresAt: number };
  const rows: Row[] = [];
  let seq = 0;
  const failures = { settle: 0, reserve: false };
  const log: string[] = [];
  const rpc: NonNullable<SlotDeps["rpc"]> = async (fn, a) => {
    if (fn === "reserve_rate_limit_slot") {
      if (failures.reserve) return { data: null, error: { message: "function reserve_rate_limit_slot does not exist" } };
      const winMs = (a.p_window_seconds as number) * 1000;
      const ws = Math.floor(clock.t / winMs) * winMs;
      const key = a.p_key_hash as string;
      const mine = rows.filter((r) => r.key === key && r.windowStart === ws);
      const confirmed = mine.filter((r) => r.state === "confirmed").length;
      const pending = mine.filter((r) => r.state === "pending" && r.expiresAt > clock.t).length;
      if (confirmed >= (a.p_confirmed_limit as number))
        return { data: [{ allowed: false, reservation_id: null, reason: "limit", retry_after_seconds: Math.ceil((ws + winMs - clock.t) / 1000) }], error: null };
      if (pending >= (a.p_inflight_limit as number))
        return { data: [{ allowed: false, reservation_id: null, reason: "busy", retry_after_seconds: 5 }], error: null };
      const id = `r${++seq}`;
      rows.push({ id, key, windowStart: ws, state: "pending", expiresAt: clock.t + (a.p_pending_ttl_seconds as number) * 1000 });
      return { data: [{ allowed: true, reservation_id: id, reason: "ok", retry_after_seconds: 0 }], error: null };
    }
    log.push(`${a.p_outcome}:${a.p_reservation_id}`);
    if (failures.settle > 0) {
      failures.settle--;
      return { data: null, error: { message: "network" } };
    }
    const row = rows.find((r) => r.id === a.p_reservation_id);
    if (!row || row.state !== "pending") return { data: "noop", error: null };
    row.state = a.p_outcome === "confirm" ? "confirmed" : "released";
    return { data: row.state, error: null };
  };
  const count = (key: string, state: Row["state"]) => rows.filter((r) => r.key.includes(key) && r.state === state).length;
  return { rows, rpc, failures, log, count, keys: () => rows.map((r) => r.key) };
}

/** IP単位は既存の check_rate_limit と同じ（+1して上限超で拒否・固定ウィンドウ）。 */
function fakeIpCounter() {
  const counts = new Map<string, number>();
  const calls: string[] = [];
  const checkIp = async (key: string, limit: number, windowMs: number) => {
    calls.push(key);
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    return { allowed: n <= limit, retryAfterSeconds: n <= limit ? 0 : Math.ceil(windowMs / 2000) };
  };
  return { checkIp, counts, calls };
}

function harness() {
  const clock = { t: Date.UTC(2026, 10, 12, 1, 10, 0) };
  const db = fakeSlotDb(clock);
  const ip = fakeIpCounter();
  const check = (input: { ip: string; email: string }) =>
    checkSignupRateLimit(input, {
      checkIp: ip.checkIp,
      reserve: (key, limits) => reserveSlot(key, limits, { rpc: db.rpc, now: () => clock.t }),
    });
  return { clock, db, ip, check };
}
const okOf = (r: SignupLimitResult) => {
  assert.equal(r.allowed, true);
  return r as Extract<SignupLimitResult, { allowed: true }>;
};
/** performSignUp と同じ手順（制限 → 偽のAuth応答 → 結果に応じて settle）。モック検証。 */
async function attempt(h: ReturnType<typeof harness>, ip: string, email: string, token: "valid" | "fake") {
  const r = await h.check({ ip, email });
  if (!r.allowed) return r.scope === "email_busy" ? "busy" : "limited";
  await r.settle(token === "valid" ? "confirm" : "release");
  return token === "valid" ? "ok" : "captcha_failed";
}

test("新規登録の制限: 同一IPから異なるメールで30人（美容師・サロン混在）が止まらない", async () => {
  const h = harness();
  for (let i = 0; i < 30; i++) assert.equal(await attempt(h, "203.0.113.7", `person${i}@example.test`, "valid"), "ok", `${i + 1}人目`);
  assert.equal(h.ip.counts.get("signup:ip:203.0.113.7"), 30);
});

test("新規登録の制限: 同一メールの確認メール送信は上限で止まり、同じIPの他の人は止まらない", async () => {
  const h = harness();
  for (let i = 0; i < SIGNUP_RATE_LIMITS.perEmail; i++) assert.equal(await attempt(h, "198.51.100.1", "same@example.test", "valid"), "ok");
  for (let i = 0; i < 10; i++) {
    const r = await h.check({ ip: "198.51.100.1", email: "SAME@example.test" });
    assert.equal(r.allowed, false);
    if (!r.allowed) assert.equal(r.scope, "email");
  }
  assert.equal(h.db.count("", "confirmed"), SIGNUP_RATE_LIMITS.perEmail);
  assert.equal(h.db.rows.length, SIGNUP_RATE_LIMITS.perEmail); // 拒否された要求は行を作らない
  assert.equal(await attempt(h, "198.51.100.1", "other@example.test", "valid"), "ok");
});

test("新規登録の制限: IP単位の安全弁（短時間の大量要求）は維持され、IP制限で止まった要求はメール枠へ届かない", async () => {
  const h = harness();
  let blockedAt = -1;
  for (let i = 0; i < SIGNUP_RATE_LIMITS.perIp + 5; i++) {
    const r = await attempt(h, "192.0.2.50", `bulk${i}@example.test`, "fake");
    if (r === "limited" && blockedAt < 0) blockedAt = i + 1;
  }
  assert.equal(blockedAt, SIGNUP_RATE_LIMITS.perIp + 1);
  assert.equal(h.db.rows.length, SIGNUP_RATE_LIMITS.perIp); // 超過分はメール枠の行を作っていない
});

test("新規登録の制限: IPが取れない利用者同士を、厳しい共通カウンターで互いにブロックしない", async () => {
  const h = harness();
  for (let i = 0; i < 40; i++) assert.equal(await attempt(h, i % 2 ? "unknown" : "", `noip${i}@example.test`, "valid"), "ok");
  assert.ok(h.ip.calls.includes("signup:noip"));
  assert.ok(!h.ip.calls.includes("signup:ip:unknown"));
});

test("新規登録の制限: IP→メールの順に1回ずつ。案内は集中と断定せず、再試行の目安を示す", async () => {
  const h = harness();
  okOf(await h.check({ ip: "203.0.113.9", email: "once@example.test" }));
  assert.deepEqual(h.ip.calls, ["signup:ip:203.0.113.9"]);
  assert.equal(h.db.rows.length, 1);
  const m1 = signupRateLimitMessage({ allowed: false, scope: "email", retryAfterSeconds: 1500 });
  const m2 = signupRateLimitMessage({ allowed: false, scope: "ip", retryAfterSeconds: 30 });
  const m3 = signupRateLimitMessage({ allowed: false, scope: "email_busy", retryAfterSeconds: 5 });
  assert.match(m1, /約25分後/);
  assert.match(m2, /約1分後/);
  assert.match(m3, /数秒後/);
  assert.ok(![m1, m2, m3].some((m) => m.includes("集中")));
});

test("performSignUp の順序: CAPTCHA有無の確認 → 制限（予約）→ signUp → 結果で確定/返却。予約は例外時に残し期限で回収", () => {
  const src = readFileSync(join(process.cwd(), "lib/auth/actions.ts"), "utf8");
  const perform = src.slice(src.indexOf("async function performSignUp"), src.indexOf("export async function signUpAction"));
  const i = (s: string) => perform.indexOf(s);
  assert.ok(i("requireCaptchaToken") < i("checkSignupRateLimit"));
  assert.ok(i("checkSignupRateLimit") < i("auth.signUp"));
  assert.ok(i("auth.signUp") < i("signupLimit.settle"));
  assert.match(perform, /settle\(error\?\.code === "captcha_failed" \? "release" : "confirm"\)/);
  assert.equal((perform.match(/auth\.signUp/g) ?? []).length, 1); // 二重検証なし（signUpは1回）
  assert.ok(src.includes('performSignUp("salon"') && src.includes('performSignUp("stylist"'));
});

test("CAPTCHA失敗の要求は他人のメール枠を消費しない: 偽トークンを繰り返した後も、本人は有効なCAPTCHAで登録できる（モック）", async () => {
  const h = harness();
  const L = SIGNUP_RATE_LIMITS;
  for (let i = 0; i < L.perEmail * 10; i++) assert.equal(await attempt(h, "203.0.113.66", "victim@example.test", "fake"), "captcha_failed");
  assert.equal(h.db.count("", "confirmed"), 0);
  assert.equal(await attempt(h, "198.51.100.20", "victim@example.test", "valid"), "ok");
  for (let i = 1; i < L.perEmail; i++) assert.equal(await attempt(h, "198.51.100.20", "victim@example.test", "valid"), "ok");
  assert.equal(await attempt(h, "198.51.100.20", "victim@example.test", "valid"), "limited"); // 過剰な確認メール送信は抑制
  // 偽トークンの大量送信は、IP単位で止まる（Supabase Authへの大量要求を抑える仕組みは維持）。
  const g = harness();
  let limitedAt = -1;
  for (let i = 0; i < L.perIp + 3; i++) if ((await attempt(g, "203.0.113.66", `v${i}@example.test`, "fake")) === "limited" && limitedAt < 0) limitedAt = i + 1;
  assert.equal(limitedAt, L.perIp + 1);
});

test("同じ予約の返却を2回以上実行しても、他の要求の枠は減らない（予約ID・冪等）", async () => {
  const h = harness();
  const deps = { checkIp: h.ip.checkIp, limits: { ...SIGNUP_RATE_LIMITS, perEmailInflight: 2 } };
  const mk = () =>
    checkSignupRateLimit({ ip: "10.0.0.1", email: "dup@example.test" }, { ...deps, reserve: (k, l) => reserveSlot(k, l, { rpc: h.db.rpc, now: () => h.clock.t }) });
  const a = okOf(await mk());
  const b = okOf(await mk());
  assert.equal((await mk()).allowed, false); // 検証中2件で満杯
  await a.settle("release");
  await a.settle("release");
  await a.settle("release");
  assert.equal(h.db.log.filter((x) => x.startsWith("release")).length, 1); // アプリ側は1回だけ送る
  // DBへ同じ返却を直接再送しても何も起きない。
  await h.db.rpc("settle_rate_limit_slot", { p_reservation_id: h.db.rows[0]!.id, p_outcome: "release" });
  await h.db.rpc("settle_rate_limit_slot", { p_reservation_id: h.db.rows[0]!.id, p_outcome: "release" });
  const c = okOf(await mk()); // aの枠が1つだけ空く
  assert.equal((await mk()).allowed, false); // b と c が検証中。bの枠は減っていない
  await b.settle("confirm");
  await c.settle("release");
  assert.equal(h.db.count("", "pending"), 0);
});

test("確定後の返却・返却後の確定は何も変えない／期限切れ後の遅延返却・遅延確定は自分の行にだけ効く", async () => {
  const h = harness();
  const reserve = (email: string) => reserveSlot(`k:${email}`, { confirmedLimit: 2, inflightLimit: 1, windowMs: 3600_000, pendingTtlMs: 60_000 }, { rpc: h.db.rpc, now: () => h.clock.t });
  const asOk = (r: Awaited<ReturnType<typeof reserve>>) => {
    assert.equal(r.allowed, true);
    return r as Extract<typeof r, { allowed: true }>;
  };
  // 確定後の返却
  const a = asOk(await reserve("x"));
  await a.settle("confirm");
  await h.db.rpc("settle_rate_limit_slot", { p_reservation_id: h.db.rows[0]!.id, p_outcome: "release" });
  assert.equal(h.db.count("", "confirmed"), 1);
  // 返却後の確定（別の予約）
  const b = asOk(await reserve("x"));
  await b.settle("release");
  await h.db.rpc("settle_rate_limit_slot", { p_reservation_id: h.db.rows[1]!.id, p_outcome: "confirm" });
  assert.equal(h.db.count("", "confirmed"), 1);
  // 期限切れ: 結果を通知できなかった予約cは、期限後に枠から外れ、別の要求dが入れる。
  const c = asOk(await reserve("x"));
  assert.equal((await reserve("x")).allowed, false); // 検証中（busy）
  h.clock.t += 61_000;
  const d = asOk(await reserve("x"));
  await c.settle("release"); // 遅延返却: cの行だけ released。dには影響しない
  assert.equal(h.db.rows[2]!.state, "released");
  assert.equal(h.db.rows[3]!.state, "pending");
  assert.equal((await reserve("x")).allowed, false); // dが検証中
  await d.settle("confirm");
  // 遅延確定: 期限後でも、実際に通った要求の行は確定として数える（confirmed=2で上限）。
  assert.equal(h.db.count("", "confirmed"), 2);
  const r = await reserve("x");
  assert.equal(r.allowed, false);
  if (!r.allowed) assert.equal(r.reason, "limit");
});

test("回復: 返却RPCの失敗は1回再試行／再試行も失敗しても、通信切断・処理中断でも、期限で枠が自動的に戻る", async () => {
  const h = harness();
  // 返却が1回失敗 → 再試行で成功
  h.db.failures.settle = 1;
  const a = okOf(await h.check({ ip: "10.9.0.1", email: "rec@example.test" }));
  await a.settle("release");
  assert.equal(h.db.count("", "released"), 1);
  // 返却が2回とも失敗 → pendingのまま。期限後に枠から外れる。
  const errs: unknown[] = [];
  const orig = console.error;
  console.error = (...x: unknown[]) => void errs.push(x);
  try {
    h.db.failures.settle = 2;
    const b = okOf(await h.check({ ip: "10.9.0.1", email: "rec@example.test" }));
    await b.settle("release");
  } finally {
    console.error = orig;
  }
  assert.ok(errs.length >= 1);
  assert.ok(!JSON.stringify(errs).includes("rec@example.test")); // メールをログに出さない
  // 処理中断（settleを呼ばない）を、同じメールで3件重ねる → 検証中3件で満杯（一時的に拒否）。
  okOf(await h.check({ ip: "10.9.0.2", email: "rec@example.test" }));
  okOf(await h.check({ ip: "10.9.0.3", email: "rec@example.test" }));
  const busy = await h.check({ ip: "10.9.0.4", email: "rec@example.test" });
  assert.equal(busy.allowed, false);
  if (!busy.allowed) assert.equal(busy.scope, "email_busy");
  h.clock.t += SIGNUP_RATE_LIMITS.pendingTtlMs + 1000;
  assert.equal(await attempt(h, "10.9.0.5", "rec@example.test", "valid"), "ok"); // 回復
  assert.equal(h.db.count("", "confirmed"), 1); // 中断した要求は消費として数えられていない
});

test("偽トークンの並行要求と本人の正常要求が重なる: 検証中の枠が埋まる間だけ本人は一時的に拒否され、応答後に通る", async () => {
  const h = harness();
  const L = SIGNUP_RATE_LIMITS;
  // 偽トークン L.perEmailInflight 件が、Supabaseの応答待ち（未settle）で同時に進行中。
  const fakes = [] as Array<Extract<SignupLimitResult, { allowed: true }>>;
  for (let i = 0; i < L.perEmailInflight; i++) fakes.push(okOf(await h.check({ ip: `203.0.113.${i}`, email: "victim@example.test" })));
  const during = await h.check({ ip: "198.51.100.20", email: "victim@example.test" });
  assert.equal(during.allowed, false); // ★一時的な拒否（残る制約）
  if (!during.allowed) {
    assert.equal(during.scope, "email_busy");
    assert.ok(during.retryAfterSeconds <= 5);
  }
  assert.equal(h.db.count("", "confirmed"), 0); // 確定枠は消費されていない
  for (const f of fakes) await f.settle("release"); // captcha_failed の応答
  assert.equal(await attempt(h, "198.51.100.20", "victim@example.test", "valid"), "ok");
  assert.equal(h.db.count("", "confirmed"), 1);
});

test("同時要求（Promise.all）: 検証中の上限で一時的に拒否されるが、確定は上限を大きく超えず、取りこぼし・二重計上がない", async () => {
  const h = harness();
  const L = SIGNUP_RATE_LIMITS;
  const results = await Promise.all(Array.from({ length: 30 }, (_, i) => attempt(h, `10.0.0.${i}`, "burst@example.test", "valid")));
  const ok = results.filter((r) => r === "ok").length;
  assert.ok(ok >= 1 && ok <= L.perEmail + L.perEmailInflight - 1, `ok=${ok}`);
  assert.equal(results.length, ok + results.filter((r) => r === "busy" || r === "limited").length);
  assert.equal(h.db.count("", "confirmed"), ok);
  assert.equal(h.db.count("", "pending"), 0);
  assert.equal(h.db.rows.length, ok); // 拒否された要求は行を作らない
  // 「busy」だった人は数秒後に再試行できる。繰り返しても確定は上限で止まる。
  for (let i = 0; i < 20; i++) await attempt(h, `10.1.0.${i}`, "burst@example.test", "valid");
  assert.equal(h.db.count("", "confirmed"), L.perEmail);
  assert.equal(await attempt(h, "10.1.9.9", "burst@example.test", "valid"), "limited");
});

test("ウィンドウ境界: 前のウィンドウで予約した要求を後で確定しても、新しいウィンドウの枠は消費しない", async () => {
  const h = harness();
  const L = SIGNUP_RATE_LIMITS;
  h.clock.t = Math.ceil(h.clock.t / L.windowMs) * L.windowMs - 5_000; // ウィンドウ終了の5秒前
  const a = okOf(await h.check({ ip: "10.2.0.1", email: "edge@example.test" }));
  h.clock.t += 10_000; // 次のウィンドウへ
  await a.settle("confirm");
  assert.equal(h.db.rows[0]!.state, "confirmed");
  for (let i = 0; i < L.perEmail; i++) assert.equal(await attempt(h, `10.2.1.${i}`, "edge@example.test", "valid"), "ok"); // 新ウィンドウは満枠で始まる
  assert.equal(await attempt(h, "10.2.1.99", "edge@example.test", "valid"), "limited");
  assert.equal(new Set(h.db.rows.map((r) => r.windowStart)).size, 2);
});

test("DB障害・0055未適用時: メモリの枠へ縮退し、確定・返却・期限・ウィンドウが同じ規則で動く", async () => {
  const h = harness();
  h.db.failures.reserve = true; // 0055未適用（関数が無い）/ DB障害
  const errs: unknown[] = [];
  const orig = console.error;
  console.error = (...x: unknown[]) => void errs.push(x);
  try {
    const L = SIGNUP_RATE_LIMITS;
    // 偽トークンの繰り返しでは枠を消費せず、本人は登録できる。
    for (let i = 0; i < 20; i++) assert.equal(await attempt(h, "10.3.0.1", "mem@example.test", "fake"), "captcha_failed");
    assert.equal(await attempt(h, "10.3.0.2", "mem@example.test", "valid"), "ok");
    for (let i = 1; i < L.perEmail; i++) assert.equal(await attempt(h, "10.3.0.2", "mem@example.test", "valid"), "ok");
    assert.equal(await attempt(h, "10.3.0.2", "mem@example.test", "valid"), "limited");
    // 二重返却・確定後の返却は何も変えない（メモリ実装）。
    const lim = { confirmedLimit: 2, inflightLimit: 1, windowMs: 3600_000, pendingTtlMs: 60_000 };
    const t0 = Date.UTC(2026, 10, 12, 0, 0, 0);
    const a = reserveMemorySlot("m:1", lim, t0);
    assert.equal(a.allowed, true);
    if (a.allowed) {
      assert.equal(a.settle("confirm"), true);
      assert.equal(a.settle("release"), false);
      assert.equal(a.settle("confirm"), false);
    }
    const b = reserveMemorySlot("m:1", lim, t0 + 1);
    assert.equal(b.allowed, true);
    assert.equal(reserveMemorySlot("m:1", lim, t0 + 2).allowed, false); // busy
    assert.equal(reserveMemorySlot("m:1", lim, t0 + 61_000).allowed, true); // bの期限切れ
    if (b.allowed) assert.equal(b.settle("release"), true); // 遅延返却は自分の件だけ
    // ウィンドウ境界: 次のウィンドウでは確定数が0から始まる。
    const next = t0 + 3600_000 + 1;
    assert.equal(reserveMemorySlot("m:1", lim, next).allowed, true);
  } finally {
    console.error = orig;
  }
  assert.ok(errs.length >= 1);
});

test("reserveSlot: キーはSHA-256で送り、予約IDは推測不能な値をDBが返す／settleは予約IDと結果だけを送る", async () => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const rpc: NonNullable<SlotDeps["rpc"]> = async (fn, a) => {
    calls.push([fn, a]);
    return fn === "reserve_rate_limit_slot"
      ? { data: [{ allowed: true, reservation_id: "11111111-2222-3333-4444-555555555555", reason: "ok", retry_after_seconds: 0 }], error: null }
      : { data: "confirmed", error: null };
  };
  const r = await reserveSlot("signup:email2:a@example.test", { confirmedLimit: 5, inflightLimit: 3, windowMs: 3600_000, pendingTtlMs: 60_000 }, { rpc });
  assert.equal(r.allowed, true);
  if (r.allowed) await r.settle("confirm");
  assert.deepEqual(calls.map((c) => c[0]), ["reserve_rate_limit_slot", "settle_rate_limit_slot"]);
  assert.match(String(calls[0]![1].p_key_hash), /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(calls).includes("a@example.test"));
  assert.deepEqual(calls[1]![1], { p_reservation_id: "11111111-2222-3333-4444-555555555555", p_outcome: "confirm" });
  assert.equal(calls[0]![1].p_inflight_limit, 3);
  assert.equal(calls[0]![1].p_pending_ttl_seconds, 60);
});

test("新規登録の成功案内: 別の種類（美容師/サロン）には別メールが必要と一般的に案内し、他人のロールは開示しない", () => {
  const src = readFileSync(join(process.cwd(), "lib/auth/actions.ts"), "utf8");
  assert.ok(src.includes("美容師とサロンは別々のアカウントです。もう一方の種類で登録する場合は、別のメールアドレスをご用意ください。"));
  // Turnstileは、この段階ではトークンの存在確認のみ（検証はSupabase Authの signUp が行う。二重検証しない）。
  const perform = src.slice(src.indexOf("async function performSignUp"), src.indexOf("export async function signUpAction"));
  assert.ok(!perform.includes("verifyBotProtection") && !perform.includes("checkTurnstileToken"));
  assert.ok(perform.includes("captchaToken: captcha.captchaToken"));
});

test("サロン初回登録: 写真アップローダーは保存後（edit）だけ表示する（保存前はadd_salon_photoが権限不足で必ず失敗するため）", () => {
  const src = readFileSync(join(process.cwd(), "components/salon-profile/salon-profile-form.tsx"), "utf8");
  const section = src.slice(src.indexOf('<h2 className="eyebrow">サロン写真</h2>'), src.indexOf('<h2 className="eyebrow">外部リンク</h2>'));
  assert.match(section, /mode === "create" \?/);
  assert.ok(section.indexOf('mode === "create"') < section.indexOf("<SalonPhotoUploader"));
  assert.equal((section.match(/<SalonPhotoUploader/g) ?? []).length, 2); // 編集画面では内装・雰囲気の2枠とも残す
  // RPCの前提（user_rolesのsalon）は、プロフィール保存RPCが記録する。
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/0014_salon_photos_hotpepper.sql"), "utf8");
  assert.match(sql, /caller is not a salon/);
});

// ---------------------------------------------------------------------------
// サロンAI紹介文: 回答済みで未作成の再生成（重複実行・失敗を隠さない）
// ---------------------------------------------------------------------------
import { runSalonAiRetry, SALON_AI_OUTPUT_TYPES } from "../lib/salon-culture/ai-retry";
import { runSalonCultureAiGenerationJob } from "../lib/salon-culture/run-culture-ai-job";

function fakeLimiter() {
  const counts = new Map<string, number>();
  return async (key: string, limit: number) => {
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    return { allowed: n <= limit };
  };
}

test("AI再生成: 未回答は生成しない／4種そろっていれば何もしない", async () => {
  let ran = 0;
  const base = { limiter: fakeLimiter(), userId: "u1", runJob: async () => (ran++, "ok" as const) };
  assert.deepEqual(await runSalonAiRetry({ ...base, completed: false, existingCurrentTypes: [] }), { status: "not_completed" });
  assert.deepEqual(await runSalonAiRetry({ ...base, completed: true, existingCurrentTypes: [...SALON_AI_OUTPUT_TYPES] }), { status: "exists" });
  assert.equal(ran, 0);
});

test("AI再生成: 連打・同時実行でも生成は1回だけ。成功後は再実行されない", async () => {
  let ran = 0;
  let saved = false;
  const limiter = fakeLimiter();
  const call = () =>
    runSalonAiRetry({
      completed: true,
      existingCurrentTypes: saved ? [...SALON_AI_OUTPUT_TYPES] : [],
      limiter,
      userId: "u1",
      runJob: async () => {
        ran++;
        await new Promise((r) => setTimeout(r, 5));
        saved = true;
        return "ok";
      },
    });
  const results = await Promise.all(Array.from({ length: 6 }, call));
  assert.equal(ran, 1);
  assert.equal(results.filter((r) => r.status === "generated").length, 1);
  assert.equal(results.filter((r) => r.status === "busy").length, 5);
  assert.equal((await call()).status, "exists");
  assert.equal(ran, 1);
});

test("AI再生成: 生成失敗・一部保存失敗は『失敗』として返す（成功に見せない）。別ユーザーの枠とは独立", async () => {
  const limiter = fakeLimiter();
  const mk = (userId: string, job: "generation_failed" | "partial") =>
    runSalonAiRetry({ completed: true, existingCurrentTypes: ["essence"], limiter, userId, runJob: async () => job });
  const a = await mk("u1", "generation_failed");
  const b = await mk("u2", "partial");
  assert.equal(a.status, "failed");
  assert.equal(b.status, "failed");
  assert.match((a as { error: string }).error, /失敗/);
  assert.match((b as { error: string }).error, /一部/);
  assert.equal((await mk("u1", "generation_failed")).status, "busy"); // 2分以内の再実行は抑止
});

test("AI生成ジョブ: 生成失敗は generation_failed、保存の一部失敗は partial、全件成功は ok（4種×作成+現行化）", async () => {
  const profile = { id: "p1", culture_axes: {}, value_priorities: null, comment: null } as never;
  const narrative = { essence: "e", explanation: "x", advice: ["a"], growth: "g" };
  const gen = async () => ({ narrative, model: "m", promptVersion: "salon-culture-v1" });
  const mkRpc = (failCreateFor?: string) => {
    const calls: string[] = [];
    return {
      calls,
      supabase: {
        rpc: async (fn: string, args: Record<string, unknown>) => {
          calls.push(fn);
          if (fn === "create_salon_culture_ai_output") {
            if (args.p_output_type === failCreateFor) return { data: null, error: { message: "x" } };
            return { data: { id: `id-${args.p_output_type}` }, error: null };
          }
          return { data: null, error: null };
        },
      } as never,
    };
  };
  const errs = console.error;
  console.error = () => {};
  try {
    assert.equal(await runSalonCultureAiGenerationJob(profile, "t", { generate: (async () => null) as never, supabase: mkRpc().supabase }), "generation_failed");
    const ok = mkRpc();
    assert.equal(await runSalonCultureAiGenerationJob(profile, "t", { generate: gen as never, supabase: ok.supabase }), "ok");
    assert.equal(ok.calls.length, 8);
    const part = mkRpc("growth");
    assert.equal(await runSalonCultureAiGenerationJob(profile, "t", { generate: gen as never, supabase: part.supabase }), "partial");
  } finally {
    console.error = errs;
  }
});

test("サロンマイページ: タイプ表示とAI紹介文は同じ salon_culture_profiles／salon_culture_ai_outputs を参照し、未回答と回答済み未作成を区別する", () => {
  const page = readFileSync(join(process.cwd(), "app/salon/mypage/page.tsx"), "utf8");
  assert.match(page, /cultureProfile\?\.status === "completed" \? deriveSalonTypes/);
  assert.match(page, /\.from\("salon_culture_ai_outputs"\)/);
  assert.match(page, /cultureStatus=\{cultureProfile\?\.status \?\? null\}/);
  assert.match(page, /loadFailed=\{salonAiLoadFailed\}/);
  assert.match(page, /href="\/salon\/culture\/result"/); // 「詳しい結果を見る」は本人の保存済み結果
  const resultPage = readFileSync(join(process.cwd(), "app/salon/culture/result/page.tsx"), "utf8");
  assert.match(resultPage, /\.eq\("salon_user_id", user\.id\)/);
  const comp = readFileSync(join(process.cwd(), "components/salon-culture/salon-ai-narrative.tsx"), "utf8");
  assert.match(comp, /cultureStatus === "completed"/);
  assert.match(comp, /まだ作成されていません/);
  assert.match(comp, /読み込めませんでした/);
});

test("サロンらしさ結果画面: 古いCOMING SOON枠を廃止し、既存の候補者一覧へ案内する（計算・権限は変更しない）", () => {
  const legacy = readFileSync(join(process.cwd(), "components/salon-culture/culture-result.tsx"), "utf8");
  const store = readFileSync(join(process.cwd(), "components/salon-culture/store-culture-result.tsx"), "utf8");
  for (const src of [legacy, store]) {
    assert.ok(!/coming soon/i.test(src.replace(/\/\*[\s\S]*?\*\//g, "")));
    assert.ok(!src.includes("マッチング機能とともに表示される予定です"));
    assert.ok(!src.includes("今後、美容師とのマッチングに活用される予定"));
    assert.ok(src.includes("美容師との相性を確認できます"));
  }
  // 既存の導線: 本人（サロン）の /salon/stylists（店舗へ振り分け）と、対象店舗の /salon/stores/[storeId]/stylists。
  assert.ok(legacy.includes('href="/salon/stylists"'));
  assert.ok(store.includes("`/salon/stores/${storeId}/stylists`"));
  assert.ok(existsSync(join(process.cwd(), "app/salon/stylists/page.tsx")));
  assert.ok(existsSync(join(process.cwd(), "app/salon/stores/[storeId]/stylists/page.tsx")));
});
