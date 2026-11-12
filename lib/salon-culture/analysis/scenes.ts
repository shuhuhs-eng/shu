/**
 * 「サロンらしさ」の各質問を、画面の根拠文に使う短い言い回しにしたもの。
 * 12問（既存）と追加5問（salon-analysis-v1）の両方を、1か所で定義する。
 * 質問文・選択肢の意味は変えていない（既存12問は culture wizard の左右ラベルの要約）。
 */

export type SceneKey =
  | "education_support"
  | "challenge_openness"
  | "personal_brand_support"
  | "team_collaboration"
  | "individual_autonomy"
  | "work_flexibility"
  | "technical_specialization"
  | "premium_value"
  | "trend_orientation"
  | "creative_output"
  | "q13_nurture_learning_flow"
  | "q14_nurture_feedback"
  | "q15_brand_staff_presentation"
  | "q16_team_handover"
  | "q17_discretion_proposal";

export type Scene = {
  /** 「〜では、」に続く場面名。 */
  scene: string;
  /** 回答1側の方針（「〜寄りです」に続けられる形）。 */
  low: string;
  /** 回答5側の方針。 */
  high: string;
};

export const SCENES: Record<SceneKey, Scene> = {
  education_support: {
    scene: "若手スタッフが新しい技術を身につけるとき",
    low: "本人のペースや自主性を尊重する",
    high: "計画・練習・フォローまでサロンが積極的に支援する",
  },
  challenge_openness: {
    scene: "スタッフから新しい技術や取り組みの提案があったとき",
    low: "実績やリスクを確認し、十分検討してから進める",
    high: "まず挑戦できる方法を一緒に考える",
  },
  personal_brand_support: {
    scene: "スタッフが自分のSNSや指名客づくりに力を入れたい場合",
    low: "サロン全体のブランド・集客を中心にする",
    high: "個人の発信・指名・ブランドづくりも積極的に支援する",
  },
  team_collaboration: {
    scene: "忙しい時間帯の動き方",
    low: "各自が自分のお客様・仕事を中心に動く",
    high: "担当を越えて声を掛け合い、チームで助け合う",
  },
  individual_autonomy: {
    scene: "日々の仕事の進め方",
    low: "サロン共通のルール・やり方を重視する",
    high: "基本方針の中で、一人ひとりの判断ややり方を尊重する",
  },
  work_flexibility: {
    scene: "勤務日数・時間・休みの希望があったとき",
    low: "基本的にサロンの勤務体系を優先する",
    high: "できるだけ個々の事情や生活に合わせて調整する",
  },
  technical_specialization: {
    scene: "サロンの技術づくり",
    low: "幅広いお客様・メニューに対応できることを重視する",
    high: "特定分野でも高い専門性・技術品質を追求する",
  },
  premium_value: {
    scene: "価格と提供価値",
    low: "通いやすい価格と利用しやすさを重視する",
    high: "価格が高くても選ばれる、高い価値・品質を重視する",
  },
  trend_orientation: {
    scene: "新しいスタイルや技術が話題になったとき",
    low: "定着度や再現性を確認してから取り入れる",
    high: "早い段階から試し、積極的に取り入れる",
  },
  creative_output: {
    scene: "サロンとしての撮影・SNSなどの美容発信",
    low: "必要な情報やスタイルを中心に発信する",
    high: "撮影・SNSなどで、新しいスタイルや世界観を積極的に発信する",
  },
  q13_nurture_learning_flow: {
    scene: "新人・若手が技術を身につけるまでの流れ",
    low: "流れは決めず、本人や担当者ごとに進める",
    high: "段階や進め方がサロンとして決まっている",
  },
  q14_nurture_feedback: {
    scene: "スタッフへのフィードバックの機会",
    low: "必要に応じて、その都度伝える",
    high: "面談や振り返りなど、決まった場がある",
  },
  q15_brand_staff_presentation: {
    scene: "公式SNS・ホームページでのスタッフ個人の紹介",
    low: "サロンとしての紹介が中心で、個人の紹介は少ない",
    high: "スタッフ個人の紹介や発信を積極的に行う",
  },
  q16_team_handover: {
    scene: "担当スタッフが不在・対応できないときのお客様対応",
    low: "担当者を基本とし、不在時は予約変更などを個別に調整する",
    high: "お客様のご希望や対応できる技術を確認したうえで、他のスタッフが引き継いで対応する",
  },
  q17_discretion_proposal: {
    scene: "お客様への提案内容の決め方",
    low: "サロンとして決めた提案内容・メニューを基本とする",
    high: "基本方針の中で、スタッフが自分の判断で提案する",
  },
};

export type Answer = 1 | 2 | 3 | 4 | 5;

/** 回答1〜5を、強さの言葉つきの根拠文にする。1と5＝はっきり、2と4＝どちらかといえば、3＝中間。 */
export function sceneSentence(key: SceneKey, answer: Answer): string {
  const s = SCENES[key];
  if (answer === 3) return `${s.scene}では、どちらの方針にも寄っていません（中間）。`;
  const side = answer <= 2 ? s.low : s.high;
  const strength = answer === 1 || answer === 5 ? "はっきり" : "どちらかといえば";
  return `${s.scene}では、${strength}「${side}」寄りです。`;
}

export function sceneNaSentence(key: SceneKey): string {
  return `${SCENES[key].scene}：「当てはまらない」と回答しています。`;
}

/** 追加5問の質問文（画面表示用）。 */
export const SUPPLEMENT_TITLES: Record<
  "q13_nurture_learning_flow" | "q14_nurture_feedback" | "q15_brand_staff_presentation" | "q16_team_handover" | "q17_discretion_proposal",
  string
> = {
  q13_nurture_learning_flow: "新人・若手が技術を身につけるまでの流れについて、実際のサロンに近いのは？",
  q14_nurture_feedback: "スタッフへのフィードバックの機会について、実際のサロンに近いのは？",
  q15_brand_staff_presentation: "公式SNS・ホームページでのスタッフ個人の紹介について、実際のサロンに近いのは？",
  q16_team_handover: "担当スタッフが不在・対応できないときのお客様対応について、実際のサロンに近いのは？",
  q17_discretion_proposal: "お客様への提案内容の決め方について、実際のサロンに近いのは？",
};
