import { PREFECTURES } from "@/lib/validation/profile-options";

/**
 * 地域ブロックと都道府県の対応表（運営の絞り込み用）。
 * ★区分は一般的な地方区分に従う。三重県は「近畿」に含める（東海＝中部とする区分もあるため、
 *   変える場合はこの表の1か所だけを直す）。
 */
export const REGION_BLOCKS = ["北海道", "東北", "関東", "中部", "近畿", "中国", "四国", "九州・沖縄"] as const;
export type RegionBlock = (typeof REGION_BLOCKS)[number];

export const REGION_PREFECTURES: Record<RegionBlock, readonly string[]> = {
  北海道: ["北海道"],
  東北: ["青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県"],
  関東: ["茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県"],
  中部: ["新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県"],
  近畿: ["三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県"],
  中国: ["鳥取県", "島根県", "岡山県", "広島県", "山口県"],
  四国: ["徳島県", "香川県", "愛媛県", "高知県"],
  "九州・沖縄": ["福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県"],
};

const BLOCK_OF = new Map<string, RegionBlock>();
for (const b of REGION_BLOCKS) for (const p of REGION_PREFECTURES[b]) BLOCK_OF.set(p, b);

/** 都道府県名（完全一致のみ）から地域ブロックを返す。空・不明な値は null（推測しない）。 */
export function regionOf(prefecture: string | null | undefined): RegionBlock | null {
  if (!prefecture) return null;
  return BLOCK_OF.get(prefecture.trim()) ?? null;
}

export function isRegionBlock(v: unknown): v is RegionBlock {
  return typeof v === "string" && (REGION_BLOCKS as readonly string[]).includes(v);
}

export function isPrefecture(v: unknown): v is string {
  return typeof v === "string" && (PREFECTURES as readonly string[]).includes(v);
}

/** 画面表示用。未入力・表にない値は「未設定」（推測で補わない）。 */
export function displayPrefecture(prefecture: string | null | undefined): string {
  return isPrefecture(prefecture?.trim()) ? prefecture!.trim() : "未設定";
}

/** 勤務希望地は自由記述。含まれる都道府県名だけを拾う（「横浜」など市区名からの推測はしない）。 */
export function prefecturesMentionedIn(text: string | null | undefined): string[] {
  if (!text) return [];
  return PREFECTURES.filter((p) => text.includes(p));
}
