/**
 * 美容学生・新卒 診断の結果の作り方（docs/student-newgrad-diagnosis-design.md 3〜4章）。
 * 点数・順位・割合は作らない。同数は「同程度」として同列に扱い、固定順で優劣を付けない。
 * 既存の scoreTraits / marketValue / PAIR は使わない。
 */
import {
  CONCERN_LABEL, ENV_LABEL, INTEREST_LABEL, LEARNING_LABEL, STUDENT_QUESTIONS, VALUE_PRIORITY_LABELS,
  isValidStudentAnswers, type ConcernTag, type EnvTag, type InterestTag, type LearningTag, type StudentAnswers,
} from "./questions";

export type LevelGroups<T extends string> = {
  /** 最多の回数のタグ（同数はすべて・同程度）。balanced / weak のときは空。 */
  top: T[];
  /** 次点の回数のタグ（同数はすべて・同程度）。 */
  next: T[];
  /** 最多のタグが4つ以上＝特定の方向に偏らない。 */
  balanced: boolean;
  /** 最多の回数が1以下＝特に強い傾向は出ていない。 */
  weak: boolean;
};

export type StudentResult = {
  version: string;
  interests: LevelGroups<InterestTag>;
  learning: { chosen: LearningTag[]; focus: LearningTag | null };
  values: string[]; // value コード（本人が選んだ順）
  env: LevelGroups<EnvTag>;
  concerns: ConcernTag[];
};

function groups<T extends string>(counts: Record<T, number>): LevelGroups<T> {
  const tags = Object.keys(counts) as T[];
  const m = Math.max(...tags.map((t) => counts[t]));
  if (m <= 1) return { top: [], next: [], balanced: false, weak: true };
  const top = tags.filter((t) => counts[t] === m);
  if (top.length >= 4) return { top: [], next: [], balanced: true, weak: false };
  const lower = tags.map((t) => counts[t]).filter((c) => c < m && c >= 2);
  const m2 = lower.length ? Math.max(...lower) : 0;
  const next = m2 ? tags.filter((t) => counts[t] === m2) : [];
  // 並び順に意味を持たせない: タグ名の辞書順に固定する（優劣ではない）
  return { top: [...top].sort(), next: next.length >= 4 ? [] : [...next].sort(), balanced: false, weak: false };
}

export function computeStudentResult(answers: StudentAnswers, version: string): StudentResult {
  if (!isValidStudentAnswers(answers)) throw new Error("invalid student answers");
  const ic: Record<InterestTag, number> = { craft: 0, design: 0, service: 0, share: 0, challenge: 0, team: 0 };
  const ec: Record<EnvTag, number> = { step: 0, mentor: 0, early: 0, self: 0, team: 0 };
  let chosen: LearningTag[] = []; let focus: LearningTag | null = null; let values: string[] = []; let concerns: ConcernTag[] = [];
  for (const q of STUDENT_QUESTIONS) {
    const v = answers[q.id] ?? [];
    if (q.section === "interest") ic[q.options.find((x) => x.id === v[0])!.tag] += 1;
    else if (q.section === "env") ec[q.options.find((x) => x.id === v[0])!.tag] += 1;
    else if (q.section === "learning") chosen = v.map((id) => q.options.find((x) => x.id === id)!.tag);
    else if (q.section === "values") values = [...v];
    else if (q.section === "concern") concerns = v.map((id) => q.options.find((x) => x.id === id)!.tag);
  }
  const fq = answers["q8"]?.[0];
  if (fq) focus = (STUDENT_QUESTIONS.find((q) => q.id === "q7") as Extract<(typeof STUDENT_QUESTIONS)[number], { section: "learning" }>).options.find((x) => x.id === fq)!.tag;
  return { version, interests: groups(ic), learning: { chosen, focus }, values, env: groups(ec), concerns };
}

const join = (xs: string[]) => xs.join("・");

/** 画面に出す文章（点数・割合・順位の数字は出さない。能力を断定しない）。 */
export function describeStudentResult(r: StudentResult) {
  const interest = r.interests.balanced
    ? "特定の方向に偏らず、幅広く興味がありそうです。"
    : r.interests.weak
      ? "特に強い傾向は出ませんでした。見学で、気になる場面を探してみましょう。"
      : `「${join(r.interests.top.map((t) => INTEREST_LABEL[t]))}」に、同じくらい気持ちが向いているようです。` +
        (r.interests.next.length ? `続いて「${join(r.interests.next.map((t) => INTEREST_LABEL[t]))}」にも関心がありそうです。` : "");
  const learning = `学びたいこと: ${join(r.learning.chosen.map((t) => LEARNING_LABEL[t]))}。` + (r.learning.focus ? `特に学びたいのは「${LEARNING_LABEL[r.learning.focus]}」です。` : "");
  const values = r.values.map((c) => VALUE_PRIORITY_LABELS[c] ?? c);
  const env = r.env.balanced
    ? "特定の型にこだわらず、いろいろな教え方になじめそうです。"
    : r.env.weak
      ? "合いやすい環境の傾向は、まだはっきりしていません。見学で、教え方を比べてみましょう。"
      : r.env.top.map((t) => `${ENV_LABEL[t].name}: ${ENV_LABEL[t].text}が合いやすいようです。`).join("") +
        (r.env.next.length ? r.env.next.map((t) => `${ENV_LABEL[t].name}にも、なじみやすそうです。`).join("") : "");
  return { interest, learning, values, env };
}

const ENV_NEXT: Record<EnvTag, string> = {
  step: "見学で「カリキュラムが段階的に決まっているか」「練習時間が勤務の中にあるか」を確認しましょう。",
  mentor: "見学で「担当の先輩がつくか」「フィードバックをもらう頻度」を確認しましょう。",
  early: "「デビューまでの目安の期間」と「最初の施術の流れ」を確認しましょう。",
  self: "「営業後の練習場所」と「道具の貸し出し」があるかを確認しましょう。",
  team: "「勉強会の頻度」と「参加の仕方」を確認しましょう。",
};
const CONCERN_NEXT: Record<ConcernTag, string> = {
  nervous: "お客様の前に立つまでのステップと、練習相手がいるかを相談してみましょう。",
  skill: "技術が身につくまでの教育の流れと、チェックの仕組みを聞いてみましょう。",
  senior: "先輩との関わり方や、相談しやすい体制があるかを聞いてみましょう。",
  hours: "実際のシフトと、休みの取り方を確認しましょう。",
  income: "入社後の給与の仕組みと、評価の基準を確認しましょう。",
  choice: "見学を複数申し込んで、同じ質問で比べてみましょう（見学の申込は運営が仲介します）。",
};

/** 「次の一手」: サロン見学・教育カリキュラム・練習や相談の体制の確認。 */
export function studentNextSteps(r: StudentResult): string[] {
  const steps: string[] = [];
  const envTags = r.env.balanced || r.env.weak ? [] : [...r.env.top, ...r.env.next];
  envTags.forEach((t) => steps.push(ENV_NEXT[t]));
  if (!envTags.length) steps.push("見学で、教え方や練習の体制をいくつかのサロンで比べてみましょう。");
  r.concerns.forEach((c) => steps.push(CONCERN_NEXT[c]));
  return steps;
}

export { CONCERN_LABEL };
