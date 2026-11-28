import test from "node:test";
import assert from "node:assert/strict";
import { safeInternalPath } from "../lib/auth/safe-path";
import { checkRateLimit, getClientIpFromHeaders } from "../lib/rate-limit/memory-rate-limiter";
import { collectEnvProblems } from "../lib/env/validate";
import { logError } from "../lib/security/log";

test("safeInternalPath: 内部パスのみ許可", () => {
  assert.equal(safeInternalPath("/salon/company"), "/salon/company");
  assert.equal(safeInternalPath("/a?b=1"), "/a?b=1");
  for (const bad of ["//x.com", "/\\x.com", "http://x.com", "javascript:alert(1)", "/a\nb", "x", "", 1, null, undefined]) assert.equal(safeInternalPath(bad), null, String(bad));
});
test("rate limit: 上限を超えると拒否し、キーごとに独立", () => {
  const k = `t-${Math.random()}`;
  for (let i = 0; i < 3; i++) assert.equal(checkRateLimit(k, 3, 60_000).allowed, true);
  const r = checkRateLimit(k, 3, 60_000);
  assert.equal(r.allowed, false);
  assert.ok(r.retryAfterSeconds >= 1);
  assert.equal(checkRateLimit(`${k}-other`, 3, 60_000).allowed, true);
});
test("クライアントIP: x-forwarded-for の先頭を使う", () => {
  const h = (m: Record<string, string>) => ({ get: (n: string) => m[n] ?? null });
  assert.equal(getClientIpFromHeaders(h({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" })), "1.1.1.1");
  assert.equal(getClientIpFromHeaders(h({})), "unknown");
});
test("env検証: 本番では不足をエラー、開発では止めない。値は出さない", () => {
  const prod = collectEnvProblems({}, true);
  assert.ok(prod.some((p) => p.key === "SUPABASE_SERVICE_ROLE_KEY" && p.level === "error"));
  assert.ok(prod.some((p) => p.key === "LEGAL_OPERATOR_NAME" && p.level === "error"));
  const dev = collectEnvProblems({}, false);
  assert.ok(dev.every((p) => p.level === "warn"));
  assert.ok(collectEnvProblems({ NEXT_PUBLIC_SITE_URL: "http://localhost:3000" }, true).some((p) => /localhost/.test(p.message)));
  const secret = "SECRET-VALUE-123";
  assert.ok(collectEnvProblems({ SUPABASE_SERVICE_ROLE_KEY: secret, LEGAL_EFFECTIVE_DATE: "bad" }, true).every((p) => !p.message.includes(secret)));
});
test("logError: 生のエラーオブジェクト(details/hint)を出さない", () => {
  const out: unknown[][] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => { out.push(a); };
  try {
    logError("x", { message: "dup", code: "23505", details: "Key (email)=(a@b.c) already exists.", hint: "secret" });
  } finally { console.error = orig; }
  const text = JSON.stringify(out);
  assert.ok(!text.includes("a@b.c") && !text.includes("secret"));
  assert.ok(text.includes("23505"));
});

test("env: ANTHROPIC_API_KEY は Preview でだけ未設定を許す（本番は従来どおりエラー・他の変数は緩めない）", () => {
  const errorKeys = (ps: ReturnType<typeof collectEnvProblems>) => ps.filter((p) => p.level === "error").map((p) => p.key);
  assert.ok(errorKeys(collectEnvProblems({}, true)).includes("ANTHROPIC_API_KEY"));
  assert.ok(errorKeys(collectEnvProblems({}, true, false)).includes("ANTHROPIC_API_KEY"));
  const preview = collectEnvProblems({}, true, true);
  assert.ok(!errorKeys(preview).includes("ANTHROPIC_API_KEY"));
  assert.ok(preview.some((p) => p.key === "ANTHROPIC_API_KEY" && p.level === "warn"));
  for (const k of ["CRON_SECRET", "SUPABASE_SERVICE_ROLE_KEY", "STRIPE_SECRET_KEY", "TURNSTILE_SECRET_KEY"]) assert.ok(errorKeys(preview).includes(k), k);
});
