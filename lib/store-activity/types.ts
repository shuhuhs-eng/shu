import type { Database } from "@/types/database";

/**
 * 店舗単位の公開閲覧・活動履歴（0036）まわりの型定義。
 *
 * ★RPCの生の戻り値型（types/database.ts の Functions[...]["Returns"]）を
 * 正として、そこから型を導出する。フィールド名・型を手で複製していない。
 */
type Functions = Database["public"]["Functions"];

/** 美容師向け: 公開中の店舗一覧の1行（get_public_salon_stores）。 */
export type PublicSalonStore = Functions["get_public_salon_stores"]["Returns"][number];

/** 美容師向け: 公開中の店舗の詳細（get_public_salon_store_detail）。 */
export type PublicSalonStoreDetail = Functions["get_public_salon_store_detail"]["Returns"];

/** 店舗側: 「話を聞いてみたい」を送った美容師の1行（get_store_received_interests）。 */
export type StoreReceivedInterest = Functions["get_store_received_interests"]["Returns"][number];

/** 店舗側: スカウト履歴の1行（get_store_scouts）。 */
export type StoreScout = Functions["get_store_scouts"]["Returns"][number];

/** 店舗側: 給与オファー履歴の1行（get_store_salary_offers）。 */
export type StoreSalaryOffer = Functions["get_store_salary_offers"]["Returns"][number];

/** 店舗側: 今月のスカウト残数（get_store_scout_quota）。 */
export type StoreScoutQuota = Functions["get_store_scout_quota"]["Returns"];
