import type { Database } from "@/types/database";

/**
 * get_public_stylists_for_scout（0025）の戻り値の1行分の型。
 * サーバー側の生の戻り値shapeをそのまま利用し、フィールドを複製していない。
 */
export type PublicStylistForScout =
  Database["public"]["Functions"]["get_public_stylists_for_scout"]["Returns"][number];

export type ScoutMatch = PublicStylistForScout["match"];
