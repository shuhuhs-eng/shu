"use server";

import { createClient } from "@/lib/supabase/server";
import { addSalonLinkSchema } from "@/lib/validation/salon-links";
import type { Database, SalonLinkType } from "@/types/database";

export type SalonLinkRow = Database["public"]["Tables"]["salon_links"]["Row"];

/**
 * サロン本人の salon_links 一覧を取得する（RLSのselect_ownにより本人の
 * 行のみ返る）。
 */
export async function getSalonLinks(): Promise<SalonLinkRow[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("salon_links")
    .select("*")
    .eq("salon_user_id", user.id)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("[getSalonLinks] fetch failed", error);
    return [];
  }
  return data ?? [];
}

export type AddSalonLinkResult = { success: true; link: SalonLinkRow } | { success: false; error: string };

/**
 * 外部リンクを1件追加する。サーバー側で「現在空いている最小のsort_order
 * （0〜4）」を算出した上で、salon_linksへ直接INSERTする（0014の
 * salon_photosと異なり、salon_linksはRLSでサロン本人の直接INSERTを
 * 許可する設計のため、専用RPCは経由しない。ただし件数チェック・
 * sort_order算出・URL形式の検証はすべてこのServer Action側で一元的に
 * 行う）。
 */
export async function addSalonLinkAction(input: {
  linkType: string;
  label: string;
  url: string;
}): Promise<AddSalonLinkResult> {
  const parsed = addSalonLinkSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "入力内容をご確認ください。" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "セッションが切れています。再度ログインしてください。" };
  }

  const { data: existing } = await supabase
    .from("salon_links")
    .select("sort_order")
    .eq("salon_user_id", user.id);

  const used = new Set((existing ?? []).map((r: { sort_order: number }) => r.sort_order));
  let sortOrder: number | null = null;
  for (const candidate of [0, 1, 2, 3, 4]) {
    if (!used.has(candidate)) {
      sortOrder = candidate;
      break;
    }
  }
  if (sortOrder === null) {
    return { success: false, error: "外部リンクは既に5件登録されています。" };
  }

  const v = parsed.data;
  const { data: created, error } = await supabase
    .from("salon_links")
    .insert({
      salon_user_id: user.id,
      link_type: v.linkType as SalonLinkType,
      label: v.label || null,
      url: v.url,
      sort_order: sortOrder,
    })
    .select("*")
    .single();

  if (error || !created) {
    console.error("[addSalonLinkAction] insert failed", error);
    return { success: false, error: "リンクの登録に失敗しました。もう一度お試しください。" };
  }

  return { success: true, link: created };
}

export type DeleteSalonLinkResult = { success: true } | { success: false; error: string };

/** 外部リンクを1件削除する（RLSのdelete_ownにより本人の行のみ削除可能）。 */
export async function deleteSalonLinkAction(linkId: string): Promise<DeleteSalonLinkResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "セッションが切れています。再度ログインしてください。" };
  }

  const { error } = await supabase
    .from("salon_links")
    .delete()
    .eq("id", linkId)
    .eq("salon_user_id", user.id);

  if (error) {
    console.error("[deleteSalonLinkAction] delete failed", error);
    return { success: false, error: "リンクの削除に失敗しました。もう一度お試しください。" };
  }

  return { success: true };
}
