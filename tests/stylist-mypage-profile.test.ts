import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TRAITS } from "../lib/diagnosis/traits";
import { Q, bankFor } from "../lib/diagnosis/questions";
import { scoreTraits, marketValue } from "../lib/diagnosis/scoring";
import { TraitRadar, hexPolygon, hexPoint, clampScore } from "../components/diagnosis/trait-radar";
import { TRAIT_INFO, TRAIT_ORDER } from "../lib/diagnosis/trait-descriptions";
import { buildExperienceProfile } from "../lib/diagnosis/experience-profile";
import { MarketValueCard } from "../components/mypage/market-value-card";
import { AiNarrativeBlocks } from "../components/mypage/ai-narrative-blocks";
import { splitLead, splitStep } from "../lib/diagnosis/ai-text";
import { parseRetakeLimit, retakeNotice, RETAKE_RULE_TEXT, LIMIT_UNKNOWN } from "../lib/diagnosis-limit/retake-status";
import { RetakeLink } from "../components/mypage/retake-link";
import { OrderMadeMatchCard } from "../components/mypage/order-made-match-card";
import { StylistPublicView } from "../components/profile/stylist-public-view";
import { VisibilityField } from "../components/profile/visibility-field";
import { initialVisibility } from "../lib/profile/get-initial-values";
import { profileFieldsKey } from "../lib/profile/fields-key";
import { isSalaryOfferPresentationPaused } from "../lib/salary-offers/pause";
import { profileFormSchema } from "../lib/validation/profile";

const scores = { T: 72, S: 55, H: 80, B: 30, A: 64, M: 41 };

test("才能は6項目のまま（削除・合算なし）で、六角形の頂点は6つ", () => {
  assert.equal(TRAITS.length, 6);
  assert.deepEqual(TRAIT_ORDER, TRAITS.map((t) => t.key));
  const pts = hexPolygon([1, 1, 1, 1, 1, 1]).split(" ");
  assert.equal(pts.length, 6);
  // 最初の頂点は真上
  assert.deepEqual(hexPoint(0, 1).map(Math.round), [160, 54]);
});

test("全項目が0〜100の共通尺度。想定外の値は丸める", () => {
  const bank = bankFor("stylist");
  const best = bank.map((q) => 0);
  const { traits } = scoreTraits(best, bank);
  for (const t of TRAITS) assert.ok(traits[t.key] >= 0 && traits[t.key] <= 100);
  assert.equal(clampScore(150), 100);
  assert.equal(clampScore(-5), 0);
  assert.equal(clampScore(NaN), 0);
});

test("レーダー: 6項目の名称・数値・説明・尺度の説明が出る。色だけに頼らず数値も表示", () => {
  const html = renderToStaticMarkup(createElement(TraitRadar, { scores }));
  assert.match(html, /<svg[^>]*role="img"/);
  for (const k of TRAIT_ORDER) {
    assert.ok(html.includes(TRAIT_INFO[k].name));
    assert.ok(html.includes(TRAIT_INFO[k].description));
  }
  assert.match(html, /技術 72点/);
  assert.match(html, /0〜100/);
  assert.match(html, /順位ではありません/);
  assert.equal((html.match(/<polygon/g) ?? []).length, 5); // 目盛り4＋データ1
});

test("経験・実績の特徴: 点数・年収・上位○%を主役にしない。回答と才能の傾向を表示", () => {
  const answers = Q.map(() => 0);
  const prof = buildExperienceProfile(answers, scores)!;
  assert.ok(prof);
  assert.equal(prof.strengths.length, 2);
  assert.equal(prof.growth.length, 2);
  assert.deepEqual(prof.strengths.map((s) => s.key), ["H", "T"]);
  assert.deepEqual(prof.growth.map((s) => s.key), ["B", "M"]);
  const html = renderToStaticMarkup(createElement(MarketValueCard, { profile: prof, salaryBand: "¥4.8M–6.5M" }));
  assert.match(html, /経験・実績の特徴/);
  assert.match(html, /これから伸ばせる点/);
  assert.match(html, /点数や順位ではありません/);
  assert.ok(!/上位\d|市場価値/.test(html));
  // 年収帯は折りたたみの参考情報のみ（主役にしない）
  assert.match(html, /<details/);
  assert.ok(html.indexOf("¥4.8M") > html.indexOf("<details"));
  assert.equal(buildExperienceProfile([1, 2], scores), null); // 読めない旧データは出さない
});

