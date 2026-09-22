"use server";

import { createClient } from "@/lib/supabase/server";
import { SALON_PHOTO_SIGNED_URL_EXPIRES_IN } from "@/lib/salon-photos/constants";
import type { StylistSalonMatchResult, PublicSalonCultureDetailResult } from "@/lib/matching/types";
import type { SalonPhotoCategory } from "@/types/database";

/**
 * 「あなたらしさ × サロンらしさ」の相性を、指定サロンについて計算する。
 * 実際の計算・権限チェックはすべてRPC（calculate_stylist_salon_match、
 * SECURITY DEFINER）がSQL側で行う。このServer Actionは呼び出すだけの
 * 薄いラッパーで、クライアント側での再計算・生データの受け渡しは
 * 一切行わない。
 *
 * ★型安全性: supabase.rpc("calculate_stylist_salon_match", ...) の
 * 戻り値 data は、types/database.ts の Functions["calculate_stylist_salon_match"]
 * ["Returns"]（0011のjsonb_build_object()と完全一致するフラットな形：
 * available/reason/overall_score/axis_scoresの4フィールドが常に存在し、
 * 該当しない側はnull）として自動的に型付けされる。ここから
 * lib/matching/types.tsの判別共用体 StylistSalonMatchResult へは、
 * 強制キャスト（as unknown as等）を一切使わず、実行時チェックによる
 * 型安全な絞り込みのみで変換する。
 */
export async function calculateStylistSalonMatch(
  salonUserId: string,
): Promise<StylistSalonMatchResult | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("calculate_stylist_salon_match", {
    p_salon_user_id: salonUserId,
  });

  if (error || !data) {
    console.error("[calculateStylistSalonMatch] RPC failed", {
      message: error?.message,
      code: error?.code,
      salonUserId,
    });
    return null;
  }

  // ★強制キャストなしの型安全な絞り込み。available=trueの場合、RPCの
  // 計算ロジック上 overall_score・axis_scores は必ず非nullで返るが、
  // フラットな戻り値型ではそれをTypeScript側で保証できないため、
  // ここで明示的にnullチェックを行った上でオブジェクトを再構築する
  // （data をそのまま返すのではなく、確認済みの値だけで新しいオブジェクト
  // を組み立てるため、型的に完全に安全）。
  if (data.available && data.overall_score != null && data.axis_scores != null) {
    return {
      available: true,
      overall_score: data.overall_score,
      axis_scores: data.axis_scores,
    };
  }

  return {
    available: false,
    reason: data.reason ?? "unknown",
  };
}

/**
 * サロン詳細画面用に、PUBLICサロンのCulture詳細（culture_axes・
 * value_priorities・comment）とサロンCulture AI（現行版）を取得する。
 * 実際の計算・権限チェックはすべてRPC（get_public_salon_culture_detail、
 * SECURITY DEFINER）がSQL側で行う。このServer Actionは呼び出すだけの
 * 薄いラッパー（calculateStylistSalonMatch()と同じ構造）。
 *
 * ★culture_axesを含む戻り値だが、これはサーバー側（呼び出し元のServer
 * Component）でderiveSalonTypes()に渡してmain/subタイプを算出する目的
 * でのみ使う。呼び出し元はculture_axesをClient Componentへpropsとして
 * 渡してはならない（Server Component内で消費し切ること）。
 *
 * ★型安全性: calculateStylistSalonMatch()と同じく、強制キャスト
 * （as unknown as等）を一切使わず、実行時チェックによる型安全な絞り込み
 * のみで判別共用体へ変換する。
 */
export async function getPublicSalonCultureDetail(
  salonUserId: string,
): Promise<PublicSalonCultureDetailResult | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_public_salon_culture_detail", {
    p_salon_user_id: salonUserId,
  });

  if (error || !data) {
    console.error("[getPublicSalonCultureDetail] RPC failed", {
      message: error?.message,
      code: error?.code,
      salonUserId,
    });
    return null;
  }

  if (
    data.available &&
    data.culture_profile_id != null &&
    data.culture_axes != null &&
    data.value_priorities != null
  ) {
    return {
      available: true,
      cultureProfileId: data.culture_profile_id,
      cultureAxes: data.culture_axes,
      valuePriorities: data.value_priorities,
      comment: data.comment,
      ai: data.ai,
    };
  }

  return {
    available: false,
    reason: data.reason ?? "unknown",
  };
}

