"use server";

import { createClient } from "@/lib/supabase/server";
import { SALON_PHOTO_SIGNED_URL_EXPIRES_IN } from "@/lib/salon-photos/constants";
import type { Database, SalonPhotoCategory } from "@/types/database";

type SalonPhotoRow = Database["public"]["Tables"]["salon_photos"]["Row"];

export type SalonPhotoWithUrl = {
  id: string;
  category: SalonPhotoCategory;
  sortOrder: number;
  storagePath: string;
  signedUrl: string | null;
};

/**
 * 指定サロン本人の salon_photos を取得し、各 storage_path から署名付きURLを
 * 発行して返す。salon_photos は RLS で本人のみSELECT可能（0014）なため、
 * 呼び出し元（プロフィール編集画面）は必ず本人としてログイン中である前提。
 * private bucket（salon-photos）のため、永続的な公開URLは一切発行しない。
 */
export async function getSalonPhotosWithSignedUrls(): Promise<{
  interior: SalonPhotoWithUrl[];
  atmosphere: SalonPhotoWithUrl[];
} | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: rows, error } = await supabase
    .from("salon_photos")
    .select("*")
    .eq("salon_user_id", user.id)
    .order("category", { ascending: true })
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("[getSalonPhotosWithSignedUrls] fetch failed", error);
    return null;
  }

  const withUrls = await Promise.all(
    (rows ?? []).map(async (row: SalonPhotoRow) => {
      const { data: signedData, error: signErr } = await supabase.storage
        .from("salon-photos")
        .createSignedUrl(row.storage_path, SALON_PHOTO_SIGNED_URL_EXPIRES_IN);
      return {
        id: row.id,
        category: row.category,
        sortOrder: row.sort_order,
        storagePath: row.storage_path,
        signedUrl: signErr ? null : (signedData?.signedUrl ?? null),
      };
    }),
  );

  return {
    interior: withUrls.filter((p: SalonPhotoWithUrl) => p.category === "interior"),
    atmosphere: withUrls.filter((p: SalonPhotoWithUrl) => p.category === "atmosphere"),
  };
}

/**
 * 指定カテゴリで「現在空いている最小のsort_order（0〜2）」を返す。
 * 例: 0,2が使用中なら1を返す。3枚すでに埋まっている場合はnullを返す
 * （呼び出し元はこの場合、追加操作自体をUI側で無効化している想定だが、
 * 念のためサーバー側でも確認する）。
 */
async function findNextSortOrder(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  category: SalonPhotoCategory,
): Promise<number | null> {
  const { data: rows } = await supabase
    .from("salon_photos")
    .select("sort_order")
    .eq("salon_user_id", userId)
    .eq("category", category);

  const used = new Set((rows ?? []).map((r: { sort_order: number }) => r.sort_order));
  for (const candidate of [0, 1, 2]) {
    if (!used.has(candidate)) return candidate;
  }
  return null;
}

export type AddSalonPhotoResult =
  | { success: true; photo: SalonPhotoWithUrl }
  | { success: false; error: string };

/**
 * Storageへのアップロードが成功した後に呼ぶ。「現在空いている最小の
 * sort_order」をサーバー側で決定した上で、add_salon_photo() RPC（0014、
 * caller=salon role・storage_path所有権・category整合性・3枚上限を
 * RPC/DB側で検証する）を呼ぶ薄いラッパー。
 *
 * ★ここでDB登録（RPC呼び出し）が失敗した場合、アップロード済みのStorage
 * オブジェクトを削除して孤児ファイルを残さない（呼び出し元のクライアント
 * コンポーネントが、この関数の戻り値がsuccess:falseの場合にstorage_pathを
 * 使って削除する設計ではなく、ここで一貫して削除まで行う）。
 */
export async function addSalonPhotoAction(
  category: SalonPhotoCategory,
  storagePath: string,
): Promise<AddSalonPhotoResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    await supabase.storage.from("salon-photos").remove([storagePath]);
    return { success: false, error: "セッションが切れています。再度ログインしてください。" };
  }

  const sortOrder = await findNextSortOrder(supabase, user.id, category);
  if (sortOrder === null) {
    // 3枚上限に達している。アップロード済みのオブジェクトは孤児にしない。
    await supabase.storage.from("salon-photos").remove([storagePath]);
    return { success: false, error: "このカテゴリの画像は既に3枚登録されています。" };
  }

  const { data: created, error } = await supabase.rpc("add_salon_photo", {
    p_category: category,
    p_storage_path: storagePath,
    p_sort_order: sortOrder,
  });

  if (error || !created) {
    console.error("[addSalonPhotoAction] add_salon_photo RPC failed", error);
    // ★DB登録に失敗した場合、アップロード済みのStorageオブジェクトを削除し
    // 孤児ファイルを残さない。
    await supabase.storage.from("salon-photos").remove([storagePath]);
    return { success: false, error: "画像の登録に失敗しました。もう一度お試しください。" };
  }

  const { data: signedData, error: signErr } = await supabase.storage
    .from("salon-photos")
    .createSignedUrl(created.storage_path, SALON_PHOTO_SIGNED_URL_EXPIRES_IN);

  return {
    success: true,
    photo: {
      id: created.id,
      category: created.category,
      sortOrder: created.sort_order,
      storagePath: created.storage_path,
      signedUrl: signErr ? null : (signedData?.signedUrl ?? null),
    },
  };
}

export type DeleteSalonPhotoResult = { success: true } | { success: false; error: string };

/**
 * 画像削除。重要な順序: ①Storage object削除 → 成功した場合のみ ②DB行削除
 * （delete_salon_photo RPC、0014、DB行のみ削除する仕様）。
 * Storage削除に失敗した場合はDB行を削除しない（呼び出し元にエラーを返す）。
 * DB削除（RPC）が失敗した場合もエラーを返し、呼び出し元が状態を再取得できる
 * ようにする（Storageは既に削除済みのままになるが、DB行が孤立して
 * 誤って「登録済みの画像」として見え続けることを防ぐ方を優先する）。
 */
export async function deleteSalonPhotoAction(
  photoId: string,
  storagePath: string,
): Promise<DeleteSalonPhotoResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "セッションが切れています。再度ログインしてください。" };
  }

  // ①Storage object削除
  const { error: storageErr } = await supabase.storage.from("salon-photos").remove([storagePath]);
  if (storageErr) {
    console.error("[deleteSalonPhotoAction] storage remove failed", storageErr);
    return { success: false, error: "画像の削除に失敗しました。もう一度お試しください。" };
  }

  // ②Storage削除が成功した場合のみDB行を削除する。
  const { error: dbErr } = await supabase.rpc("delete_salon_photo", { p_photo_id: photoId });
  if (dbErr) {
    console.error("[deleteSalonPhotoAction] delete_salon_photo RPC failed", dbErr);
    return {
      success: false,
      error: "画像データの削除に失敗しました。画面を更新してもう一度お試しください。",
    };
  }

  return { success: true };
}
