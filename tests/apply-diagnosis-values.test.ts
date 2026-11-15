// 診断結果の「大切にしたい働き方」。変更案の表示のみ（保存は一時停止中）。推測で変換しない。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { proposeValuePriorities, validateValuePriorities } from "../lib/profile/apply-diagnosis-values";
import { ApplyValuesToProfile } from "../components/student-diagnosis/apply-values-to-profile";

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
test("画面: 保存は一時停止。変更案とプロフィール編集へのリンクだけを出し、押せる保存ボタン・入力欄・フォームは無い", () => {
  const h = text({ diagnosisValues: ["teamwork", "independence", "culture_fit"], current: ["work_life_balance", "skill_growth", "income_stability"], hasProfile: true });
  const t = h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.ok(t.includes("現在の設定（プロフィール）") && t.includes("ワークライフバランス重視") && t.includes("診断からの変更案") && t.includes("チームワーク"));
  assert.ok(t.includes("この画面からの保存は、現在お休みしています") && t.includes("何も保存されません"));
  assert.ok(h.includes('href="/stylist/profile"') && h.includes("プロフィール編集へ"));
  assert.ok(/<button[^>]*disabled[^>]*data-testid="apply-paused-button"|<button[^>]*data-testid="apply-paused-button"[^>]*disabled/.test(h), "唯一のボタンは無効");
  assert.ok((h.match(/<button/g) ?? []).length === 1 && !h.includes("<form") && !h.includes("<input"));
});
test("画面: 診断が3つに満たない場合は補完せず案内。プロフィール未保存は変更案を出さず、先に保存するリンク", () => {
  const h = text({ diagnosisValues: ["teamwork", "independence"], current: null, hasProfile: true }).replace(/<[^>]+>/g, " ");
  assert.ok(h.includes("あと1つはプロフィール編集で選んでください") && h.includes("未設定"));
  const np = text({ diagnosisValues: ["teamwork"], current: null, hasProfile: false }).replace(/<[^>]+>/g, " ");
  assert.ok(np.includes("先にプロフィールを保存する") && !np.includes("診断からの変更案"));
});
test("構造: プロフィール全項目を保存する経路（旧: 反映の保存処理）はアプリに残っていない。結果ページは現在の結果のときだけ表示", () => {
  assert.equal(existsSync("lib/profile/apply-diagnosis-actions.ts"), false);
  for (const f of ["lib/profile/apply-diagnosis-values.ts", "components/student-diagnosis/apply-values-to-profile.tsx", "app/stylist/diagnosis/student/result/page.tsx"]) {
    const src = readFileSync(f, "utf8");
    assert.ok(!/save_stylist_profile|\.rpc\(|applyValuePrioritiesAction|"use server"/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")), f + " は保存を行わない");
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
