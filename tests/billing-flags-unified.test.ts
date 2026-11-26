import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { flagEnabled, hireBillingEnabled, scoutLedgerEnabled } from "../lib/billing/hire-flags";
import { visitFeeEnabled } from "../lib/billing/visit-fee-flag";

const MATRIX: [string | undefined, boolean][] = [["1", true], ["true", false], ["TRUE", false], ["0", false], ["false", false], ["", false], [" 1", false], ["1 ", false], ["yes", false], [undefined, false]];

test("新機能フラグ: 有効を表す値は '1' だけ。3つのフラグと請求ジョブが同じ判定を使う", () => {
  for (const [v, on] of MATRIX) {
    assert.equal(flagEnabled(v), on, `flagEnabled(${JSON.stringify(v)})`);
    assert.equal(hireBillingEnabled({ HIRE_BILLING_ENABLED: v }), on);
    assert.equal(scoutLedgerEnabled({ SCOUT_LEDGER_ENABLED: v }), on);
    assert.equal(visitFeeEnabled({ VISIT_FEE_ENABLED: v }), on);
  }
});

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) { if (n === "node_modules" || n === ".next" || n.startsWith(".")) continue; const p = join(dir, n); if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(n)) out.push(p); }
  return out;
}
test("新機能フラグ: アプリのコードは、環境変数を直接比較せず、判定は hire-flags.ts の1か所だけ", () => {
  const offenders: string[] = [];
  for (const f of [...walk("app"), ...walk("lib"), ...walk("components")]) {
    if (f.endsWith("hire-flags.ts") || f.includes("/env/validate")) continue;
    const src = readFileSync(f, "utf8").split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");   // コメント行は除く
    if (/(process\.)?env\.(HIRE_BILLING_ENABLED|SCOUT_LEDGER_ENABLED|VISIT_FEE_ENABLED)\b/.test(src.replace(/hireBillingEnabled\(env\)/g, ""))) {
      if (!/(hire-flags|visit-fee-flag)/.test(f)) offenders.push(f);
    }
  }
  assert.deepEqual(offenders, [], "直接比較しているファイル");
});
test("請求ジョブ・画面・サーバー処理は、hireBillingEnabled を共通で使う", () => {
  assert.match(readFileSync("app/api/cron/hire-fee-charge/route.ts", "utf8"), /hireBillingEnabled\(\)/);
  assert.match(readFileSync("lib/billing/hire-actions.ts", "utf8"), /hireBillingEnabled\(\)/);
  assert.match(readFileSync("lib/billing/hire-guard.ts", "utf8"), /hireBillingEnabled\(env\)/);
});
