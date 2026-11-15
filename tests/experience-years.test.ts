// 経験年数（案A: 全員任意）: 空欄=NULL（未登録）、明示的な0=0。保存処理（saveProfileAction）と表示・入力欄を確認する。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

type Call = { name: string; args: Record<string, unknown> };
const env: { support: "ok" | "unsupported" | "error"; rpcError: boolean; calls: Call[]; removed: string[][] } = {
  support: "ok", rpcError: false, calls: [], removed: [],
};

function fakeSupabase() {
  const chain = (table: string, cols: string) => ({
    eq: () => ({
      single: async () => ({ data: { id: "u1", avatar_path: "u1/avatar.webp" }, error: null }),
      maybeSingle: async () => {
        if (table === "stylist_private" && cols === "age_display_mode") {
          if (env.support === "unsupported") return { data: null, error: { code: "42703", message: 'column "age_display_mode" does not exist' } };
          if (env.support === "error") return { data: null, error: { code: "XX000", message: "boom" } };
          return { data: null, error: null };
        }
        // 立場（0071）未適用のDBとして扱う（このテストは経験年数の保存だけを確認する。立場の必須は profile-save-career-phase.test.ts）
        if (table === "stylist_profiles" && cols.includes("career_phase")) return { data: null, error: { code: "42703", message: "column stylist_profiles.career_phase does not exist" } };
        return { data: null, error: null };
      },
    }),
  });
  return {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: (table: string) => ({ select: (cols: string) => chain(table, cols) }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      env.calls.push({ name, args });
      return { data: null, error: env.rpcError ? { message: "failed" } : null };
    },
    storage: { from: () => ({ remove: async (p: string[]) => { env.removed.push(p); return { error: null }; } }) },
  };
}

const originalLoad = (Module as unknown as { _load: (...a: unknown[]) => unknown })._load;
(Module as unknown as { _load: unknown })._load = function (request: string, ...rest: unknown[]) {
  if (request === "next/cache") return { revalidatePath: () => undefined };
  if (request === "@/lib/supabase/server") return { createClient: async () => fakeSupabase() };
  return originalLoad.call(this, request, ...rest);
};
after(() => { (Module as unknown as { _load: unknown })._load = originalLoad; });

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { saveProfileAction } = require("../lib/profile/actions");

function form(extra: Record<string, string | string[]> = {}): FormData {
  const f = new FormData();
  const base: Record<string, string | string[]> = {
    publicName: "さくら", prefecture: "東京都", experienceYears: "3", specialties: ["カット"], employmentType: "full_time",
    jobChangeIntent: "passive", fullName: "山田 花子", ageBand: "30_34", gender: "female",
    valuePriorities: ["work_life_balance", "skill_growth", "income_stability"], visibility: "PUBLIC",
    desiredWorkLocation: "", currentPosition: "", bio: "", avatarPath: "", ...extra,
  };
  for (const [k, v] of Object.entries(base)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}
const run = async (f: FormData, support: typeof env.support = "ok", rpcError = false) => {
  env.support = support; env.rpcError = rpcError; env.calls = []; env.removed = [];
  return saveProfileAction({}, f);
};
const names = () => env.calls.map((c) => c.name);


const pick = () => env.calls[0].args.p_experience_years;
const ok = { birthDate: "1990-04-01", ageDisplayMode: "exact" };

test("保存: 空欄・空白は NULL（未登録）としてDBへ渡す（0へ変換しない）。対応済み・従来どちらの保存関数でも同じ", async () => {
  for (const v of ["", "  "]) {
    assert.equal((await run(form({ ...ok, experienceYears: v }))).error, undefined);
    assert.equal(names()[0], "save_stylist_profile_v2");
    assert.strictEqual(pick(), null, JSON.stringify(v));
  }
  await run(form({ experienceYears: "" }), "unsupported");
  assert.equal(names()[0], "save_stylist_profile");
  assert.strictEqual(pick(), null);
});

test("保存: 明示的な 0 は 0、数字はそのまま（NULLと区別される）", async () => {
  await run(form({ ...ok, experienceYears: "0" })); assert.strictEqual(pick(), 0);
  await run(form({ ...ok, experienceYears: "5" })); assert.strictEqual(pick(), 5);
  await run(form({ ...ok, experienceYears: "60" })); assert.strictEqual(pick(), 60);
});

test("保存: 非数・小数・負数・61以上は拒否し、DBへ何も送らない", async () => {
  for (const v of ["abc", "2.5", "-1", "61", "１２"]) {
    const r = await run(form({ ...ok, experienceYears: v }));
    assert.ok(r.fieldErrors?.experienceYears, v);
    assert.deepEqual(names(), [], v);
  }
});

// ---- 検査・表示の純粋関数と、画面の表示・入力欄 ----
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseExperienceYears, formatExperienceInline, formatExperienceValue } from "../lib/profile/experience-years";
import { StylistPublicView } from "../components/profile/stylist-public-view";