export type PublicSalonLink = {
  id: string;
  linkType: string;
  label: string | null;
  url: string;
  sortOrder: number;
};

/**
 * PUBLICサロンの外部リンク一覧を取得する（0015、get_public_salon_links RPC
 * の薄いラッパー）。salon_linksテーブル自体には美容師から直接SELECTできない
 * （RLSは本人のみ）ため、このRPC経由のみが唯一の閲覧経路。
 */
export async function getPublicSalonLinks(salonUserId: string): Promise<PublicSalonLink[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_public_salon_links", {
    p_salon_user_id: salonUserId,
  });

  if (error || !data) {
    console.error("[getPublicSalonLinks] RPC failed", { message: error?.message, salonUserId });
    return [];
  }

  return data.map((row: { id: string; link_type: string; label: string | null; url: string; sort_order: number }) => ({
    id: row.id,
    linkType: row.link_type,
    label: row.label,
    url: row.url,
    sortOrder: row.sort_order,
  }));
}

export type PublicSalonPhoto = {
  id: string;
  category: SalonPhotoCategory;
  sortOrder: number;
  signedUrl: string | null;
};

/**
 * PUBLICサロンの写真ギャラリーを取得する（0015、get_public_salon_photos RPC
 * が id/category/storage_path/sort_order のみを返し、ここ（Next.js側）で
 * salon-photosバケットの signed URL をサーバーサイドで生成する。
 * public URLは一切発行しない。有効期限はサロン本人向け
 * （lib/salon-photos/constants.ts）と同じ方針（1時間程度）。
 * salon_photosテーブル自体・そのRLS（本人のみSELECT）は変更していない。
 */
export async function getPublicSalonPhotos(salonUserId: string): Promise<{
  interior: PublicSalonPhoto[];
  atmosphere: PublicSalonPhoto[];
}> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_public_salon_photos", {
    p_salon_user_id: salonUserId,
  });

  if (error || !data) {
    console.error("[getPublicSalonPhotos] RPC failed", { message: error?.message, salonUserId });
    return { interior: [], atmosphere: [] };
  }

  const withUrls = await Promise.all(
    data.map(async (row: { id: string; category: SalonPhotoCategory; storage_path: string; sort_order: number }) => {
      const { data: signedData, error: signErr } = await supabase.storage
        .from("salon-photos")
        .createSignedUrl(row.storage_path, SALON_PHOTO_SIGNED_URL_EXPIRES_IN);
      return {
        id: row.id,
        category: row.category,
        sortOrder: row.sort_order,
        signedUrl: signErr ? null : (signedData?.signedUrl ?? null),
      };
    }),
  );

  return {
    interior: withUrls.filter((p: PublicSalonPhoto) => p.category === "interior"),
    atmosphere: withUrls.filter((p: PublicSalonPhoto) => p.category === "atmosphere"),
  };
}

/**
 * PUBLICサロンのロゴ（profiles.avatar_path、salon側では「サロンロゴ」として
 * 扱う）を取得する。既存の avatars バケット・avatar_path 列は変更していない。
 * 0015で追加した avatars_select_public_salon_logo ポリシー（PUBLICサロンの
 * ロゴのみ、本人以外もSELECT可能）により、美容師のセッションでも
 * createSignedUrl が成功する。ロゴ未登録の場合は null を返す。
 */
export async function getPublicSalonLogoSignedUrl(salonUserId: string): Promise<string | null> {
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("avatar_path")
    .eq("id", salonUserId)
    .maybeSingle();

  const avatarPath = profile?.avatar_path;
  if (!avatarPath) return null;

  const { data: signedData, error } = await supabase.storage
    .from("avatars")
    .createSignedUrl(avatarPath, SALON_PHOTO_SIGNED_URL_EXPIRES_IN);

  if (error || !signedData) return null;
  return signedData.signedUrl;
}
