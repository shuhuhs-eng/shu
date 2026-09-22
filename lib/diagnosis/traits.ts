// 6才能。色は結果・グラフ専用のプレゼンテーション値（判定には使用しない）。
export type TraitKey = "T" | "S" | "H" | "B" | "A" | "M";
export type TraitScores = Record<TraitKey, number>;

export type Trait = { key: TraitKey; jp: string; romaji: string; color: string };

export const TRAITS: Trait[] = [
  { key: "T", jp: "技術", romaji: "CRAFT", color: "#2B4A7E" },
  { key: "S", jp: "感性", romaji: "SENSE", color: "#B23A6B" },
  { key: "H", jp: "接客", romaji: "HOSPITALITY", color: "#CE6B4F" },
  { key: "B", jp: "発信", romaji: "BRAND", color: "#6E4AA6" },
  { key: "A", jp: "挑戦", romaji: "DRIVE", color: "#D89A3B" },
  { key: "M", jp: "育成", romaji: "MENTOR", color: "#2E8B7F" },
];

export const TC: Record<TraitKey, string> = Object.fromEntries(
  TRAITS.map((t) => [t.key, t.color]),
) as Record<TraitKey, string>;

export const TJP: Record<TraitKey, string> = Object.fromEntries(
  TRAITS.map((t) => [t.key, t.jp]),
) as Record<TraitKey, string>;