test("市場価値の算出ロジックは変更されていない（既存の式・範囲）", () => {
  const mv = marketValue({ T: 0, S: 0, H: 0, B: 0, A: 0, M: 0 }, { exp: 1, role: 0, spec: 1, cul: [] });
  assert.equal(mv.score, 39); // 26 + 9 + 0 + 4
  const top = marketValue({ T: 100, S: 100, H: 100, B: 100, A: 100, M: 100 }, { exp: 4, role: 3, spec: 2, cul: [] });
  assert.equal(top.score, 97);
});

test("AI解説: 一言は短く、詳細分析は閉じた状態、次の一手は番号つき手順カード", () => {
  const long = "あなたは丁寧な接客が強みです。お客様との信頼関係を築くのが得意です。さらに技術面でも着実に成長しています。今後は発信にも挑戦してみましょう。";
  const sp = splitLead(long, 40);
  assert.ok(sp.lead.length <= 45 && sp.lead.endsWith("。") && sp.rest.length > 0);
  assert.deepEqual(splitLead("短い文。"), { lead: "短い文。", rest: "" });
  assert.equal(splitStep("SNSを週1回投稿する。まずは作品を3枚選ぶ。").title, "SNSを週1回投稿する。");
  const html = renderToStaticMarkup(createElement(AiNarrativeBlocks, {
    isGenerating: false,
    aiByType: { essence: long, explanation: "詳細な分析の本文", advice: ["作品を撮る。", "投稿する。", "反応を見る。"], growth: "将来の話" },
  }));
  assert.match(html, /AIから一言/);
  assert.match(html, /次の一手/);
  assert.match(html, /STEP 1/);
  assert.match(html, /STEP 3/);
  assert.ok(html.includes("詳細分析を開く"));
  assert.ok(!/<details[^>]*open/.test(html)); // 詳細分析は初期状態で閉じている
  assert.equal(renderToStaticMarkup(createElement(AiNarrativeBlocks, { isGenerating: false, aiByType: {} })), "");
});

test("再診断: 制限が有効でない（0058未適用＝unknown）ときは制限の説明を出さない。有効なときだけ説明と次回日時", () => {
  assert.deepEqual(parseRetakeLimit(undefined), LIMIT_UNKNOWN);
  assert.deepEqual(parseRetakeLimit({ state: "locked" }), LIMIT_UNKNOWN); // 日時が無い＝不正
  assert.deepEqual(parseRetakeLimit({ state: "weird" }), LIMIT_UNKNOWN);
  const unk = renderToStaticMarkup(createElement(RetakeLink, { limit: LIMIT_UNKNOWN }));
  assert.ok(!unk.includes("3か月") && !unk.includes("1回できます"));
  assert.match(unk, /診断を受け直す/);
  assert.match(unk, /min-h-\[48px\]/);
  const can = renderToStaticMarkup(createElement(RetakeLink, { limit: parseRetakeLimit({ state: "can_change" }) }));
  assert.ok(can.includes(RETAKE_RULE_TEXT));
  assert.equal(RETAKE_RULE_TEXT, "初回診断後、変更は1回できます。変更後は3か月間変更できません。");
  const locked = parseRetakeLimit({ state: "locked", locked_until: "2027-02-13T09:10:00Z" });
  assert.equal(retakeNotice(locked).canStart, false);
  const lockedHtml = renderToStaticMarkup(createElement(RetakeLink, { limit: locked }));
  assert.match(lockedHtml, /2027年2月13日 18時10分/);
  assert.ok(!lockedHtml.includes('href="/stylist/diagnosis"')); // 制限中は診断へのリンクを出さない
});

test("オーダーメイドマッチ: 登録した回答だけを表示し、色以外（文字・番号）でも関係が分かる", () => {
  const html = renderToStaticMarkup(createElement(OrderMadeMatchCard, {
    profile: { primary_goal: "income_growth", secondary_goals: ["income_growth", "more_days_off"], career_stage: "growing_stylist" },
    coreTypeName: "指名磁石",
  }));
  assert.match(html, /収入を上げたい/);
  assert.match(html, /休日を増やしたい/);
  assert.match(html, /いちばん/);
  assert.match(html, /これから売上を伸ばしたいスタイリスト/);
  assert.match(html, /指名磁石/);
  assert.equal((html.match(/収入を上げたい/g) ?? []).length, 1); // 重複しない
  assert.ok(!/\d+%/.test(html)); // 相性の数値はここでは作らない
  const none = renderToStaticMarkup(createElement(OrderMadeMatchCard, { profile: null }));
  assert.match(none, /まだ登録していません/);
  assert.match(none, /希望条件を登録する/);
});

