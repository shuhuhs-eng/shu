import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CultureRadarSection } from "../components/salon-culture/culture-radar";
import { TypeBasis } from "../components/salon-culture/type-basis";
import { deriveTypeBasis, TYPE_SOURCES } from "../lib/salon-culture/analysis/type-evidence";
import { calculateSalonTypeScores, deriveSalonTypes } from "../lib/salon-culture/salon-culture-types";

const K = ["education_support","challenge_openness","personal_brand_support","team_collaboration","individual_autonomy","work_flexibility","technical_specialization","premium_value","trend_orientation","creative_output","relationship_distance","hierarchy_flatness"] as const;
const axesOf = (a: number[]) => Object.fromEntries(K.map((k, i) => [k, (a[i] - 1) * 25])) as Record<string, number>;

const BASE = { q2_challenge_openness: 4, q3_personal_brand_support: 2, q4_team_collaboration: 3, q5_individual_autonomy: 3, q9_trend_orientation: 5 };
const SUP = { q13_nurture_learning_flow: 4, q14_nurture_feedback: 4, q15_brand_staff_presentation: 2, q16_team_handover: 3, q17_discretion_proposal: 3 };

type P = Parameters<typeof CultureRadarSection>[0];
const render = (o: Partial<P>) =>
  renderToStaticMarkup(
    createElement(CultureRadarSection, {
      status: "completed",
      baseAnswers: BASE,
      supplement: { answers: SUP, base_snapshot: BASE },
      answerPath: "/salon/culture",
      analysisPath: "/salon/culture/analysis",
      targetName: "テストサロン",
      targetKind: "personal",
      ...o,
    } as P),
  );

test("ready: 見出し・対象名・五角形・5軸の名称・根拠文・見方・更新リンク", () => {
  const html = render({});
  assert.match(html, /サロンらしさ/);
  assert.match(html, /対象：テストサロン（個人の回答）/);
  assert.match(html, /<svg[^>]*role="img"/);
  assert.match(html, /個人の発信・指名づくり/);
  assert.match(html, /サロン全体の発信（撮影・SNS）とは別の内容/);
  assert.match(html, /回答全体では、/);
  assert.match(html, /この5段階の見方/);
  assert.match(html, /統計的に検証したものではありません/);
  assert.match(html, /href="\/salon\/culture\/analysis"/);
});

