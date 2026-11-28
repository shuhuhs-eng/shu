"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { areaSearchV2Enabled } from "@/lib/area/feature-flag";
import { enrichCandidates } from "@/lib/area/enrich";
import { confirmStoreRegion, fetchScoutCandidatesV2, fetchStoresForStylistV2, saveMyAreaPreference } from "@/lib/area/area-search";

const uuid = z.string().uuid();
const code = z.string().regex(/^[0-9]{2}([0-9]{3})?$/);
const mode = z.enum(["near", "all", "manual"]);
const OFF = { success: false as const, error: "この機能は現在ご利用いただけません。" };

/** 美容師: 希望勤務地の保存（全置換・リビジョン照合はDB）。 */
export async function saveAreaPreferenceAction(input: { mode: "unset" | "selected" | "nationwide"; codes: string[]; expectedRevision: number }):
  Promise<{ success: true; revision: number } | { success: false; error: string; conflict?: boolean }> {
  if (!areaSearchV2Enabled()) return OFF;
  const p = z.object({ mode: z.enum(["unset", "selected", "nationwide"]), codes: z.array(code).max(20), expectedRevision: z.number().int().min(0) }).safeParse(input);
  if (!p.success) return { success: false, error: "入力を確認してください。" };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "ログインしてください。" };
  const r = await saveMyAreaPreference(supabase, p.data);
  if (!r.ok) return { success: false, error: r.message, conflict: r.conflict };
  revalidatePath("/stylist/preference/area");
  return { success: true, revision: r.revision };
}

/** サロン: 候補の続きの取得（ページ送り）。条件(店舗・モード・地域)が変わったカーソルはDBが拒否する。 */
export async function loadMoreCandidatesAction(input: { storeId: string; mode: "near" | "all" | "manual"; regionCodes?: string[]; cursor: string }) {
  if (!areaSearchV2Enabled()) return OFF;
  const p = z.object({ storeId: uuid, mode, regionCodes: z.array(code).max(10).optional(), cursor: z.string().min(1).max(400) }).safeParse(input);
  if (!p.success) return { success: false as const, error: "入力を確認してください。" };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false as const, error: "ログインしてください。" };
  const r = await fetchScoutCandidatesV2(supabase, { storeId: p.data.storeId, mode: p.data.mode, regionCodes: p.data.regionCodes, cursor: p.data.cursor });
  if (!r.ok) return { success: false as const, error: r.message };
  const extra = await enrichCandidates(p.data.storeId, r.page.items as unknown as { stylist_user_id: string; avatar_path?: string | null }[]);
  return { success: true as const, items: r.page.items, nextCursor: r.page.next_cursor, ...extra };
}

/** 美容師: 店舗一覧の続きの取得。 */
export async function loadMoreStoresAction(input: { mode: "near" | "all" | "manual"; regionCodes?: string[]; cursor: string }) {
  if (!areaSearchV2Enabled()) return OFF;
  const p = z.object({ mode, regionCodes: z.array(code).max(10).optional(), cursor: z.string().min(1).max(600) }).safeParse(input);
  if (!p.success) return { success: false as const, error: "入力を確認してください。" };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false as const, error: "ログインしてください。" };
  const r = await fetchStoresForStylistV2(supabase, { mode: p.data.mode, regionCodes: p.data.regionCodes, cursor: p.data.cursor });
  return r.ok ? { success: true as const, items: r.page.items, nextCursor: r.page.next_cursor } : { success: false as const, error: r.message };
}

/** サロン: 店舗の所在地（市区・区）の確定。画面を開いた時点の住所の指紋とリビジョンを必ず送る。 */
export async function confirmStoreRegionAction(input: { storeId: string; cityCode: string; wardCode: string | null; expectedFingerprint: string; expectedRevision: number }) {
  if (!areaSearchV2Enabled()) return OFF;
  const p = z.object({ storeId: uuid, cityCode: code, wardCode: code.nullable(), expectedFingerprint: z.string().min(1).max(100), expectedRevision: z.number().int().min(0) }).safeParse(input);
  if (!p.success) return { success: false as const, error: "入力を確認してください。" };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false as const, error: "ログインしてください。" };
  const r = await confirmStoreRegion(supabase, { storeId: p.data.storeId, cityCode: p.data.cityCode, wardCode: p.data.wardCode, expectedFingerprint: p.data.expectedFingerprint, expectedRevision: p.data.expectedRevision });
  if (!r.ok) return { success: false as const, error: r.message };
  revalidatePath(`/salon/stores/${p.data.storeId}/stylists`); revalidatePath(`/salon/stores/${p.data.storeId}/region`);
  return { success: true as const };
}
