import type { SalonCultureAxes } from "@/types/database";

/**
 * サロン8タイプ（表示用）の定義・算出ロジック。
 *
 * ★重要な設計方針:
 *   - ここにあるのは「表示用」のタイプ判定のみ。将来のマッチングロジックは
 *     この8タイプを直接使わず、元の12軸（SalonCultureAxes）を直接使う想定
 *     （8タイプへ圧縮すると情報量が失われるため）。この設計を壊さないよう、
 *     ここで定義する関数はすべて culture_axes を受け取って都度算出する
 *     読み取り専用の純粋関数であり、DBへの書き込み・RPC呼び出しは一切ない。
 *   - 新12軸（education_support〜hierarchy_flatness）がすべて揃っていない
 *     場合（旧3軸・旧5軸のみの既存ユーザー等）は、0として扱ってタイプを
 *     算出することはしない。hasAllTwelveAxes()で判定し、揃っていなければ
 *     呼び出し側（UI）が更新案内を表示する設計とする。
 */

export type SalonTypeCode =
  | "education"
  | "challenge"
  | "personal_brand"
  | "team"
  | "autonomy"
  | "flexibility"
  | "technical_premium"
  | "trend";

export type SalonTypeContent = {
  code: SalonTypeCode;
  icon: string;
  name: string;
  description: string;
  characterImagePath: string;
};

/** 8タイプの表示用コンテンツ（アイコン・名称・説明文）。指定文言をそのまま使用。 */
export const SALON_TYPE_CONTENT: Record<SalonTypeCode, SalonTypeContent> = {
  education: {
    code: "education",
    icon: "🎓",
    name: "しっかり育成型",
    description: "若手や成長途中のスタッフを、教育やフォローでしっかり支えるサロン。",
    characterImagePath: "/salon-characters/education.png",
  },
  challenge: {
    code: "challenge",
    icon: "🚀",
    name: "チャレンジ応援型",
    description: "新しい技術やアイデアを歓迎し、スタッフの挑戦を後押しするサロン。",
    characterImagePath: "/salon-characters/challenge.png",
  },
  personal_brand: {
    code: "personal_brand",
    icon: "🌟",
    name: "個人ブランド応援型",
    description: "SNSや指名づくりなど、一人ひとりの強みや発信を伸ばすサロン。",
    characterImagePath: "/salon-characters/personal_brand.png",
  },
  team: {
    code: "team",
    icon: "🤝",
    name: "仲間・チーム重視型",
    description: "担当を越えて助け合い、チームでサロンをつくっていく文化が強いサロン。",
    characterImagePath: "/salon-characters/team.png",
  },
  autonomy: {
    code: "autonomy",
    icon: "🪽",
    name: "自由・マイペース型",
    description: "個人の判断やペースを尊重し、自分らしい働き方をしやすいサロン。",
    characterImagePath: "/salon-characters/autonomy.png",
  },
  flexibility: {
    code: "flexibility",
    icon: "🌿",
    name: "働きやすさ重視型",
    description: "勤務時間や休みなど、一人ひとりが無理なく働き続けられる環境を大切にするサロン。",
    characterImagePath: "/salon-characters/flexibility.png",
  },
  technical_premium: {
    code: "technical_premium",
    icon: "💎",
    name: "技術・高単価型",
    description: "高い技術力や専門性、サービス価値を磨き、品質で選ばれることを目指すサロン。",
    characterImagePath: "/salon-characters/technical_premium.png",
  },
  trend: {
    code: "trend",
    icon: "🔥",
    name: "トレンド・発信型",
    description: "新しいスタイルや技術を積極的に取り入れ、美容の世界観を発信するサロン。",
    characterImagePath: "/salon-characters/trend.png",
  },
};

/** 同点時のtie-break固定順（この配列の並び順がそのまま優先順位）。 */
export const SALON_TYPE_TIEBREAK_ORDER: SalonTypeCode[] = [
  "education",
  "challenge",
  "personal_brand",
  "team",
  "autonomy",
  "flexibility",
  "technical_premium",
  "trend",
];

