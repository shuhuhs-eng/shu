import type { TraitKey } from "./traits";

/**
 * 6才能の「短い説明」（画面表示専用）。診断の配点・計算式・タイプ判定・マッチング計算には一切関与しない。
 * 点数は 0〜100（各才能の「その才能に当てはまる選択肢を選んだ割合」。scoreTraits が回答から算出する既存の値）。
 */
export const TRAIT_INFO: Record<TraitKey, { name: string; description: string }> = {
  T: { name: "技術", description: "カットやカラーなどの技を磨き、正確に仕上げる力" },
  S: { name: "感性", description: "トレンドや雰囲気をつかみ、デザインに活かす力" },
  H: { name: "接客", description: "お客様に寄り添い、信頼関係を築く力" },
  B: { name: "発信", description: "SNSなどで自分の魅力を伝え、指名につなげる力" },
  A: { name: "挑戦", description: "新しいことに踏み出し、成長しようとする力" },
  M: { name: "育成", description: "後輩やチームを支え、成長を後押しする力" },
};

/** 尺度の説明（グラフの近くに常に添える）。 */
export const TRAIT_SCALE_NOTE =
  "各項目は0〜100で表します（100は、その項目に当てはまる選択肢をすべて選んだ状態）。6項目は同じ尺度なので、そのまま比べられます。他の人との順位ではありません。";

/** 六角形の頂点の並び（上から時計回り）。6項目すべてを維持し、並びは TRAITS と同じ。 */
export const TRAIT_ORDER: TraitKey[] = ["T", "S", "H", "B", "A", "M"];
