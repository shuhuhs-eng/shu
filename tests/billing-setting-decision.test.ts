import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { decideHireRoleRule } from "../lib/billing/hire-actions";
import { BILLING_SETTING_LABELS, hireErrorMessage } from "../lib/billing/hire-agreement";

const root = new URL("../", import.meta.url).pathname;
const src = (p: string) => readFileSync(join(root, p), "utf8");
function walk(d: string, out: string[] = []): string[] {
  for (const n of readdirSync(join(root, d))) { const p = join(d, n); if (n === "node_modules" || n === ".next") continue; statSync(join(root, p)).isDirectory() ? walk(p, out) : /\.(ts|tsx)$/.test(n) && out.push(p); }
  return out;
}

test("決定操作は、確認チェック（true）が無いと、DBを呼ぶ前に拒否する", async () => {
  for (const v of [false, undefined, "true", 1]) { const r = await decideHireRoleRule({ understood: v as never }); assert.equal(r.success, false); assert.ok(!r.success && r.error.includes("チェック")); }
});
test("機能フラグがオフの間は、確認チェックがあっても何もしない", async () => {
  const keep = process.env.HIRE_BILLING_ENABLED; delete process.env.HIRE_BILLING_ENABLED;
  try { const r = await decideHireRoleRule({ understood: true }); assert.equal(r.success, false); assert.ok(!r.success && r.error.includes("まだ有効になっていません")); }
  finally { if (keep !== undefined) process.env.HIRE_BILLING_ENABLED = keep; }
});
test("画面・サーバー処理から変更できる課金設定は、採用料の登録区分ルールの決定の1操作だけ（自動請求・カード必須化を変える経路が無い）", () => {
  const files = [...walk("app"), ...walk("lib"), ...walk("components")];
  for (const f of files) {
    const s = src(f);
    assert.ok(!s.includes("admin_billing_setting_set"), `${f}: 汎用の設定変更RPCを呼んでいる`);
    assert.ok(!/rpc\([^)]*["']admin_billing_setting_set|billing_settings["']\)\.(update|upsert|insert)|from\(["']billing_settings/.test(s), `${f}: 課金設定を直接書き換えている`);
  }
  const act = src("lib/billing/hire-actions.ts");
  assert.ok(/call\("admin_billing_hire_role_rule_decide", \{\}, ADMIN\)/.test(act), "項目名・値を画面から受け取らない固定の操作");
});
test("課金設定の画面: 変更履歴・決定ボタンは責任者だけ。自動請求・カード必須化は表示のみで、変更できないと明記", () => {
  const page = src("app/admin/hire-agreements/page.tsx");
  assert.ok(/!responsible \?[\s\S]*changes\?\.ok \? <HireRoleRuleDecision \/>/.test(page) && /responsible \? await listSettingChanges/.test(page));
  assert.ok(page.includes("履歴が残らない変更は行いません"), "履歴機能が使えない間は決定ボタンを出さない");
  assert.ok(page.includes("自動請求とカード必須化は、この画面からは変更できません"));
  assert.equal(BILLING_SETTING_LABELS.auto_charge_enabled, "採用料の自動請求"); assert.equal(BILLING_SETTING_LABELS.salon_card_required, "サロンのカード必須化");
  const panel = src("components/admin/billing-settings-panel.tsx");
  assert.ok(panel.includes("disabled={busy || !ok}") && panel.includes("変更されません（OFFのまま）"));
});
test("DB草案0112: 履歴は追記専用・直接参照不可・責任者のみ。決定操作は自動請求とカード必須化の前後の値を照合する", () => {
  const sql = src("docs/hire-fee-role-db/0112_billing_setting_history.DRAFT_NOT_APPLIED.sql");
  assert.ok(sql.includes("append-only") && sql.includes("revoke all on public.billing_setting_changes from public, anon, authenticated, service_role"));
  assert.ok(sql.includes("_billing_responsible_guard()") && sql.includes("auto charge or card requirement changed unexpectedly"));
  assert.ok(!/admin_billing_setting_set\('(auto_charge_enabled|salon_card_required)'/.test(sql));
  assert.ok(hireErrorMessage("hire role rule already decided").includes("決定済み"));
});
