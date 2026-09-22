import type { Database } from "@/types/database";

/**
 * 「あなたらしさ × サロンらしさ」相性計算まわりの型定義。
 *
 * ★実際の計算は supabase/migrations/0011_stylist_salon_matching.sql の
 * calculate_stylist_salon_match() RPC（SQL側）が行う。ここではRPCの
 * jsonb戻り値の形をTypeScript側で表現するだけで、スコアの再計算は
 * 一切行わない（クライアント側で生のpreference_axes/culture_axesを
 * 受け取ることも無いため、そもそも再計算できない設計）。
 *
 * ★二重管理防止: RPCの生の戻り値shape（Database["public"]["Functions"]
 * ["calculate_stylist_salon_match"]["Returns"]、types/database.ts側で
 * 0011のjsonb_build_object()と完全一致するキー名で定義済み）を正として、
 * ここではそこから型を導出する。8軸（axis_scores）の内部フィールドは
 * RPCの生の戻り値型からそのまま抽出しており、フィールド名・型を
 * 手で複製していない。
 *
 * ただし、RPCの生の戻り値は「available/reason/overall_score/axis_scores の
 * 4フィールドが常に存在し、該当しない側はnull」というフラットな形
 * （PostgreSQLのjsonbはTypeScriptのような判別共用体を型として表現できない
 * ため）。UI側（salon-card.tsx等）は「available: true の場合は
 * overall_score/axis_scoresが必ず存在する」という判別共用体としての
 * 絞り込みに依存しているため、ここでその形へ変換した型を別途定義する
 * （この変換自体は lib/matching/actions.ts が実行時チェックで安全に行う。
 * 詳しくは同ファイルを参照）。
 */

/** RPCの生の戻り値型（types/database.ts側の定義をそのまま参照。複製していない）。 */
export type StylistSalonMatchRpcReturns =
  Database["public"]["Functions"]["calculate_stylist_salon_match"]["Returns"];

/** 8軸スコアの内部shape。RPCの生の戻り値型から抽出し、フィールドを複製していない。 */
export type StylistSalonMatchAxisScores = NonNullable<StylistSalonMatchRpcReturns["axis_scores"]>;

export type StylistSalonMatchResult =
  | { available: true; overall_score: number; axis_scores: StylistSalonMatchAxisScores }
  | { available: false; reason: string };

/** 8軸それぞれの表示ラベル（axis_scoresのキー→日本語ラベル）。 */
export const MATCH_AXIS_LABELS: Record<keyof StylistSalonMatchAxisScores, string> = {
  education: "教育・フォロー",
  challenge: "挑戦への応援",
  personal_brand: "個人ブランド支援",
  collaboration: "チーム協働",
  autonomy: "個人の裁量",
  work_flexibility: "働き方の柔軟性",
  relationship_distance: "人間関係の距離",
  hierarchy: "上下関係のフラットさ",
};

/**
 * 「サロン詳細画面」用のCulture詳細・AI取得（get_public_salon_culture_detail）
 * まわりの型定義。calculate_stylist_salon_matchと同じ設計方針（Database型の
 * 生の戻り値shapeから、UI側が扱いやすい判別共用体へ変換する）を踏襲する。
 *
 * ★culture_axesは、サーバー側（Server Component内）でderiveSalonTypes()に
 * 渡してmain/subタイプを算出する目的でのみ保持する。この型自体を
 * Client Componentへpropsとして渡してはならない（Server Component内で
 * 消費し切ること）。
 */
export type PublicSalonCultureDetailRpcReturns =
  Database["public"]["Functions"]["get_public_salon_culture_detail"]["Returns"];

export type PublicSalonCultureDetailAi = NonNullable<PublicSalonCultureDetailRpcReturns["ai"]>;

export type PublicSalonCultureDetailResult =
  | {
      available: true;
      cultureProfileId: string;
      cultureAxes: NonNullable<PublicSalonCultureDetailRpcReturns["culture_axes"]>;
      valuePriorities: string[];
      comment: string | null;
      ai: PublicSalonCultureDetailAi | null;
    }
  | { available: false; reason: string };
