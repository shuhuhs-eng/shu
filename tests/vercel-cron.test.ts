// 通知メール送信ワーカーの定期実行(Vercel Cron 1分間隔)の設定と、ルートの認証・安全動作の試験。
// 実送信・実DBは使わない（ワーカー・DBクライアントは疑似に差し替え。秘密値はダミー）。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { readFileSync, existsSync } from "node:fs";

type Cron = { path: string; schedule: string };
const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: Cron[] };

test("vercel.json: 既存の定期処理を残し、通知メールを1分間隔で追加(パスは重複なし・ルートが存在)", () => {
  const cleanup = vercel.crons.find((c) => c.path === "/api/cron/cleanup-pending-diagnoses");
  assert.deepEqual(cleanup, { path: "/api/cron/cleanup-pending-diagnoses", schedule: "0 18 * * *" }, "既存は不変");
  const mail = vercel.crons.find((c) => c.path === "/api/cron/send-notification-emails");
  assert.deepEqual(mail, { path: "/api/cron/send-notification-emails", schedule: "* * * * *" });
  assert.equal(vercel.crons.length, 2);
  assert.equal(new Set(vercel.crons.map((c) => c.path)).size, vercel.crons.length);
  for (const c of vercel.crons) { assert.match(c.schedule, /^\S+ \S+ \S+ \S+ \S+$/); assert.ok(existsSync(`app${c.path}/route.ts`), c.path); }
});

test("ルートの形: GET(Vercel Cronが使う)とPOSTが同じ認証つきハンドラ・認証が先・実行時間上限は予算(50秒)より長い", () => {
  const src = readFileSync("app/api/cron/send-notification-emails/route.ts", "utf8");
  assert.match(src, /export const GET = run;/); assert.match(src, /export const POST = run;/);
  assert.ok(src.indexOf("verifyCronAuth(") < src.indexOf("createMailProvider(") && src.indexOf("createMailProvider(") < src.indexOf("createServiceClient()"));
  const dur = Number(/maxDuration = (\d+)/.exec(src)?.[1]); const budget = Number(/DEFAULT_BUDGET_MS = ([\d_]+)/.exec(readFileSync("lib/email/worker.ts", "utf8"))?.[1].replace(/_/g, ""));
  assert.ok(dur * 1000 > budget, `maxDuration ${dur}s > 予算 ${budget}ms`);
});

const calls: string[] = [];
const originalLoad = (Module as unknown as { _load: (...a: unknown[]) => unknown })._load;
(Module as unknown as { _load: unknown })._load = function (request: string, ...rest: unknown[]) {
  if (request === "@/lib/supabase/service") return { createServiceClient: () => { calls.push("client"); return {}; } };
  if (request === "@/lib/email/worker") return { runEmailWorker: async () => { calls.push("worker"); return { claimed: 0, sent: 0 }; } };
  return originalLoad.call(this, request, ...rest);
};
after(() => { (Module as unknown as { _load: unknown })._load = originalLoad; });
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GET, POST } = require("../app/api/cron/send-notification-emails/route");
const DUMMY = "dummy-secret-for-test";
const req = (auth?: string) => new Request("http://x/api/cron/send-notification-emails", { headers: auth ? { authorization: auth } : {} });
function withEnv(env: Record<string, string | undefined>, fn: () => Promise<void>) {
  const keys = ["CRON_SECRET", "EMAIL_PROVIDER", "RESEND_API_KEY", "EMAIL_FROM", "NEXT_PUBLIC_SITE_URL", "VERCEL_ENV"]; const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
  return fn().finally(() => { for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
}
const full = { CRON_SECRET: DUMMY, EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_dummy", EMAIL_FROM: "x@example.com", NEXT_PUBLIC_SITE_URL: "https://example.com" };

test("認証: ヘッダなし・不一致は401でDB・ワーカーに触れない／CRON_SECRET未設定は500で実行しない", async () => {
  await withEnv(full, async () => {
    calls.length = 0;
    for (const h of [undefined, "Bearer wrong", DUMMY, `Bearer ${DUMMY}x`, "Bearer "]) { const r = await GET(req(h)); assert.equal(r.status, 401); }
    assert.equal((await POST(req())).status, 401); assert.deepEqual(calls, []);
  });
  await withEnv({ ...full, CRON_SECRET: undefined }, async () => {
    calls.length = 0; const r = await GET(req(`Bearer ${DUMMY}`)); assert.equal(r.status, 500); assert.equal((await r.json()).error, "cron_not_configured"); assert.deepEqual(calls, []);
  });
});

test("設定不備・停止時は送らない: EMAIL_PROVIDER未設定/disabledは何もせず(skipped)、resendで鍵なし・サイトURLなしは500", async () => {
  for (const p of [undefined, "disabled"]) await withEnv({ ...full, EMAIL_PROVIDER: p }, async () => { calls.length = 0; const r = await GET(req(`Bearer ${DUMMY}`)); assert.equal(r.status, 200); assert.equal((await r.json()).skipped, "provider_disabled"); assert.deepEqual(calls, []); });
  await withEnv({ ...full, RESEND_API_KEY: undefined }, async () => { calls.length = 0; assert.equal((await GET(req(`Bearer ${DUMMY}`))).status, 500); assert.deepEqual(calls, []); });
  await withEnv({ ...full, NEXT_PUBLIC_SITE_URL: undefined }, async () => { calls.length = 0; const r = await GET(req(`Bearer ${DUMMY}`)); assert.equal(r.status, 500); assert.equal((await r.json()).error, "site_url_not_configured"); assert.deepEqual(calls, []); });
  await withEnv({ ...full, EMAIL_PROVIDER: "capture", VERCEL_ENV: "production" }, async () => { calls.length = 0; assert.equal((await GET(req(`Bearer ${DUMMY}`))).status, 500, "本番でcaptureは拒否"); assert.deepEqual(calls, []); });
});

test("正しい認証＋設定が揃ったときだけワーカーを1回実行する(Vercel Cronの呼び方=GET)", async () => {
  await withEnv(full, async () => { calls.length = 0; const r = await GET(req(`Bearer ${DUMMY}`)); assert.equal(r.status, 200); const j = await r.json(); assert.equal(j.success, true); assert.equal(j.provider, "resend"); assert.deepEqual(calls, ["client", "worker"]); });
});
