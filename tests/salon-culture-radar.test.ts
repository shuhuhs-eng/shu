import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { deriveCultureRadar, RADAR_AXES, storedValueToStep, stepToRadiusRatio } from "../lib/salon-culture/culture-radar";
import { CultureRadarSection } from "../components/salon-culture/culture-radar";

const FULL = {
  education_support: 100,
  challenge_openness: 75,
  personal_brand_support: 50,
  team_collaboration: 25,
  work_flexibility: 0,
};

test("保存値(0/25/50/75/100)は回答1〜5へ厳密に戻る", () => {
  assert.deepEqual([0, 25, 50, 75, 100].map(storedValueToStep), [1, 2, 3, 4, 5]);
});

test("未回答・範囲外・25の倍数でない値は null（1や3で埋めない）", () => {
  for (const v of [null, undefined, -25, 125, 10, 33.3, NaN, Infinity]) {
    assert.equal(storedValueToStep(v as number | null | undefined), null, String(v));
  }
});

test("5軸は12軸のうち1問=1軸の定義で、合成軸を含まない", () => {
  assert.equal(RADAR_AXES.length, 5);
  assert.deepEqual(
    RADAR_AXES.map((a) => a.key),
    ["education_support", "challenge_openness", "personal_brand_support", "team_collaboration", "work_flexibility"],
  );
});

test("5軸が揃えば complete。段階は保存値から変換のみ（補正なし）", () => {
  const r = deriveCultureRadar(FULL);
  assert.equal(r.complete, true);
  assert.deepEqual(r.axes.map((a) => a.step), [5, 4, 3, 2, 1]);
  assert.deepEqual(r.missing, []);
});

test("1軸でも欠けたら complete=false。欠けた軸は null のまま、他の値を流用しない", () => {
  const { team_collaboration: _omit, ...rest } = FULL;
  void _omit;
  const r = deriveCultureRadar(rest);
  assert.equal(r.complete, false);
  assert.deepEqual(r.missing, ["チーム"]);
  assert.equal(r.axes[3].step, null);
  assert.equal(r.axes[3].summary, null);
  assert.deepEqual(r.axes.filter((a) => a.step != null).map((a) => a.step), [5, 4, 3, 1]);
});

test("null / 空の culture_axes は全軸 null（3で埋めない）", () => {
  for (const input of [null, undefined, {}]) {
    const r = deriveCultureRadar(input);
    assert.equal(r.complete, false);
    assert.ok(r.axes.every((a) => a.step == null));
  }
});

test("14問診断・8タイプ合成・12軸以外の軸は、5軸のソースで使わない", () => {
  const lib = readFileSync("lib/salon-culture/culture-radar.ts", "utf8");
  const code = lib.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!/diagnosis_results|computeDiagnosis|scoreTraits|@\/lib\/diagnosis/.test(code));
  assert.ok(!/individual_autonomy|technical_specialization|premium_value|trend_orientation|creative_output/.test(code));
});

test("半径は段階に比例（1→0.2, 5→1.0）。底上げ・補正をしない", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(stepToRadiusRatio), [0.2, 0.4, 0.6, 0.8, 1]);
});

const render = (props: Parameters<typeof CultureRadarSection>[0]) => renderToStaticMarkup(createElement(CultureRadarSection, props));

test("completed+5軸: 見出し・段階・両端ラベル・説明・更新リンク", () => {
  const html = render({ status: "completed", axes: FULL, answerPath: "/salon/culture" });
  assert.match(html, /サロンらしさ/);
  assert.match(html, /回答から見えるサロンの方針・環境です。優劣を示すものではありません/);
  assert.match(html, /<svg[^>]*role="img"/);
  assert.match(html, /5段階中5/);
  assert.match(html, /本人のペースや自主性を尊重する/);
  assert.match(html, /計画・練習・フォローまでサロンが支援する/);
  assert.match(html, /この5段階の見方/);
  assert.match(html, /href="\/salon\/culture\?edit=1"/);
  assert.match(html, /足したり平均したりはしていません/);
});

test("優劣を示す表現を画面文言に使わない", () => {
  const src = readFileSync("components/salon-culture/culture-radar.tsx", "utf8") + readFileSync("lib/salon-culture/culture-radar.ts", "utf8");
  const visible = renderToStaticMarkup(createElement(CultureRadarSection, { status: "completed", axes: FULL, answerPath: "/x" }));
  for (const w of ["点数", "才能", "総合ランク", "星", "業界平均", "高評価", "低評価"]) {
    assert.ok(!visible.includes(w), `画面に「${w}」`);
  }
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!/diagnosis_results/.test(code));
});

test("未回答・回答途中・取得失敗・軸の欠落は、それぞれ別の状態で表示しチャートを描かない", () => {
  const none = render({ status: null, axes: null, answerPath: "/salon/culture" });
  assert.match(none, /まだ回答していません/);
  assert.match(none, /href="\/salon\/culture"/);
  assert.ok(!none.includes("<svg"));

  const draft = render({ status: "draft", axes: {}, answerPath: "/salon/culture" });
  assert.match(draft, /回答の途中です/);
  assert.ok(!draft.includes("<svg"));

  const failed = render({ status: null, axes: null, loadFailed: true, answerPath: "/salon/culture" });
  assert.match(failed, /読み込めませんでした/);
  assert.match(failed, /回答していない、という意味ではありません/);
  assert.ok(!failed.includes("まだ回答していません"));

  const partial = render({ status: "completed", axes: { education_support: 100 }, answerPath: "/salon/culture" });
  assert.match(partial, /取得できていない項目があります/);
  assert.ok(!partial.includes("<svg"));
});

test("更新リンクは渡された対象（本人/店舗）の回答画面へ向く", () => {
  const store = render({ status: "completed", axes: FULL, answerPath: "/salon/stores/abc/culture" });
  assert.match(store, /href="\/salon\/stores\/abc\/culture\?edit=1"/);
  assert.ok(!store.includes('href="/salon/culture?edit=1"'));
});

test("サロンマイページ: 14問診断の表示・受診ボタンを持たず、サロンらしさだけに依存する", () => {
  const src = readFileSync("app/salon/mypage/page.tsx", "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!/diagnosis_results/.test(code));
  assert.ok(!/DiagnosisSummary/.test(code));
  assert.ok(!/href="\/diagnosis\/salon"/.test(code));
  assert.ok(!/6つの才能軸/.test(code));
  assert.match(code, /CultureRadarSection/);
  assert.match(code, /answerPath="\/salon\/culture"/);
  assert.match(code, /cultureError/);
});

test("診断結果画面のサロン分岐: 美容師向けタイプ名・6軸バー・市場価値を出さない", () => {
  const src = readFileSync("app/diagnosis/result/page.tsx", "utf8");
  const a = src.indexOf("if (isSalon) {");
  const b = src.indexOf("// ★ここから美容師診断");
  assert.ok(a > 0 && b > a);
  const salonBranch = src.slice(a, b);
  assert.ok(!/typeName|fullType|TraitScoreBars|marketValue|才能/.test(salonBranch.replace(/\/\/.*$/gm, "")));
  assert.match(salonBranch, /\/salon\/culture/);
});

test("美容師診断・14問の計算/保存は変更されていない（ファイルが存在し、salon保存経路が残る）", () => {
  const submit = readFileSync("lib/diagnosis-handoff/submit-logged-in.ts", "utf8");
  assert.match(submit, /diagnosis_results/);
  const q = readFileSync("lib/diagnosis/questions.ts", "utf8");
  assert.match(q, /export const QS/);
});