test("検査: 空欄・空白・null=NULL、'0'=0、整数0〜60のみ", () => {
  for (const v of ["", " ", "\t", null, undefined]) assert.deepEqual(parseExperienceYears(v), { ok: true, value: null }, String(v));
  assert.deepEqual(parseExperienceYears("0"), { ok: true, value: 0 });
  assert.deepEqual(parseExperienceYears(0), { ok: true, value: 0 });
  assert.deepEqual(parseExperienceYears(" 12 "), { ok: true, value: 12 });
  for (const v of ["abc", "2.5", "-1", "61", "1e2", NaN, 2.5, {}, []]) assert.equal(parseExperienceYears(v).ok, false, String(v));
});

test("表示の文言: NULL=未登録／0=0年（区別される）", () => {
  assert.equal(formatExperienceValue(null), "未登録");
  assert.equal(formatExperienceValue(undefined), "未登録");
  assert.equal(formatExperienceValue(0), "0年");
  assert.equal(formatExperienceValue(7), "7年");
  assert.equal(formatExperienceInline(null), "経験年数：未登録");
  assert.equal(formatExperienceInline(0), "経験0年");
  assert.equal(formatExperienceInline(7), "経験7年");
});

test("サロン向け・本人プレビュー共通の部品: NULLは「経験年数 未登録」、0は「0年」", () => {
  const base = { publicName: "さくら", prefecture: "東京都", currentPosition: null, desiredWorkLocation: null, jobChangeIntent: null, specialties: [], bio: null };
  const html = (y: number | null) => renderToStaticMarkup(createElement(StylistPublicView, { data: { ...base, experienceYears: y } })).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.ok(/経験年数 未登録/.test(html(null)) && !/0年/.test(html(null)));
  assert.ok(/経験年数 0年/.test(html(0)) && !/未登録/.test(html(0)));
  const preview = readFileSync("app/stylist/profile/preview/page.tsx", "utf8");
  assert.ok(preview.includes("StylistPublicView") && preview.includes("experienceYears: pub.experience_years"), "本人プレビューもサロンと同じ部品・同じ値");
});

test("サロン側の各画面は共通の文言関数を使い、NULLでも「経験年数：未登録」を出す（非表示にしない）", () => {
  for (const f of ["app/salon/stores/[storeId]/candidates/page.tsx", "app/salon/stores/[storeId]/candidates/[processId]/page.tsx", "app/salon/mypage/page.tsx", "components/store-activity/store-interest-card.tsx"]) {
    const s = readFileSync(f, "utf8");
    assert.ok(s.includes("formatExperienceInline("), f);
    assert.ok(!/experience_years != null/.test(s), `${f}: NULLを非表示にする分岐が残っていない`);
  }
  assert.ok(readFileSync("app/admin/stylists/[userId]/page.tsx", "utf8").includes("formatExperienceValue("));
});

test("入力欄: 編集・登録ウィザードとも経験年数は任意（requiredなし・必須チェックなし）", () => {
  const edit = readFileSync("components/profile/profile-form.tsx", "utf8");
  const wiz = readFileSync("components/profile/stylist-onboarding-wizard.tsx", "utf8");
  for (const [name, s] of [["edit", edit], ["wizard", wiz]] as const) {
    const i = s.indexOf('name="experienceYears"');
    const block = s.slice(i, i + 400);
    assert.ok(block.includes("（任意）") && block.includes("required={false}"), name);
  }
  assert.ok(!wiz.includes("美容師経験年数を入力してください"));
});

test("既存の値は変更しない: この変更はDB・SQLを含まず、読み込みは保存済みの値をそのまま文字列にする", () => {
  const init = readFileSync("lib/profile/get-initial-values.ts", "utf8");
  assert.ok(init.includes('pub?.experience_years != null ? String(pub.experience_years) : ""'));
});
