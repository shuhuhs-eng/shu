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
import { BackToMypage } from "../components/messages/back-to-mypage";
import { RetakeLink } from "../components/mypage/retake-link";
import { OrderMadeMatchCard } from "../components/mypage/order-made-match-card";
import { StylistPublicView } from "../components/profile/stylist-public-view";
import { VisibilityField } from "../components/profile/visibility-field";
import { initialVisibility } from "../lib/profile/get-initial-values";
import { profileFieldsKey } from "../lib/profile/fields-key";
import { isSalaryOfferPresentationPaused } from "../lib/salary-offers/pause";
import { profileFormSchema } from "../lib/validation/profile";
import { ageOn, validateBirthDate, todayJst, isMissingBirthDateColumn, readOwnBirthDate } from "../lib/profile/birth-date";
import { BirthDateField } from "../components/profile/birth-date-field";

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
  const best = bank.map(() => 0);
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
  assert.ok(!unk.includes("1回できます") && !unk.includes("診断を変更できません")); // 制限が有効でないので、制限の説明は出さない
  const BASE = "才能は経験とともに変わります。3か月〜半年ごとに診断を受け直すことをおすすめします。";
  assert.ok(unk.includes(BASE));
  assert.ok(!unk.includes("必要なときに診断を受け直せます") && !unk.includes("必要な時に診断を受け直せます"));
  assert.match(unk, /診断を受け直す/);
  assert.match(unk, /min-h-\[48px\]/);
  const can = renderToStaticMarkup(createElement(RetakeLink, { limit: parseRetakeLimit({ state: "can_change" }) }));
  assert.ok(can.includes(RETAKE_RULE_TEXT) && can.includes(BASE));
  assert.equal(RETAKE_RULE_TEXT, "初回診断後、変更は1回できます。変更後は3か月間、診断を変更できません。");
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
  // DB未対応（extended未指定）のときは、従来の項目だけ。年齢・雇用形態・Instagram・大切にしたいことは出さない。
  const legacy = renderToStaticMarkup(createElement(StylistPublicView, { data: { ...base, age: 29, instagramHandle: "x", employmentType: "full_time" as const } }));
  assert.ok(!/年齢|雇用形態|Instagram/.test(legacy));
  const withAge = renderToStaticMarkup(createElement(StylistPublicView, { data: { ...base, extended: true, age: 29 } }));
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

test("サロン向け表示（0070対応）: 画像・雇用形態・Instagram・大切にしたいこと・年齢。未登録は「未登録」と表示。個人情報は出さない", () => {
  const base = { publicName: "さくら", prefecture: "東京都", currentPosition: null, experienceYears: 3, desiredWorkLocation: null, jobChangeIntent: "active" as const, specialties: ["カット"], bio: null, extended: true };
  const html = renderToStaticMarkup(createElement(StylistPublicView, { data: { ...base, avatarUrl: "https://example.test/a.webp", employmentType: "full_time" as const, instagramHandle: "sakura_hair", valuePriorities: ["work_life_balance", "unknown_code"], age: 28 } }));
  assert.match(html, /<img[^>]+a\.webp/);
  assert.match(html, /28歳/);
  assert.match(html, /雇用形態/);
  assert.match(html, /@sakura_hair/);
  assert.match(html, /instagram\.com\/sakura_hair/);
  assert.match(html, /サロン選びで大切にしたいこと/);
  assert.match(html, /ワークライフバランス重視/);
  assert.ok(!html.includes("unknown_code"));
  const none = renderToStaticMarkup(createElement(StylistPublicView, { data: { ...base, age: null } }));
  assert.match(none, /未登録/);
  assert.ok(!/<img/.test(none)); // 画像なしは頭文字の丸
  assert.ok(!/氏名|性別|年代|生年月日|希望年収/.test(html + none));
});

