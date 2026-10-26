/**
 * 月額請求書のStorage保存先。
 *
 * ★0050以降、DBの storage_path ＝ Supabase Storage上の実際のobject key
 *   （'subscription-invoices/<組織ID>/<請求書番号>.pdf'。成功報酬の 'invoices/...' とは別の場所）。
 *   変換はしない。この関数は「想定した形か」を確認するだけで、返す値はDBの値そのもの。
 * ★0050未適用のDB（旧形式 'invoices/...'）では例外にして、誤った場所への保存・取得を防ぐ。
 */
const SUBSCRIPTION_PATH = /^subscription-invoices\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/BR-[0-9]{4}-[0-9]{6}\.pdf$/;

export function subscriptionStorageKey(dbStoragePath: string): string {
  if (!SUBSCRIPTION_PATH.test(dbStoragePath)) throw new Error("invalid subscription invoice storage path");
  return dbStoragePath;
}
