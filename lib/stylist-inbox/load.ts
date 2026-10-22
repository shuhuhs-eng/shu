import type { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type ScoutRow = Database["public"]["Tables"]["scouts"]["Row"];
type OfferRow = Database["public"]["Tables"]["salary_offers"]["Row"];

/**
 * 美容師側「届いたスカウト／届いた給与条件」の読み込みと店舗単位のグルーピング
 * （Phase 7）。
 *
 * ★本人宛のみ: stylist_user_id = 現在のユーザー で絞る（RLSでも本人宛しか
 * 返らない二重の保証。URLからIDを受け取らない）。
 *
 * ★店舗の特定は行自身のstore_idだけを正とする。salon_user_id・
 * onboarding assignment・organizationの先頭店舗などからは推測しない。
 * 同じ担当者が別々の店舗から送った場合も、店舗ごとに別カードになる。
 *
 * ★店舗名: 美容師はsalon_stores/salon_store_profilesを直接読めない（RLSは
 * 店舗スタッフのみ）。公開中の店舗はget_public_salon_stores()（0036）で
 * 名前・エリアを解決する。公開中でない店舗は名前を出せないため
 * 「店舗（現在は非公開）」と表示し、店舗詳細へのリンクも出さない。
 *
 * ★legacy行（store_idがnull）は旧表示互換のまま、salon_user_id基準で
 * salon_profilesの名前を表示し、店舗リンクは出さない。
 */
export type InboxSource = {
  /** グループのキー（店舗行は店舗ID、legacy行は送信サロンのID由来）。 */
  key: string;
  /** 公開中の店舗に紐づく場合のみ非null（「店舗を見る」リンク用）。 */
  storeId: string | null;
  sourceName: string;
  area: string | null;
};

export type ScoutGroup = InboxSource & { latest: ScoutRow; history: ScoutRow[] };
export type OfferGroup = InboxSource & { latest: OfferRow; history: OfferRow[] };

type PublicStoreInfo = { name: string; area: string | null };

async function loadPublicStoreMap(supabase: Supabase): Promise<Map<string, PublicStoreInfo>> {
  const map = new Map<string, PublicStoreInfo>();
  const { data, error } = await supabase.rpc("get_public_salon_stores");
  if (error) {
    console.error("[stylist-inbox] get_public_salon_stores failed", { message: error.message, code: error.code });
    return map;
  }
  for (const store of data ?? []) {
    map.set(store.store_id, {
      name: store.store_name,
      area: [store.prefecture, store.city].filter(Boolean).join(" ") || null,
    });
  }
  return map;
}

async function loadLegacySalonNames(supabase: Supabase, salonUserIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (salonUserIds.length === 0) return map;
  const { data } = await supabase.from("salon_profiles").select("user_id,salon_name").in("user_id", salonUserIds);
  for (const row of data ?? []) {
    if (row.salon_name) map.set(row.user_id, row.salon_name);
  }
  return map;
}

function resolveSource(
  row: { store_id: string | null; salon_user_id: string },
  stores: Map<string, PublicStoreInfo>,
  legacyNames: Map<string, string>,
): InboxSource {
  if (row.store_id) {
    const info = stores.get(row.store_id);
    return {
      key: `store:${row.store_id}`,
      storeId: info ? row.store_id : null,
      sourceName: info ? info.name : "店舗（現在は非公開）",
      area: info ? info.area : null,
    };
  }
  return {
    key: `legacy:${row.salon_user_id}`,
    storeId: null,
    sourceName: legacyNames.get(row.salon_user_id) ?? "サロン",
    area: null,
  };
}

function groupRows<T extends { store_id: string | null; salon_user_id: string }>(
  rows: T[],
  stores: Map<string, PublicStoreInfo>,
  legacyNames: Map<string, string>,
): { source: InboxSource; rows: T[] }[] {
  // rowsは新しい順。各グループで最初に現れる行が最新になる。
  const groups = new Map<string, { source: InboxSource; rows: T[] }>();
  for (const row of rows) {
    const source = resolveSource(row, stores, legacyNames);
    const existing = groups.get(source.key);
    if (existing) existing.rows.push(row);
    else groups.set(source.key, { source, rows: [row] });
  }
  return [...groups.values()];
}

export async function loadStylistScoutGroups(supabase: Supabase, stylistUserId: string): Promise<ScoutGroup[]> {
  // 最新判定の決定性: sent_at → created_at → id の降順（同時刻でも一意に決まる）。
  const { data } = await supabase
    .from("scouts")
    .select("*")
    .eq("stylist_user_id", stylistUserId)
    .order("sent_at", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  const scouts = data ?? [];
  const legacyIds = [...new Set(scouts.filter((s) => !s.store_id).map((s) => s.salon_user_id))];
  const [stores, legacyNames] = await Promise.all([
    loadPublicStoreMap(supabase),
    loadLegacySalonNames(supabase, legacyIds),
  ]);
  return groupRows(scouts, stores, legacyNames).map(({ source, rows }) => ({
    ...source,
    latest: rows[0],
    history: rows.slice(1),
  }));
}

export async function loadStylistOfferGroups(supabase: Supabase, stylistUserId: string): Promise<OfferGroup[]> {
  const { data } = await supabase
    .from("salary_offers")
    .select("*")
    .eq("stylist_user_id", stylistUserId)
    .order("created_at", { ascending: false });
  const offers = data ?? [];
  const legacyIds = [...new Set(offers.filter((o) => !o.store_id).map((o) => o.salon_user_id))];
  const [stores, legacyNames] = await Promise.all([
    loadPublicStoreMap(supabase),
    loadLegacySalonNames(supabase, legacyIds),
  ]);
  return groupRows(offers, stores, legacyNames).map(({ source, rows }) => ({
    ...source,
    latest: rows[0],
    history: rows.slice(1),
  }));
}