test("生年月日: 満年齢は誕生日の前日までは上がらない。範囲外・実在しない日付は拒否。年代からは推測しない", () => {
  assert.equal(ageOn("1995-06-15", "2026-06-14"), 30);
  assert.equal(ageOn("1995-06-15", "2026-06-15"), 31);
  assert.equal(ageOn("2000-02-29", "2026-02-28"), 25);
  assert.equal(ageOn("2000-02-29", "2026-03-01"), 26);
  assert.equal(ageOn(null, "2026-06-15"), null);
  assert.equal(ageOn("", "2026-06-15"), null);
  const today = "2026-11-15";
  assert.equal(validateBirthDate("1995-06-15", today), null);
  assert.equal(validateBirthDate("2011-11-15", today), null); // ちょうど満15歳
  assert.ok(validateBirthDate("2011-11-16", today)); // 満14歳
  assert.ok(validateBirthDate("2026-11-16", today)); // 未来
  assert.ok(validateBirthDate("1925-11-14", today)); // 満101歳
  assert.ok(validateBirthDate("2001-02-30", today)); // 実在しない
  assert.match(todayJst(new Date("2026-11-14T16:00:00Z")), /^2026-11-15$/); // 日本時間
});

test("生年月日の保存入力: 項目なし(DB未対応)は何もしない・空は未登録に戻す・不正は拒否", () => {
  const ok = { publicName: "A", prefecture: "東京都", experienceYears: "3", specialties: ["カット"], employmentType: "full_time", jobChangeIntent: "active", snsLinks: [], fullName: "山田", ageBand: "25_29", gender: "female", valuePriorities: ["work_life_balance", "skill_growth", "teamwork"], visibility: "PUBLIC" };
  const none = profileFormSchema.safeParse(ok);
  assert.ok(none.success); assert.equal(none.data.birthDate, undefined);
  const empty = profileFormSchema.safeParse({ ...ok, birthDate: "" });
  assert.ok(empty.success); assert.equal(empty.data.birthDate, "");
  assert.ok(profileFormSchema.safeParse({ ...ok, birthDate: "1995-06-15" }).success);
  assert.ok(!profileFormSchema.safeParse({ ...ok, birthDate: "2999-01-01" }).success);
  assert.ok(!profileFormSchema.safeParse({ ...ok, birthDate: "abc" }).success);
  const field = renderToStaticMarkup(createElement(BirthDateField, { defaultValue: "1995-06-15" }));
  assert.match(field, /type="date"/);
  assert.match(field, /value="1995-06-15"/);
  assert.match(field, /未登録/);
});

test("生年月日の未対応判定: 列が存在しないときだけ unsupported。権限・通信エラーは error（従来表示へ切り替えない）", async () => {
  assert.equal(isMissingBirthDateColumn({ code: "42703" }), true);
  assert.equal(isMissingBirthDateColumn({ code: "PGRST204" }), true);
  assert.equal(isMissingBirthDateColumn({ message: 'column stylist_private.birth_date does not exist' }), true);
  assert.equal(isMissingBirthDateColumn({ code: "42501", message: "permission denied for table stylist_private" }), false);
  assert.equal(isMissingBirthDateColumn({ message: "TypeError: fetch failed" }), false);
  assert.equal(isMissingBirthDateColumn({ code: "PGRST301", message: "JWT expired" }), false);
  const fake = (res: { data: unknown; error: unknown }) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => res }) }) }) }) as never;
  assert.deepEqual(await readOwnBirthDate(fake({ data: { birth_date: "1995-06-15" }, error: null }), "u"), { status: "ok", birthDate: "1995-06-15" });
  assert.deepEqual(await readOwnBirthDate(fake({ data: null, error: null }), "u"), { status: "ok", birthDate: null });
  assert.deepEqual(await readOwnBirthDate(fake({ data: null, error: { code: "42703", message: "x" } }), "u"), { status: "unsupported" });
  assert.deepEqual(await readOwnBirthDate(fake({ data: null, error: { code: "42501", message: "permission denied" } }), "u"), { status: "error" });
  assert.deepEqual(await readOwnBirthDate(fake({ data: null, error: { message: "fetch failed" } }), "u"), { status: "error" });
});

test("運営からの連絡: 「マイページへ戻る」は共通の行き先(/mypage)へ。ホーム(/)へは戻さない。タップ領域44px以上", () => {
  const html = renderToStaticMarkup(createElement(BackToMypage));
  assert.match(html, /href="\/mypage"/);
  assert.ok(!html.includes('href="/"'));
  assert.match(html, /マイページへ戻る/);
  assert.match(html, /min-h-\[44px\]/);
});
