import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("components/salon-culture/analysis-form.tsx", "utf8");

test("追加5問: 成功表示は保存成功の後だけ（失敗・例外の分岐より後ろでのみ setSaved(true)）", () => {
  assert.equal(src.match(/setSaved\(true\)/g)?.length, 1);
  const iFail = src.indexOf("if (!result.success)");
  const iOk = src.indexOf("setSaved(true)");
  assert.ok(iFail > 0 && iOk > iFail, "失敗の分岐(return)より後ろ");
  assert.ok(src.slice(iFail, iOk).includes("return;"));
  assert.ok(src.includes("回答を保存しました"));
});

test("追加5問: 回答を変える・再保存を始めると成功表示は消え、失敗時は回答とエラーが残る", () => {
  const setFn = src.slice(src.indexOf("function set("), src.indexOf("async function handleSave"));
  assert.ok(setFn.includes("setSaved(false)"));
  const h = src.slice(src.indexOf("async function handleSave"), src.indexOf("return (\n    <div className=\"space-y-6\">"));
  assert.ok(h.indexOf("setSaved(false)") < h.indexOf("await save("));
  assert.ok(!h.includes("setValues(") && h.includes("setError({ code: result.code"));
});

test("追加5問: 保存処理（Server Action）は変えない", () => {
  assert.ok(src.includes("save(values as SupplementAnswers, expectedBase, requestRef.current.id, needAck && acked)"));
});
