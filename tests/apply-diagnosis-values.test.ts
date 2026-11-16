// 診断結果の「大切にしたい働き方」。変更案の表示のみ（保存は一時停止中）。推測で変換しない。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { proposeValuePriorities, validateValuePriorities } from "../lib/profile/apply-diagnosis-values";
import Module from "node:module";
// ボタン（クライアント部品）が使う next/navigation と、サーバーアクションの依存は、描画確認のためスタブにする
const origLoad = (Module as unknown as { _load: (...a: unknown[]) => unknown })._load;
(Module as unknown as { _load: unknown })._load = function (request: string, ...rest: unknown[]) {
  if (request === "next/navigation") return { useRouter: () => ({ refresh: () => undefined }) };
  if (request === "@/lib/profile/apply-values-actions") return { applyValuePrioritiesAction: async () => ({ ok: true }) };
  return origLoad.call(this, request, ...rest);
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ApplyValuesToProfile } = require("../components/student-diagnosis/apply-values-to-profile");
after(() => { (Module as unknown as { _load: unknown })._load = origLoad; });

test("変更案: 診断の選択（選んだ順）と同じ一覧のコードだけ。一覧に無いコードは変換せず除く。3つに足りなければ不足数を返す（補わない）", () => {
  assert.deepEqual(proposeValuePriorities(["teamwork", "independence", "culture_fit"]), { proposed: ["teamwork", "independence", "culture_fit"], missing: 0, dropped: 0 });
  assert.deepEqual(proposeValuePriorities(["teamwork", "independence"]), { proposed: ["teamwork", "independence"], missing: 1, dropped: 0 });
  const r = proposeValuePriorities(["teamwork", "legacy_unknown_code", "teamwork"]);
  assert.deepEqual(r.proposed, ["teamwork"]);
  assert.equal(r.missing, 2);
  assert.equal(proposeValuePriorities([]).missing, 3);
});
test("検証: プロフィールの既存ルール（ちょうど3つ・一覧にあるもの・重複禁止）", () => {
  assert.equal(validateValuePriorities(["teamwork", "independence", "culture_fit"]).ok, true);
  for (const bad of [["teamwork", "independence"], ["teamwork", "teamwork", "independence"], ["teamwork", "independence", "culture_fit", "skill_growth"], ["teamwork", "independence", "nope"], []]) {
    assert.equal(validateValuePriorities(bad).ok, false, JSON.stringify(bad));
  }
});

const text = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(ApplyValuesToProfile as never, props as never));
const flat = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
test("画面: 変更案と現在の設定を比べ、3つそろっていて内容が違うときだけ「プロフィールに反映する」を押せる。反映されるのは1項目だけと明示", () => {
  const h = text({ diagnosisValues: ["teamwork", "independence", "culture_fit"], current: ["work_life_balance", "skill_growth", "income_stability"], hasProfile: true });
  const t = flat(h);
  assert.ok(t.includes("現在の設定（プロフィール）") && t.includes("ワークライフバランス重視") && t.includes("診断からの変更案") && t.includes("チームワーク"));
  assert.ok(t.includes("自動では保存されません") && t.includes("反映されるのは「サロン選びで大切にしたいこと」だけです。ほかのプロフィール項目は変わりません"));
  assert.ok(!t.includes("お休みしています") && !t.includes("準備中") && !h.includes("apply-paused"));
  const btn = h.match(/<button[^>]*data-testid="apply-button"[^>]*>/)?.[0] ?? "";
  assert.ok(btn && !/\sdisabled=""/.test(btn), "押せる");
  assert.ok(!h.includes("apply-disabled-reason") && h.includes('href="/stylist/profile"'));
});
test("画面: 押せない場合（診断が3つ未満・すでに同じ・プロフィール未保存）。補完しない", () => {
  const miss = text({ diagnosisValues: ["teamwork", "independence"], current: null, hasProfile: true });
  assert.ok(/<button[^>]*data-testid="apply-button"[^>]*disabled|<button[^>]*disabled[^>]*data-testid="apply-button"/.test(miss));
  assert.ok(flat(miss).includes("あと1つはプロフィール編集で選んでください") && flat(miss).includes("未設定") && flat(miss).includes("ここでは反映できません"));
  const same = text({ diagnosisValues: ["teamwork", "independence", "culture_fit"], current: ["teamwork", "independence", "culture_fit"], hasProfile: true });
  assert.ok(/\sdisabled=""/.test(same.match(/<button[^>]*data-testid="apply-button"[^>]*>/)?.[0] ?? "") && flat(same).includes("すでにこの内容です"));
  const np = text({ diagnosisValues: ["teamwork"], current: null, hasProfile: false });
  assert.ok(flat(np).includes("先にプロフィールを保存する") && !flat(np).includes("診断からの変更案") && !np.includes("apply-button"));
});
test("構造: 反映は専用関数 set_stylist_value_priorities だけ。プロフィール全項目の保存関数は使わず、他の列を更新しない", () => {
  assert.equal(existsSync("lib/profile/apply-diagnosis-actions.ts"), false);
  const act = readFileSync("lib/profile/apply-values-actions.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(act.includes('"set_stylist_value_priorities"') && (act.match(/\.rpc\(/g) ?? []).length === 1);
  assert.ok(!/save_stylist_profile|\.from\(|\.update\(|\.insert\(|\.upsert\(/.test(act));
  for (const f of ["lib/profile/apply-diagnosis-values.ts", "components/student-diagnosis/apply-values-to-profile.tsx", "app/stylist/diagnosis/student/result/page.tsx"]) {
    assert.ok(!/save_stylist_profile|\.rpc\(|"use server"/.test(readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "")), f);
  }
  const res = readFileSync("app/stylist/diagnosis/student/result/page.tsx", "utf8");
  assert.ok(res.includes('status === "current" && profileRead') && res.includes("<ApplyValuesToProfile"));
});
// 0072の草案ファイルがあるとき（レビュー中・未コミット）だけ確認する。草案が無い環境では何もしない。
test("DBの草案（0072）の許可項目は、アプリの一覧（VALUE_PRIORITY_OPTIONS）と同じ", async (t) => {
  if (!existsSync("docs/profile-value-priorities-db/0072_value_priorities_save.draft.sql")) return t.skip("0072の草案が無い");
  const { VALUE_PRIORITY_OPTIONS } = await import("../lib/validation/profile-options");
  for (const f of ["docs/profile-value-priorities-db/0072_value_priorities_save.draft.sql", "docs/profile-value-priorities-db/0072_preapply_check.sql"]) {
    const src = readFileSync(f, "utf8");
    const m = src.match(/array\[\s*('work_life_balance'[^\]]*)\]/);
    assert.ok(m, f);
    const codes = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
    assert.deepEqual(codes, VALUE_PRIORITY_OPTIONS.map((o) => o.code).sort(), f);
  }
});
