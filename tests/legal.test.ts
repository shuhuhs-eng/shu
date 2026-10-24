import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { isLegalGatedPath, legalGateDecision, safeNextPath } from "../lib/legal/gate";
import { buildLegalSnapshot, serializeLegalSnapshot, parseLegalSnapshot, sameBody } from "../lib/legal/snapshot";
import { LEGAL_DOCUMENTS } from "../lib/legal/documents";
import { isLegalOperatorInfoComplete } from "../lib/legal/config";

const op = { name: "株式会社テスト", address: "東京都", contactEmail: "a@example.com", effectiveDate: "2026-11-01" };

test("ゲート対象: サービス本体のみ。公開ページ・認証・規約・APIは対象外", () => {
  for (const p of ["/mypage", "/stylist/mypage", "/salon/company/billing", "/onboarding/salon", "/profile/edit"]) assert.equal(isLegalGatedPath(p), true, p);
  for (const p of ["/", "/login", "/terms", "/privacy", "/legal/accept", "/legal/unavailable", "/auth/callback", "/api/invoices/x/pdf", "/stylist", "/stylist/login", "/salon", "/salon/login", "/diagnosis", "/admin"]) assert.equal(isLegalGatedPath(p), false, p);
});
test("ゲート判定: 未同意→accept / 確認失敗→unavailable(fail-closed) / 対象外は常に allow", () => {
  assert.equal(legalGateDecision("/mypage", "ok"), "allow");
  assert.equal(legalGateDecision("/mypage", "pending"), "accept");
  assert.equal(legalGateDecision("/mypage", "error"), "unavailable");
  assert.equal(legalGateDecision("/terms", "error"), "allow");
  assert.equal(legalGateDecision("/legal/accept", "pending"), "allow"); // ループしない
  assert.equal(legalGateDecision("/legal/unavailable", "error"), "allow");
});
test("safeNextPath: 外部URL・プロトコル相対・バックスラッシュ・同意画面自身を拒否", () => {
  assert.equal(safeNextPath("/mypage"), "/mypage");
  for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "evil", "", null, undefined, "/legal/accept", "/legal/unavailable"]) {
    assert.equal(safeNextPath(bad as string | null | undefined), "/", String(bad));
  }
});
test("スナップショット: 運営者情報が不完全なら作らない", () => {
  assert.equal(buildLegalSnapshot(LEGAL_DOCUMENTS.terms, { ...op, name: null }, "2026-11-01"), null);
  assert.equal(isLegalOperatorInfoComplete({ ...op, effectiveDate: null }), false);
  assert.equal(isLegalOperatorInfoComplete(op), true);
});
test("スナップショット: 決定的・往復可能・ハッシュが安定", () => {
  const a = buildLegalSnapshot(LEGAL_DOCUMENTS.terms, op, "2026-11-01")!;
  const b = buildLegalSnapshot(LEGAL_DOCUMENTS.terms, op, "2026-11-01")!;
  assert.equal(serializeLegalSnapshot(a), serializeLegalSnapshot(b));
  const parsed = parseLegalSnapshot(serializeLegalSnapshot(a));
  assert.ok(parsed && sameBody(parsed, a));
  const h = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
  assert.equal(h(serializeLegalSnapshot(a)), h(serializeLegalSnapshot(b)));
  const other = buildLegalSnapshot(LEGAL_DOCUMENTS.terms, op, "2026-12-01")!;
  assert.notEqual(h(serializeLegalSnapshot(a)), h(serializeLegalSnapshot(other)));
  assert.equal(parseLegalSnapshot("{broken"), null);
});
test("規約と個人情報の本文は別文書で版を持つ", () => {
  assert.notEqual(LEGAL_DOCUMENTS.terms.type, LEGAL_DOCUMENTS.privacy.type);
  assert.ok(LEGAL_DOCUMENTS.terms.version && LEGAL_DOCUMENTS.privacy.version);
});
