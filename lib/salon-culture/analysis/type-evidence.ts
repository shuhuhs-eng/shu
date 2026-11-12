import type { SalonCultureAxes } from "@/types/database";
import {
  deriveSalonTypes,
  hasAllTwelveAxes,
  SALON_TYPE_CONTENT,
  type SalonTypeCode,
} from "@/lib/salon-culture/salon-culture-types";
import { sceneSentence, type Answer, type SceneKey } from "./scenes";

/**
 * サロンタイプ（8タイプ）の「根拠」表示。表示専用。
 *   - タイプの判定式・選出順（deriveSalonTypes）は変更しない。ここは判定結果を説明するだけ。
 *   - 5軸との間で数値を補正しない（タイプ→5軸、5軸→タイプの入力は無い）。
 *   - 根拠は、そのタイプの式が実際に使っている質問の回答を、実回答の文として出す。
 *   - タイプ名だけから実態や能力を断定しない。
 */

/** 各タイプの式が参照する軸（calculateSalonTypeScores と同じ。変更しない）。 */
export const TYPE_SOURCES: Record<SalonTypeCode, SceneKey[]> = {
  education: ["education_support"],
  challenge: ["challenge_openness"],
  personal_brand: ["personal_brand_support"],
  team: ["team_collaboration"],
  autonomy: ["individual_autonomy", "team_collaboration"],
  flexibility: ["work_flexibility"],
  technical_premium: ["technical_specialization", "premium_value"],
  trend: ["trend_orientation", "creative_output"],
};

const TYPE_NOTES: Partial<Record<SalonTypeCode, string>> = {
  trend: "ここでの「発信」は、サロンとしての撮影・SNS発信です。スタッフ個人の発信・指名づくりは、5軸の「個人の発信・指名づくり」で別に見ています。",
  personal_brand: "スタッフ個人の発信・指名づくりについての回答です。サロン全体の発信とは別の内容です。",
  autonomy: "このタイプの判定には、仕事上の連携の回答も使っています。5軸では「仕事上の連携」と「仕事の進め方の裁量」を、それぞれ独立して見ています。",
  flexibility: "勤務日数・時間・休みへの対応についての回答です。5軸には含まれない特徴です。",
  technical_premium: "技術の方向性と価格・価値についての回答です。5軸には含まれない特徴です。",
};

export type TypeBasisItem = {
  code: SalonTypeCode;
  name: string;
  role: "main" | "sub" | "tied";
  /** 実回答に基づく根拠文（そのタイプの式が使う質問の分）。 */
  sentences: string[];
  note: string | null;
};

export type TypeBasis = {
  /** 水準の断定はしない。表示する注記（該当しなければ null）。 */
  levelNote: string | null;
  /** 全12軸が中央のとき true（このとき根拠文は並べない）。 */
  allCentral: boolean;
  items: TypeBasisItem[];
  caption: string;
};

export const TYPE_BASIS_CAPTION =
  "タイプは、回答の中で相対的に高く出た項目から選んでいます。タイプ名だけで、サロンの実態や能力を表すものではありません。";

function toAnswer(value: number | null | undefined): Answer | null {
  if (value == null || !Number.isFinite(value) || value < 0 || value > 100 || value % 25 !== 0) return null;
  return (value / 25 + 1) as Answer;
}

function sentencesFor(code: SalonTypeCode, axes: SalonCultureAxes): string[] {
  const out: string[] = [];
  for (const key of TYPE_SOURCES[code]) {
    const a = toAnswer(axes[key as keyof SalonCultureAxes] as number | undefined);
    if (a != null) out.push(sceneSentence(key, a));
  }
  return out;
}

/** 判定結果（main/sub）を、実回答の文で説明する。12軸が揃っていなければ null。 */
export function deriveTypeBasis(axes: SalonCultureAxes): TypeBasis | null {
  if (!hasAllTwelveAxes(axes)) return null;
  const cls = deriveSalonTypes(axes);
  if (!cls) return null;

  const values = Object.values(cls.scores);
  const max = Math.max(...values);
  const tied = (Object.keys(cls.scores) as SalonTypeCode[]).filter((c) => cls.scores[c] === max);
  const TWELVE = [
    "education_support", "challenge_openness", "personal_brand_support", "team_collaboration",
    "individual_autonomy", "work_flexibility", "technical_specialization", "premium_value",
    "trend_orientation", "creative_output", "relationship_distance", "hierarchy_flatness",
  ] as const;
  const allCentral = TWELVE.every((k) => axes[k] === 50);

  let levelNote: string | null = null;
  if (allCentral) levelNote = "今回の回答では、特定の方向への偏りは見られません。";
  else if (tied.length >= 2) levelNote = "複数の特徴が同程度に表れています。";

  const basisCodes: Array<{ code: SalonTypeCode; role: "main" | "sub" | "tied" }> =
    !allCentral && tied.length >= 2
      ? tied.map((code) => ({ code, role: "tied" as const }))
      : [
          { code: cls.mainType, role: "main" as const },
          { code: cls.subType, role: "sub" as const },
        ];

  const items: TypeBasisItem[] = allCentral
    ? []
    : basisCodes.map(({ code, role }) => ({
        code,
        name: SALON_TYPE_CONTENT[code].name,
        role,
        sentences: sentencesFor(code, axes),
        note: TYPE_NOTES[code] ?? null,
      }));

  return { levelNote, allCentral, items, caption: TYPE_BASIS_CAPTION };
}
