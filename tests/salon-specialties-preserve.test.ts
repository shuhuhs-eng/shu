import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveStoredSpecialties } from "../lib/salon/preserve-specialties";

test("DBの現在値をそのまま返す（フォームの値は使わない）", async () => {
  const r = await resolveStoredSpecialties(async () => ({ data: { target_specialties: ["cut", "color"] }, error: null }));
  assert.deepEqual(r, { ok: true, value: ["cut", "color"] });
});
test("行が無い（新規）・null は空配列で保存できる", async () => {
  assert.deepEqual(await resolveStoredSpecialties(async () => ({ data: null, error: null })), { ok: true, value: [] });
  assert.deepEqual(await resolveStoredSpecialties(async () => ({ data: { target_specialties: null }, error: null })), { ok: true, value: [] });
});
test("読み取り失敗・例外のときは保存させない（空で上書きしない）", async () => {
  assert.deepEqual(await resolveStoredSpecialties(async () => ({ data: null, error: { message: "x" } })), { ok: false });
  assert.deepEqual(await resolveStoredSpecialties(async () => { throw new Error("boom"); }), { ok: false });
});
test("2つの保存処理は画面の得意技術を使わず、読み直した値をRPCへ渡す。画面に入力欄・隠し項目は無い", () => {
  const a = readFileSync("lib/salon/actions.ts", "utf8");
  const b = readFileSync("lib/salon/store-actions.ts", "utf8");
  for (const s of [a, b]) assert.ok(!/formData\.getAll\("targetSpecialties"\)/.test(s));
  assert.match(a, /p_target_specialties: stored\.value/);
  assert.match(b, /targetSpecialties: stored\.value/);
  for (const f of ["components/salon-profile/salon-profile-form.tsx", "components/salon-profile/salon-store-profile-form.tsx"]) {
    const t = readFileSync(f, "utf8");
    assert.ok(!t.includes("採用したい得意技術") && !t.includes('name="targetSpecialties"'));
  }
});
