import test from "node:test";
import assert from "node:assert/strict";
import { isRecruitingPausedError, toRecruitingAccessView, RECRUITING_PAUSED_MESSAGE } from "../lib/contracts/recruiting-access";
import { canViewCompanyBilling } from "../lib/billing/permissions";
import { hasCompanyLevelRole, canManageStoreHiringHint } from "../lib/hiring/permissions";

test("採用停止エラーの判定と、契約状態を出さない文言", () => {
  assert.equal(isRecruitingPausedError("ERROR: recruiting is paused for this organization"), true);
  assert.equal(isRecruitingPausedError("other"), false);
  assert.equal(isRecruitingPausedError(null), false);
  assert.ok(!/trial|suspended|契約|金額/.test(RECRUITING_PAUSED_MESSAGE));
});
test("採用可否の表示: 取得失敗時は止めない(最終防衛はDB)", () => {
  assert.deepEqual(toRecruitingAccessView({ new_recruiting_allowed: false }), { paused: true });
  assert.deepEqual(toRecruitingAccessView({ new_recruiting_allowed: true }), { paused: false });
  assert.deepEqual(toRecruitingAccessView(null), { paused: false });
  assert.deepEqual(toRecruitingAccessView("x"), { paused: false });
});

// 最小のSupabaseスタブ: from(table).select().eq()...  が await でき、maybeSingle/limit も使える
type Row = Record<string, string>;
function stub(tables: Record<string, Row[]>) {
  const make = (rows: Row[]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = {
      select: () => q, eq: () => q, limit: () => q,
      maybeSingle: async () => ({ data: rows[0] ?? null }),
      then: (res: (v: unknown) => unknown) => res({ data: rows }),
    };
    return q;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: (t: string) => make(tables[t] ?? []) } as any;
}
const U = "u1";
test("請求閲覧は company_owner / company_admin のみ", async () => {
  for (const [role, ok] of [["company_owner", true], ["company_admin", true], ["recruiting_admin", false], ["store_manager", false], ["viewer", false]] as const) {
    assert.equal(await canViewCompanyBilling(stub({ organization_members: [{ role }] }), U), ok, role);
  }
  assert.equal(await canViewCompanyBilling(stub({}), U), false);
});
test("会社レベル役割", async () => {
  for (const [role, ok] of [["company_owner", true], ["recruiting_admin", true], ["area_manager", true], ["store_manager", false], ["viewer", false]] as const) {
    assert.equal(await hasCompanyLevelRole(stub({ organization_members: [{ role }] }), U), ok, role);
  }
});
test("店舗の採用書き込みヒント: viewer は不可", async () => {
  assert.equal(await canManageStoreHiringHint(stub({ organization_members: [{ role: "viewer" }], store_members: [{ role: "viewer" }] }), U, "s", "o"), false);
  assert.equal(await canManageStoreHiringHint(stub({ store_members: [{ role: "recruiter" }] }), U, "s", "o"), true);
  assert.equal(await canManageStoreHiringHint(stub({ organization_members: [{ role: "recruiting_admin" }] }), U, "s", "o"), true);
  assert.equal(await canManageStoreHiringHint(stub({ organization_members: [{ role: "area_manager" }], store_members: [{ role: "viewer" }] }), U, "s", "o"), true);
  assert.equal(await canManageStoreHiringHint(stub({ organization_members: [{ role: "area_manager" }] }), U, "s", "o"), false);
});