test("優劣を示す表現を画面文言に使わない", () => {
  const visible = render({});
  for (const w of ["点数", "才能", "総合ランク", "星", "業界平均", "高評価", "低評価"]) assert.ok(!visible.includes(w), w);
  const src = readFileSync("components/salon-culture/culture-radar.tsx", "utf8") + readFileSync("lib/salon-culture/analysis/v1.ts", "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!/diagnosis_results/.test(code));
});

test("未回答・回答途中・取得失敗・旧データは別々の状態で表示し、図を描かない", () => {
  const none = render({ status: null, baseAnswers: null, supplement: null });
  assert.match(none, /まだ回答していません/);
  assert.ok(!none.includes("<svg"));
  const draft = render({ status: "draft", supplement: null });
  assert.match(draft, /回答の途中です/);
  const failed = render({ status: null, baseAnswers: null, supplement: null, loadFailed: true });
  assert.match(failed, /読み込めませんでした/);
  assert.match(failed, /回答していない、という意味ではありません/);
  assert.ok(!failed.includes("まだ回答していません"));
  const legacy = render({ baseAnswers: { q2_challenge_openness: 3 }, supplement: null });
  assert.match(legacy, /既存の回答が揃っていません/);
  assert.ok(!legacy.includes("<svg"));
});

test("追加回答が無い: 案内と、既存回答から読める根拠文。図は描かず『回答しなくても他機能は使える』と書く", () => {
  const html = render({ supplement: null });
  assert.match(html, /追加の5問/);
  assert.match(html, /他の機能は今までどおり使えます/);
  assert.match(html, /今の回答から読み取れること/);
  assert.ok(!html.includes("<svg"));
  assert.match(html, /新しいスタイルや技術が話題になったとき/);
});

test("「当てはまらない」を含む: 図を描かず、判定できる軸と根拠文は表示する", () => {
  const html = render({ supplement: { answers: { ...SUP, q15_brand_staff_presentation: "na" }, base_snapshot: BASE } });
  assert.ok(!html.includes("<svg"));
  assert.match(html, /判定できません/);
  assert.match(html, /「当てはまらない」と回答しています/);
  assert.match(html, /新しいスタイルや技術が話題になったとき/);
});

test("既存回答が追加回答のあとに変わった: 黙って組み合わせず、確認を促す", () => {
  const html = render({ baseAnswers: { ...BASE, q3_personal_brand_support: 5 } });
  assert.ok(!html.includes("<svg"));
  assert.match(html, /前の回答と組み合わせず/);
});

test("場面差: 『場面によって違いがあります』と各回答を表示し、矛盾とは書かない", () => {
  const html = render({
    baseAnswers: { ...BASE, q3_personal_brand_support: 1 },
    supplement: { answers: { ...SUP, q15_brand_staff_presentation: 5 }, base_snapshot: { ...BASE, q3_personal_brand_support: 1 } },
  });
  assert.match(html, /場面によって違いがあります/);
  assert.match(html, /回答：1 と 5/);
  assert.ok(!/矛盾|悪い/.test(html));
});

test("閲覧のみ: 追加回答の導線を出さず、理由を表示する。店舗は対象名と『店舗の回答』を表示する", () => {
  const html = render({ supplement: null, canEdit: false, targetKind: "store", targetName: "渋谷店", analysisPath: "/salon/stores/s1/culture/analysis" });
  assert.match(html, /閲覧のみの権限/);
  assert.ok(!html.includes('href="/salon/stores/s1/culture/analysis"'));
  assert.match(html, /対象：渋谷店（店舗の回答）/);
});

test("更新リンクは渡された対象（本人/店舗）の画面へ向く", () => {
  const store = render({ status: "completed", supplement: null, answerPath: "/salon/stores/abc/culture", analysisPath: "/salon/stores/abc/culture/analysis", targetKind: "store" });
  assert.match(store, /href="\/salon\/stores\/abc\/culture\/analysis"/);
  assert.ok(!store.includes('href="/salon/culture/analysis"'));
});

test("タイプ根拠: 判定式・選出は変更なし（8タイプの参照軸が式と一致）", () => {
  const a = axesOf([3,4,2,3,3,3,3,3,5,5,3,3]);
  assert.deepEqual(calculateSalonTypeScores(a), { education: 50, challenge: 75, personal_brand: 25, team: 50, autonomy: 50, flexibility: 50, technical_premium: 50, trend: 100 });
  const c = deriveSalonTypes(a)!;
  assert.equal(c.mainType, "trend");
  assert.equal(c.subType, "challenge");
  assert.deepEqual(TYPE_SOURCES.trend, ["trend_orientation", "creative_output"]);
  assert.deepEqual(TYPE_SOURCES.autonomy, ["individual_autonomy", "team_collaboration"]);
});

test("タイプ根拠: メイン・サブそれぞれ実回答の文で説明し、発信（サロン/個人）を区別する", () => {
  const b = deriveTypeBasis(axesOf([3,4,2,3,3,3,3,3,5,5,3,3]))!;
  assert.equal(b.levelNote, null);
  assert.deepEqual(b.items.map((i) => [i.code, i.role]), [["trend", "main"], ["challenge", "sub"]]);
  const trend = b.items[0];
  assert.equal(trend.sentences.length, 2);
  assert.match(trend.sentences[1], /サロンとしての撮影・SNSなどの美容発信/);
  assert.match(trend.note!, /個人の発信・指名づくりは、5軸の「個人の発信・指名づくり」で別に見ています/);
  const html = renderToStaticMarkup(createElement(TypeBasis, { axes: axesOf([3,4,2,3,3,3,3,3,5,5,3,3]) }));
  assert.match(html, /タイプ名だけで、サロンの実態や能力を表すものではありません/);
});

test("タイプ根拠: 上位が同点→『複数の特徴が同程度に表れています』／全回答が中央→偏りなし。『特徴がない』とは書かない", () => {
  const tie = deriveTypeBasis(axesOf([5,5,5,5,3,5,5,5,5,5,3,3]))!;
  assert.equal(tie.levelNote, "複数の特徴が同程度に表れています。");
  assert.ok(tie.items.length > 2 && tie.items.every((i) => i.role === "tied"));
  const central = deriveTypeBasis(axesOf(Array(12).fill(3)))!;
  assert.equal(central.levelNote, "今回の回答では、特定の方向への偏りは見られません。");
  assert.equal(central.allCentral, true);
  assert.equal(central.items.length, 0);
  for (const t of [tie, central]) assert.ok(!/特徴がない|特徴はありません|同点/.test(JSON.stringify(t)));
});

test("タイプ根拠: 75点などの水準の境界・強弱の断定を使わない。自由・マイペース型を『協力しないほど自律的』と説明しない", () => {
  const src = readFileSync("lib/salon-culture/analysis/type-evidence.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!/75|はっきり表れている|強い特徴/.test(src));
  const b = deriveTypeBasis(axesOf([3,3,3,1,5,3,3,3,3,3,3,3]))!;
  const aut = b.items.find((i) => i.code === "autonomy");
  const text = JSON.stringify(b);
  assert.ok(!/協力しない|協力が少ない|助け合わない/.test(text));
  if (aut) assert.match(aut.note!, /独立して見ています/);
});

test("タイプ根拠: 12軸が揃わない旧データは根拠を出さない（0扱いしない）", () => {
  assert.equal(deriveTypeBasis({ education_support: 100 }), null);
  assert.equal(renderToStaticMarkup(createElement(TypeBasis, { axes: null })), "");
});

test("サロンマイページ: 14問診断の表示・受診ボタンを持たず、サロンらしさだけに依存する", () => {
  const src = readFileSync("app/salon/mypage/page.tsx", "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!/diagnosis_results/.test(code));
  assert.ok(!/DiagnosisSummary/.test(code));
  assert.ok(!/href="\/diagnosis\/salon"/.test(code));
  assert.match(code, /CultureRadarSection/);
  assert.match(code, /answerPath="\/salon\/culture"/);
  assert.match(code, /targetKind="personal"/);
  assert.match(code, /cultureError/);
});

test("個人と店舗は別々に読む: 個人の画面は店舗の追加回答を、店舗の画面は個人の追加回答を読まない", () => {
  const strip = (f: string) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const f of ["app/salon/mypage/page.tsx", "app/salon/culture/result/page.tsx", "app/salon/culture/analysis/page.tsx"]) {
    const c = strip(f);
    assert.match(c, /\.eq\("salon_user_id", user\.id\)/, f);
    assert.ok(!/\.eq\("store_id"/.test(c.slice(c.indexOf("salon_culture_analysis_answers"))), f);
  }
  for (const f of ["app/salon/stores/[storeId]/culture/result/page.tsx", "app/salon/stores/[storeId]/culture/analysis/page.tsx"]) {
    const c = strip(f);
    assert.match(c, /\.eq\("store_id", storeId\)/, f);
    assert.ok(!/salon_user_id/.test(c.slice(c.indexOf("salon_culture_analysis_answers"))), f);
  }
});

test("店舗の追加回答画面: 保存権限が無ければフォームを出さない（権限はRPC can_edit_store_culture_analysis）", () => {
  const c = readFileSync("app/salon/stores/[storeId]/culture/analysis/page.tsx", "utf8");
  assert.match(c, /can_edit_store_culture_analysis/);
  assert.match(c, /canEdit !== true/);
  assert.ok(c.indexOf("canEdit !== true") < c.indexOf("<AnalysisForm"));
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

test("サロンマイページの表示順: サロンタイプ → サロンらしさ5軸 → AI紹介文", () => {
  const src = readFileSync("app/salon/mypage/page.tsx", "utf8");
  const type = src.indexOf("{salonTypeClassification && (");
  const radar = src.indexOf("<CultureRadarSection");
  const ai = src.indexOf("<SalonAiNarrative");
  assert.ok(type > 0 && type < radar && radar < ai);
});
