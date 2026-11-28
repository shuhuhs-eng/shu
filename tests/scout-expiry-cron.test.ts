import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("毎日の失効: vercel.json に日本時間0:10(UTC 15:10)の日次cronがある", () => {
  const j = JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] };
  const c = j.crons.filter((x) => x.path === "/api/cron/scout-expiry");
  assert.equal(c.length, 1); assert.equal(c[0].schedule, "10 15 * * *");
  assert.ok(j.crons.some((x) => x.path === "/api/cron/hire-fee-charge"), "既存のcronは維持");
});
test("失効cron: 認証→フラグ確認→その後でだけDBクライアントを作る（フラグ未設定ではDBに触れない）", () => {
  const s = read("app/api/cron/scout-expiry/route.ts");
  const a = s.indexOf("verifyCronAuth("), f = s.indexOf("scoutLedgerEnabled()"), d = s.indexOf("createServiceClient()");
  assert.ok(a > 0 && f > a && d > f); assert.match(s, /enabled: false/); assert.match(s, /status: 401/);
});
test("失効cron: 返金・決済・Stripeには触れない（失効の記録だけ）", () => {
  const s = read("app/api/cron/scout-expiry/route.ts");
  assert.match(s, /service_scout_expire_due/); assert.doesNotMatch(s, /stripe|refund/i);
});