/** 新12軸すべてのキー一覧。8タイプ算出・特徴抽出の両方で使う。 */
const ALL_TWELVE_AXIS_KEYS = [
  "education_support",
  "challenge_openness",
  "personal_brand_support",
  "team_collaboration",
  "individual_autonomy",
  "work_flexibility",
  "technical_specialization",
  "premium_value",
  "trend_orientation",
  "creative_output",
  "relationship_distance",
  "hierarchy_flatness",
] as const;

/**
 * 新12軸がすべて揃っているか（旧3軸・旧5軸のみの既存データではないか）を判定する。
 * 1つでも欠けていれば false。欠けている場合、呼び出し側は0として扱って
 * タイプ算出をしてはならない（更新案内を表示する）。
 */
export function hasAllTwelveAxes(axes: SalonCultureAxes): boolean {
  return ALL_TWELVE_AXIS_KEYS.every((key) => axes[key] != null);
}

export type SalonTypeScores = Record<SalonTypeCode, number>;

/**
 * 8タイプそれぞれのスコア（0〜100）を算出する。
 * 呼び出し前に hasAllTwelveAxes(axes) が true であることを確認しておくこと
 * （このスキーマシンプルさを保つため、未回答チェックはここでは行わない）。
 */
export function calculateSalonTypeScores(axes: SalonCultureAxes): SalonTypeScores {
  const educationSupport = axes.education_support ?? 0;
  const challengeOpenness = axes.challenge_openness ?? 0;
  const personalBrandSupport = axes.personal_brand_support ?? 0;
  const teamCollaboration = axes.team_collaboration ?? 0;
  const individualAutonomy = axes.individual_autonomy ?? 0;
  const workFlexibility = axes.work_flexibility ?? 0;
  const technicalSpecialization = axes.technical_specialization ?? 0;
  const premiumValue = axes.premium_value ?? 0;
  const trendOrientation = axes.trend_orientation ?? 0;
  const creativeOutput = axes.creative_output ?? 0;

  return {
    education: educationSupport,
    challenge: challengeOpenness,
    personal_brand: personalBrandSupport,
    team: teamCollaboration,
    autonomy: (individualAutonomy + (100 - teamCollaboration)) / 2,
    flexibility: workFlexibility,
    technical_premium: (technicalSpecialization + premiumValue) / 2,
    trend: (trendOrientation + creativeOutput) / 2,
  };
}

export type SalonTypeClassification = {
  scores: SalonTypeScores;
  mainType: SalonTypeCode;
  subType: SalonTypeCode;
};

/**
 * culture_axesからサロン8タイプのmain/subを判定する。
 * 新12軸が揃っていない場合はnullを返す（呼び出し側で更新案内を表示すること）。
 * 同点時はSALON_TYPE_TIEBREAK_ORDERの並び順で固定的にtie-breakする。
 */
export function deriveSalonTypes(axes: SalonCultureAxes): SalonTypeClassification | null {
  if (!hasAllTwelveAxes(axes)) return null;

  const scores = calculateSalonTypeScores(axes);
  const ranked = [...SALON_TYPE_TIEBREAK_ORDER].sort((a, b) => {
    const diff = scores[b] - scores[a];
    if (diff !== 0) return diff;
    // 同点の場合、SALON_TYPE_TIEBREAK_ORDER上で先に出てくる方を優先する
    // （常に同じ結果になるようにするための明示的な比較。配列のstable sortに
    // 依存せず、indexOfで明示的に順序を決める）。
    return SALON_TYPE_TIEBREAK_ORDER.indexOf(a) - SALON_TYPE_TIEBREAK_ORDER.indexOf(b);
  });

  return { scores, mainType: ranked[0], subType: ranked[1] };
}