test("サロン向け表示: 項目を整理して表示。年齢は値があるときだけ（推測しない）。氏名・性別・年代は出さない", () => {
  const base = { publicName: "さくら", prefecture: "神奈川県", currentPosition: "スタイリスト", experienceYears: 5, desiredWorkLocation: "横浜", jobChangeIntent: "passive" as const, specialties: ["カット", "カラー"], bio: "よろしくお願いします。" };
  const html = renderToStaticMarkup(createElement(StylistPublicView, { data: base }));
  for (const w of ["基本情報", "経験", "希望する働き方", "さくら", "5年", "カット", "横浜", "自己紹介"]) assert.ok(html.includes(w), w);
  assert.ok(!html.includes("年齢"));
  const withAge = renderToStaticMarkup(createElement(StylistPublicView, { data: { ...base, age: 29 } }));
  assert.match(withAge, /29歳/);
  assert.ok(!/氏名|性別|年代|生年月日|希望年収/.test(withAge));
  const long = renderToStaticMarkup(createElement(StylistPublicView, { data: { ...base, bio: "あ".repeat(200) } }));
  assert.match(long, /全文を読む/);
});

test("公開範囲: 二択。新規は公開、既存の非公開は非公開のまま、既存の一部公開は非公開として表示（勝手に公開しない）", () => {
  assert.equal(initialVisibility(null), "PUBLIC");
  assert.equal(initialVisibility(undefined), "PUBLIC");
  assert.equal(initialVisibility({ visibility: "PRIVATE" }), "PRIVATE");
  assert.equal(initialVisibility({ visibility: "LIMITED" }), "PRIVATE");
  assert.equal(initialVisibility({ visibility: "PUBLIC" }), "PUBLIC");
  const html = renderToStaticMarkup(createElement(VisibilityField, { defaultValue: "PUBLIC" }));
  assert.equal((html.match(/type="radio"/g) ?? []).length, 2);
  assert.ok(!html.includes("一部公開") && !html.includes("LIMITED"));
  assert.match(html, /checked="" value="PUBLIC"/);
  assert.ok(!/checked="" value="PRIVATE"/.test(html));
});

test("保存済みの値が変わると入力欄を作り直すキーも変わる（保存後に古い値へ戻って見える不具合の対策）。署名付きURLは無視", () => {
  const a = { publicName: "A", snsLinks: [{ platform: "instagram", handle: "x" }], avatarSignedUrl: "u1" };
  assert.equal(profileFieldsKey(a), profileFieldsKey({ ...a, avatarSignedUrl: "u2" }));
  assert.notEqual(profileFieldsKey(a), profileFieldsKey({ ...a, snsLinks: [{ platform: "instagram", handle: "y" }] }));
  assert.notEqual(profileFieldsKey({ ...a, visibility: "PRIVATE" }), profileFieldsKey({ ...a, visibility: "PUBLIC" }));
});

test("保存の入力: 希望年収・スカウト受信設定は不要。一部公開は受け付けない", () => {
  const ok = {
    publicName: "さくら", prefecture: "神奈川県", experienceYears: "5", specialties: ["カット"], employmentType: "full_time", jobChangeIntent: "passive",
    snsLinks: [], fullName: "山田 花子", ageBand: "20s", gender: "female", valuePriorities: ["a", "b", "c"], visibility: "PUBLIC",
  };
  const r = profileFormSchema.safeParse(ok);
  const issues = r.success ? [] : r.error.issues.map((i) => i.path.join("."));
  assert.ok(!issues.includes("desiredSalaryRange") && !issues.includes("scoutEnabled"), issues.join(","));
  const bad = profileFormSchema.safeParse({ ...ok, visibility: "LIMITED" });
  assert.equal(bad.success, false);
});

test("給与条件の提示の一時停止: 既定は停止中。環境変数 false で再開", () => {
  assert.equal(isSalaryOfferPresentationPaused({}), true);
  assert.equal(isSalaryOfferPresentationPaused({ SALARY_OFFER_PRESENTATION_PAUSED: "true" }), true);
  assert.equal(isSalaryOfferPresentationPaused({ SALARY_OFFER_PRESENTATION_PAUSED: "false" }), false);
});
