/**
 * 美容学生・新卒 診断（student_newgrad_v1）の質問セット。設計: docs/student-newgrad-diagnosis-design.md
 *
 * 既存の美容師診断（lib/diagnosis）とは完全に別。既存の質問・配点・採点は一切使わない。
 * 実績・経験を前提とした設問は無い（「興味・好み・想像してどうか」だけを聞く）。
 * タグの登場回数を揃える（興味・教育環境は各タグがちょうど4回）か、本人が直接選ぶ方式にして、
 * 「選択肢に出やすさ」だけで順位がつかないようにしている。
 */
import { VALUE_PRIORITY_OPTIONS } from "@/lib/validation/profile-options";

export const STUDENT_DIAGNOSIS_VERSION = "student_newgrad_v1";

export type InterestTag = "craft" | "design" | "service" | "share" | "challenge" | "team";
export type EnvTag = "step" | "mentor" | "early" | "self" | "team";
export type LearningTag = "cut" | "color" | "perm" | "care" | "counsel" | "sns" | "biz" | "set" | "basic";
export type ConcernTag = "nervous" | "skill" | "senior" | "hours" | "income" | "choice";

export const INTEREST_LABEL: Record<InterestTag, string> = {
  craft: "技術を磨くこと", design: "デザイン・表現", service: "お客様との関わり", share: "発信・見せ方", challenge: "挑戦・将来の独立", team: "仲間と成長すること",
};
export const ENV_LABEL: Record<EnvTag, { name: string; text: string }> = {
  step: { name: "段階的に学べる型", text: "手順やチェックで、順番に確認しながら進める環境" },
  mentor: { name: "担当の先輩がつく型", text: "決まった先輩がそばで見て、細かくフィードバックしてくれる環境" },
  early: { name: "早めに実践する型", text: "早い段階から現場に出て、やりながら直してもらう環境" },
  self: { name: "自主練・自走型", text: "自分で調べ、練習の時間を自分で使える環境" },
  team: { name: "チームで学ぶ型", text: "勉強会や振り返りなど、仲間と一緒に学ぶ環境" },
};
export const LEARNING_LABEL: Record<LearningTag, string> = {
  cut: "カット", color: "カラー", perm: "パーマ・縮毛矯正", care: "ヘアケア・薬剤の知識", counsel: "カウンセリング・接客",
  sns: "撮影・SNS", biz: "店づくり・経営", set: "ヘアセット・ブライダル", basic: "基本のアシスタントワーク（シャンプー・ブローなど）",
};
export const CONCERN_LABEL: Record<ConcernTag, string> = {
  nervous: "お客様の前での緊張", skill: "技術が身につくか", senior: "先輩との関係", hours: "休みや勤務時間", income: "収入", choice: "就職先の選び方",
};

export type Option<T extends string = string> = { id: string; label: string; tag: T };
export type StudentQuestion =
  | { id: string; section: "interest"; kind: "single"; text: string; options: Option<InterestTag>[] }
  | { id: string; section: "env"; kind: "single"; text: string; options: Option<EnvTag>[] }
  | { id: string; section: "learning"; kind: "multi"; max: number; min: number; text: string; options: Option<LearningTag>[] }
  | { id: string; section: "learningFocus"; kind: "focus"; text: string; of: string }
  | { id: string; section: "values"; kind: "ranked"; max: number; text: string; options: { id: string; label: string }[] }
  | { id: string; section: "concern"; kind: "multi"; max: number; min: number; text: string; options: Option<ConcernTag>[] };

const o = <T extends string>(id: string, label: string, tag: T): Option<T> => ({ id, label, tag });

