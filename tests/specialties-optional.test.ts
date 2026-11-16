import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isSpecialtiesOptional, specialtiesError, SPECIALTIES_REQUIRED_MESSAGE,
} from "../lib/profile/specialties-rule";
import { profileFormSchema, profileFormSchemaSpecialtiesOptional } from "../lib/validation/profile";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("rule: 新卒だけ任意", () => {
  assert.equal(isSpecialtiesOptional("new_graduate"), true);
  for (const p of ["active", "blank", "", null, undefined, "student"]) assert.equal(isSpecialtiesOptional(p), false);
  assert.equal(specialtiesError("new_graduate", 0), null);
  assert.equal(specialtiesError("new_graduate", 2), null);
  assert.equal(specialtiesError("active", 0), SPECIALTIES_REQUIRED_MESSAGE);
  assert.equal(specialtiesError("blank", 0), SPECIALTIES_REQUIRED_MESSAGE);
  assert.equal(specialtiesError(undefined, 0), SPECIALTIES_REQUIRED_MESSAGE);
  assert.equal(specialtiesError("active", 1), null);
});

const base = {
  publicName: "テスト", prefecture: "東京都", desiredWorkLocation: "", experienceYears: "1",
  currentPosition: "", specialties: [] as string[], employmentType: "full_time", jobChangeIntent: "considering",
  snsLinks: [], bio: "", avatarPath: "", fullName: "山田 花子", ageBand: "20_24", gender: "female",
  valuePriorities: ["a", "b", "c"], visibility: "public",
};

function specialtyIssues(schema: typeof profileFormSchema, specialties: string[]) {
  const r = schema.safeParse({ ...base, specialties });
  if (r.success) return [] as string[];
  return r.error.issues.filter((i) => i.path[0] === "specialties").map((i) => i.message);
}

test("schema: 必須版は0件を拒否、任意版は0件を許す", () => {
  assert.deepEqual(specialtyIssues(profileFormSchema, []), [SPECIALTIES_REQUIRED_MESSAGE]);
  assert.deepEqual(specialtyIssues(profileFormSchemaSpecialtiesOptional, []), []);
  assert.deepEqual(specialtyIssues(profileFormSchemaSpecialtiesOptional, ["カット"]), []);
});

test("schema: 重要な項目は任意版でも3つ必須のまま", () => {
  for (const s of [profileFormSchema, profileFormSchemaSpecialtiesOptional]) {
    const r = s.safeParse({ ...base, valuePriorities: ["a", "b"] });
    assert.equal(r.success, false);
    assert.ok(!r.success && r.error.issues.some((i) => i.path[0] === "valuePriorities"));
  }
});

test("server: 立場で検証を切り替え、保存直前に立場込みで再確認する", () => {
  const a = read("lib/profile/actions.ts");
  assert.match(a, /isSpecialtiesOptional\(formData\.get\("careerPhase"\)\)/);
  assert.match(a, /specialtiesError\(careerArgs\?\.p_career_phase, v\.specialties\.length\)/);
  assert.match(a, /p_specialties: v\.specialties/);
});

test("client: ウィザード・編集とも共通ルールと任意表示を使う", () => {
  const w = read("components/profile/stylist-onboarding-wizard.tsx");
  const f = read("components/profile/profile-form.tsx");
  assert.match(w, /specialtiesError\(get\("careerPhase"\)/);
  assert.doesNotMatch(w, /得意技術を1つ以上選択してください/);
  for (const src of [w, f]) {
    assert.match(src, /<SpecialtiesField/);
    assert.match(src, /onPhaseChange=\{setCareerPhase\}/);
  }
  const s = read("components/profile/specialties-field.tsx");
  assert.match(s, /得意技術（任意）/);
  assert.match(s, /SPECIALTIES_PHASE_CHANGED_MESSAGE/);
});

test("診断結果から得意技術を自動入力しない", () => {
  const s = read("components/profile/specialties-field.tsx") + read("lib/profile/specialties-rule.ts");
  assert.doesNotMatch(s, /diagnosis/i);
});
