import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hiringFeeAmounts } from "../lib/billing/hiring-fee-rules";
import { agreementActions, FEE_ROLE_FIELD_LABEL, FEE_ROLE_GUIDE, FEE_ROLE_UNCONFIRMED_GUIDE, hireErrorMessage, UNDECIDED_NOTES } from "../lib/billing/hire-agreement";

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const panel = src("components/admin/hire-agreement-panel.tsx");
const card = src("components/hiring/hire-confirm-card.tsx");
const detail = src("app/admin/hire-agreements/[id]/page.tsx");

test("料金は登録区分だけで決まる（スタイリスト登録は担当業務がアシスタントでも税抜55万円、アシスタント登録は45万円）", () => {
  assert.deepEqual(hiringFeeAmounts("stylist"), { fee: 550000, tax: 55000, total: 605000 });
  assert.deepEqual(hiringFeeAmounts("assistant"), { fee: 450000, tax: 45000, total: 495000 });
  assert.ok(FEE_ROLE_GUIDE.includes("担当する業務") && FEE_ROLE_GUIDE.includes("550,000") && FEE_ROLE_GUIDE.includes("450,000"));
});
test("運営画面のラベルは「本人に確認した登録区分（採用料）」で、担当業務と混同しない案内がある", () => {
  assert.equal(FEE_ROLE_FIELD_LABEL, "本人に確認した登録区分（採用料）");
  assert.ok(panel.includes("FEE_ROLE_FIELD_LABEL") && panel.includes("FEE_ROLE_GUIDE") && panel.includes("FEE_ROLE_UNCONFIRMED_GUIDE"));
  assert.ok(detail.includes("FEE_ROLE_FIELD_LABEL"));
  for (const s of [panel, detail, card]) assert.ok(!s.includes("役職（採用料の区分）") && !s.includes("役職:"), "旧ラベル「役職」が残っている");
  assert.ok(FEE_ROLE_UNCONFIRMED_GUIDE.includes("確認が取れるまで"));
});
test("登録区分が未確認のままでは記録できず、サロンも確定できない", () => {
  assert.ok(/disabled=\{busy \|\| !date \|\| !role \|\| !roleConfirmed\}/.test(panel), "確認チェックなしでは記録ボタンが押せない");
  assert.ok(card.includes("v.fee_role != null") && card.includes("!canConfirm"));   // 区分が無い契約は確定ボタンが無効
  assert.equal(agreementActions("awaiting_intent", true, false).recordIntent, true);
  assert.ok(hireErrorMessage("fee role required").includes("登録区分"));
  assert.ok(hireErrorMessage("start date and fee role required").includes("登録区分"));
});
test("運営の参考表示はプロフィールの現在の役職（自由記入）だけで、区分は自動判定しない", () => {
  assert.ok(detail.includes("current_position") && panel.includes("positionRef"));
  assert.ok(panel.includes("自動では使いません"));
  assert.ok(!/setRole\(.*positionRef/.test(panel) && !/useState<FeeRole \| "">\(.*positionRef/.test(panel));
});
test("サロンには本人確認済みの登録区分・税抜・税・合計・請求予定日を示し、訂正時は版照合で再確認させる", () => {
  for (const k of ["本人に確認済みの登録区分", "v.fee_excl_tax", "v.tax", "v.total_amount", "v.charge_on", "expectedRevision: v.revision", "reconfirm"]) assert.ok(card.includes(k), k);
  assert.ok(card.includes("入社後に担当する業務では変わりません"));
  assert.ok(hireErrorMessage("stale agreement revision").includes("読み込み直して"));
  assert.ok(hireErrorMessage("terms changed after confirmation; reconfirmation required").includes("再確認"));
});
test("決定を反映: 未決定表示は決定済みの規則を示し、自動請求は有効化されない", () => {
  assert.ok(UNDECIDED_NOTES.hire_fee_role_source.includes("2026-11-27決定") && UNDECIDED_NOTES.hire_fee_role_source.includes("自動請求は有効にできません"));
  assert.ok(!UNDECIDED_NOTES.hire_fee_role_source.includes("判定元は未決定"));
});

test("サーバー側: 本人確認の申告（true）が無い記録・訂正は、DBを呼ぶ前に拒否する", async () => {
  const { recordStylistIntent, changeHirePlan } = await import("../lib/billing/hire-actions");
  const base = { agreementId: "11111111-1111-4111-8111-111111111111", expectedRevision: 1, startDate: "2027-04-01", feeRole: "stylist" };
  for (const flag of [false, undefined, "true", 1]) {
    const a = await recordStylistIntent({ ...base, roleConfirmedWithStylist: flag as never });
    const b = await changeHirePlan({ ...base, roleConfirmedWithStylist: flag as never });
    assert.equal(a.success, false); assert.equal(b.success, false);
    assert.ok(!a.success && a.error.includes("本人に確認"));
  }
  assert.ok(panel.includes("roleConfirmedWithStylist: roleConfirmed"));
});