export const STUDENT_QUESTIONS: StudentQuestion[] = [
  // A. 興味（6問・各4択。6つの興味のうち4つを出し、各タグはちょうど4回登場する）
  { id: "q1", section: "interest", kind: "single", text: "美容の仕事で、いちばんわくわくしそうなのは？", options: [
    o("a", "お客様の「ありがとう」", "service"), o("b", "作品をたくさんの人に見てもらうこと", "share"), o("c", "自分の力でお店を持つ夢を描くこと", "challenge"), o("d", "仲間と一緒に成長すること", "team") ] },
  { id: "q2", section: "interest", kind: "single", text: "授業や実習で、時間を忘れるのは？", options: [
    o("a", "ウィッグで何度も練習する", "craft"), o("b", "色や形の組み合わせを考える", "design"), o("c", "新しいことに自分から挑戦する", "challenge"), o("d", "みんなで課題を乗り越える", "team") ] },
  { id: "q3", section: "interest", kind: "single", text: "将来、こう言われたいのは？", options: [
    o("a", "「腕がいいね」", "craft"), o("b", "「センスがいいね」", "design"), o("c", "「あなたに会いに来たよ」", "service"), o("d", "「SNSを見て来ました」", "share") ] },
  { id: "q4", section: "interest", kind: "single", text: "10年後に近いのは？", options: [
    o("a", "流行をつくる人になっている", "design"), o("b", "発信で知られている", "share"), o("c", "自分のお店を持っている", "challenge"), o("d", "後輩や仲間を育てている", "team") ] },
  { id: "q5", section: "interest", kind: "single", text: "つい気になってしまうのは？", options: [
    o("a", "技術大会やコンテスト", "craft"), o("b", "お客様に長く愛されるサロン", "service"), o("c", "話題のサロンのSNS", "share"), o("d", "人が育つと評判のお店", "team") ] },
  { id: "q6", section: "interest", kind: "single", text: "グループ実習で、自然に担う役割は？", options: [
    o("a", "手を動かして仕上げる", "craft"), o("b", "アイデアを出す", "design"), o("c", "相手の話をよく聞く", "service"), o("d", "新しいやり方を試す", "challenge") ] },
  // B. 学びたいこと（直接選ぶ）
  { id: "q7", section: "learning", kind: "multi", min: 1, max: 3, text: "入社後1〜2年で学びたいこと（3つまで）", options: (Object.keys(LEARNING_LABEL) as LearningTag[]).map((t, i) => o(String.fromCharCode(97 + i), LEARNING_LABEL[t], t)) },
  { id: "q8", section: "learningFocus", kind: "focus", text: "その中で、特に学びたいものは？（任意）", of: "q7" },
  // C. 大切にしたい働き方（直接選ぶ・選んだ順）
  { id: "q9", section: "values", kind: "ranked", max: 3, text: "就職先で大切にしたいこと（3つまで・選んだ順）", options: VALUE_PRIORITY_OPTIONS.map((v) => ({ id: v.code, label: v.label })) },
  // D. 合いやすい教育環境（5問・各4択。5つの型のうち4つを出し、各タグはちょうど4回登場する）
  { id: "q10", section: "env", kind: "single", text: "新しい技術を覚えるなら？", options: [
    o("a", "手順やチェックで順番に覚える", "step"), o("b", "先輩のそばで見て真似る", "mentor"), o("c", "早く実際にやって直してもらう", "early"), o("d", "自分で調べて練習する", "self") ] },
  { id: "q11", section: "env", kind: "single", text: "教わるなら？", options: [
    o("a", "決まった担当の先輩につく", "mentor"), o("b", "お店全体で教えてくれる", "team"), o("c", "動画や資料が整っている", "step"), o("d", "自分から質問しに行く", "self") ] },
  { id: "q12", section: "env", kind: "single", text: "お客様の施術デビューは？", options: [
    o("a", "十分に練習し、確認を受けてから", "step"), o("b", "早めに少しずつ", "early"), o("c", "担当の先輩が見守る中で", "mentor"), o("d", "チームでフォローしてもらいながら", "team") ] },
  { id: "q13", section: "env", kind: "single", text: "練習の時間は？", options: [
    o("a", "営業後に自由に使える", "self"), o("b", "先輩に練習台をお願いできる", "mentor"), o("c", "みんなで勉強会をする", "team"), o("d", "実際の施術に早めに入りながら練習する", "early") ] },
  { id: "q14", section: "env", kind: "single", text: "うまくいかないときは？", options: [
    o("a", "チェックや確認テストで見直す", "step"), o("b", "現場で挑戦して学ぶ", "early"), o("c", "まず自分で原因を考える", "self"), o("d", "仲間と振り返る", "team") ] },
  // E. 不安に感じること（採点なし）
  { id: "q15", section: "concern", kind: "multi", min: 0, max: 2, text: "不安に感じること（2つまで・任意）", options: (Object.keys(CONCERN_LABEL) as ConcernTag[]).map((t, i) => o(String.fromCharCode(97 + i), CONCERN_LABEL[t], t)) },
];

/** 回答: 質問ID → 選んだ選択肢ID（複数選択・選んだ順）。 */
export type StudentAnswers = Record<string, string[]>;

export function questionById(id: string): StudentQuestion | undefined {
  return STUDENT_QUESTIONS.find((q) => q.id === id);
}

/** 回答の形・件数・重複・選択肢の存在・「特に学びたい」がQ7の中にあること、を検査する。 */
export function isValidStudentAnswers(a: unknown): a is StudentAnswers {
  if (!a || typeof a !== "object" || Array.isArray(a)) return false;
  const ans = a as Record<string, unknown>;
  const known = new Set(STUDENT_QUESTIONS.map((q) => q.id));
  for (const k of Object.keys(ans)) if (!known.has(k)) return false;
  for (const q of STUDENT_QUESTIONS) {
    const v = ans[q.id];
    if (v === undefined) {
      if ((q.kind === "focus") || (q.kind === "multi" && q.min === 0)) continue;
      return false;
    }
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string") || new Set(v).size !== v.length) return false;
    const ids = v as string[];
    if (q.kind === "single") { if (ids.length !== 1 || !q.options.some((x) => x.id === ids[0])) return false; }
    else if (q.kind === "multi") { if (ids.length < q.min || ids.length > q.max || ids.some((x) => !q.options.some((op) => op.id === x))) return false; }
    else if (q.kind === "ranked") { if (ids.length < 1 || ids.length > q.max || ids.some((x) => !q.options.some((op) => op.id === x))) return false; }
    else if (q.kind === "focus") {
      const base = ans[q.of];
      if (ids.length > 1 || (ids.length === 1 && !(Array.isArray(base) && (base as string[]).includes(ids[0])))) return false;
    }
  }
  return true;
}

export const VALUE_PRIORITY_LABELS: Record<string, string> = Object.fromEntries(VALUE_PRIORITY_OPTIONS.map((v) => [v.code, v.label]));