/** 12軸それぞれの、値が低い側/高い側を表す短い特徴フレーズ。 */
const AXIS_PHRASES: Record<(typeof ALL_TWELVE_AXIS_KEYS)[number], { low: string; high: string }> = {
  education_support: { low: "本人のペースを尊重して育てる", high: "教育プログラムでしっかり育てる" },
  challenge_openness: { low: "実績を見ながら慎重に挑戦する", high: "新しい挑戦を積極的に歓迎" },
  personal_brand_support: { low: "サロンの看板を活かして集客する", high: "個人の指名づくりを後押し" },
  team_collaboration: { low: "各自が自分の担当に集中する", high: "担当を越えて助け合う" },
  individual_autonomy: { low: "共通のルールに沿って働く", high: "一人ひとりの判断を尊重する" },
  work_flexibility: { low: "決まった勤務体系で運営する", high: "個々の事情に合わせて調整する" },
  technical_specialization: { low: "幅広いメニューに対応する", high: "特定分野の専門性を磨く" },
  premium_value: { low: "通いやすい価格を大切にする", high: "価値・品質で選ばれることを重視" },
  trend_orientation: { low: "定着を見ながら取り入れる", high: "話題の技術をいち早く試す" },
  creative_output: { low: "必要な情報を中心に発信する", high: "撮影やSNSで世界観を発信" },
  relationship_distance: { low: "仕事とプライベートは分ける", high: "仕事以外でも自然に交流する" },
  hierarchy_flatness: { low: "役割や立場を明確にしている", high: "立場に関係なく意見を言い合う" },
};

type CharacteristicEntry = {
  key: (typeof ALL_TWELVE_AXIS_KEYS)[number];
  value: number;
  strength: number;
  direction: "low" | "high";
};

/**
 * 「本当に意味が重複する」と判断された、方向まで含めた特定の1組のみを
 * 重複防止の対象にする（12軸すべてを機械的にグループ化して制限する方式は
 * 採用しない。team_collaboration/relationship_distance/hierarchy_flatnessの
 * ように、意味が異なるため同時表示されるべき軸の組み合わせの方が多い）。
 *
 * 対象は education_support が LOW（本人のペースを尊重して育てる）と
 * individual_autonomy が HIGH（一人ひとりの判断を尊重する）の組み合わせのみ。
 * 「本人に任せる」という意味がこの方向の組み合わせでのみ強く重なるため。
 * 他の方向（education_support HIGH × individual_autonomy HIGH等）は対象外。
 */
function conflictsWithSelected(candidate: CharacteristicEntry, selected: CharacteristicEntry[]): boolean {
  const isEducationLow = candidate.key === "education_support" && candidate.direction === "low";
  const isAutonomyHigh = candidate.key === "individual_autonomy" && candidate.direction === "high";
  if (!isEducationLow && !isAutonomyHigh) return false;

  return selected.some(
    (s) =>
      (isEducationLow && s.key === "individual_autonomy" && s.direction === "high") ||
      (isAutonomyHigh && s.key === "education_support" && s.direction === "low"),
  );
}

/**
 * 「このサロンの特徴」として、12軸のうち最も特徴的な（50から離れている）
 * 上位N件（デフォルト4件）を短いフレーズで返す。数値そのものではなく、
 * 傾向を表す一言に変換する（100点満点評価に見えないようにするため）。
 * 新12軸が揃っていない場合はnullを返す（hasAllTwelveAxes参照）。
 *
 * ★重複防止: strength（50からの距離）降順で候補を走査し、
 * conflictsWithSelected()で弾かれた候補はスキップして次点の軸を採用する
 * （対象はeducation_support LOW × individual_autonomy HIGHの1組のみ）。
 * strengthが同点の場合はALL_TWELVE_AXIS_KEYSの並び順（安定ソート）で
 * 決まるため、常に同じ結果になる。
 *
 * ★このロジックは表示する4件の「選び方」のみを変更する。12軸スコア自体
 * （calculateSalonTypeScores）・main/subタイプ算出（deriveSalonTypes）には
 * 一切影響しない（別関数であり、このロジックからは呼ばれていない）。
 */
export function deriveTopCharacteristics(axes: SalonCultureAxes, count = 4): string[] | null {
  if (!hasAllTwelveAxes(axes)) return null;

  const ranked: CharacteristicEntry[] = ALL_TWELVE_AXIS_KEYS.map((key) => {
    const value = axes[key] as number;
    return {
      key,
      value,
      strength: Math.abs(value - 50),
      direction: (value >= 50 ? "high" : "low") as "high" | "low",
    };
  }).sort((a, b) => b.strength - a.strength);

  const selected: CharacteristicEntry[] = [];
  for (const entry of ranked) {
    if (selected.length >= count) break;
    if (conflictsWithSelected(entry, selected)) continue;
    selected.push(entry);
  }

  return selected.map((entry) => {
    const phrase = AXIS_PHRASES[entry.key];
    return entry.direction === "high" ? phrase.high : phrase.low;
  });
}
