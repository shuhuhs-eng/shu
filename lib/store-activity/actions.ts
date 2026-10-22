"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type {
  PublicSalonStore,
  PublicSalonStoreDetail,
  StoreReceivedInterest,
  StoreSalaryOffer,
  StoreScout,
  StoreScoutQuota,
} from "@/lib/store-activity/types";

/**
 * 店舗単位の公開閲覧・活動履歴の読み取り（0036のSECURITY DEFINER RPCの薄い
 * ラッパー）。権限チェックはすべてRPC側（stylist role / salon role +
 * is_store_accessible）で行われる。ここでは判定ロジックを複製しない。
 *
 * ★storeIdは呼び出し元（URLのparams.storeId、またはRPC結果のstore_id）から
 * 明示的に渡された値のみを使う。auth.uid()・salon_user_id・organization等から
 * 推測しない。不正な形式のstoreIdはRPCを呼ぶ前に弾く（生のSQLエラーを避ける）。
 *
 * ★失敗時はnull（呼び出し側で「取得できませんでした」表示 or 404相当）。
 * 生のエラー内容はサーバーログにのみ出力し、ユーザー向けには返さない。
 */
const storeIdSchema = z.string().uuid();

export async function getPublicSalonStores(): Promise<PublicSalonStore[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_public_salon_stores");
  if (error || !data) {
    console.error("[getPublicSalonStores] RPC failed", { message: error?.message, code: error?.code });
    return null;
  }
  return data;
}

export async function getPublicSalonStoreDetail(storeId: string): Promise<PublicSalonStoreDetail | null> {
  const parsed = storeIdSchema.safeParse(storeId);
  if (!parsed.success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_public_salon_store_detail", { p_store_id: parsed.data });
  if (error || !data || !data.available) {
    // PUBLICでない店舗はRPCが例外を返す。呼び出し側では404相当として扱う。
    console.error("[getPublicSalonStoreDetail] RPC failed", { message: error?.message, code: error?.code, storeId });
    return null;
  }
  return data;
}

export async function getStoreReceivedInterests(storeId: string): Promise<StoreReceivedInterest[] | null> {
  const parsed = storeIdSchema.safeParse(storeId);
  if (!parsed.success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_store_received_interests", { p_store_id: parsed.data });
  if (error || !data) {
    console.error("[getStoreReceivedInterests] RPC failed", { message: error?.message, code: error?.code, storeId });
    return null;
  }
  return data;
}

export async function getStoreScouts(storeId: string): Promise<StoreScout[] | null> {
  const parsed = storeIdSchema.safeParse(storeId);
  if (!parsed.success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_store_scouts", { p_store_id: parsed.data });
  if (error || !data) {
    console.error("[getStoreScouts] RPC failed", { message: error?.message, code: error?.code, storeId });
    return null;
  }
  return data;
}

export async function getStoreSalaryOffers(storeId: string): Promise<StoreSalaryOffer[] | null> {
  const parsed = storeIdSchema.safeParse(storeId);
  if (!parsed.success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_store_salary_offers", { p_store_id: parsed.data });
  if (error || !data) {
    console.error("[getStoreSalaryOffers] RPC failed", { message: error?.message, code: error?.code, storeId });
    return null;
  }
  return data;
}

export async function getStoreScoutQuota(storeId: string): Promise<StoreScoutQuota | null> {
  const parsed = storeIdSchema.safeParse(storeId);
  if (!parsed.success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_store_scout_quota", { p_store_id: parsed.data });
  if (error || !data) {
    console.error("[getStoreScoutQuota] RPC failed", { message: error?.message, code: error?.code, storeId });
    return null;
  }
  return data;
}

/**
 * 店舗側の履歴画面で美容師名を表示するための名前表。
 *
 * get_store_scouts / get_store_salary_offers は美容師のIDしか返さないため、
 * ・この店舗に「話を聞いてみたい」を送った美容師（get_store_received_interests）
 * ・スカウト対象として公開中の美容師（get_public_stylists_for_scout）
 * の公開名を合わせて名前表にする。どちらにも居ない美容師（公開を停止した等）は
 * 呼び出し側で「美容師」と表示する。いずれも既存RPCで、新しいDBアクセスは無い。
 */
export async function getStoreStylistNameMap(storeId: string): Promise<Record<string, string>> {
  const parsed = storeIdSchema.safeParse(storeId);
  if (!parsed.success) return {};
  const supabase = await createClient();
  const [interestsResult, publicResult] = await Promise.all([
    supabase.rpc("get_store_received_interests", { p_store_id: parsed.data }),
    supabase.rpc("get_public_stylists_for_scout"),
  ]);

  const names: Record<string, string> = {};
  for (const row of publicResult.data ?? []) {
    if (row.public_name) names[row.stylist_user_id] = row.public_name;
  }
  for (const row of interestsResult.data ?? []) {
    if (row.public_name) names[row.stylist_user_id] = row.public_name;
  }
  return names;
}
