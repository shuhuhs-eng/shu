/**
 * 月額請求書のStorageオブジェクトキー。
 *
 * DB（0049）の storage_path は 'invoices/<組織ID>/<請求書番号>.pdf'（CHECK制約で固定・変更不可）。
 * 請求書番号は成功報酬と同じカウンタから払い出されるため衝突しないが、保存場所を明確に分けるため、
 * Storage上の実キーだけを 'subscription-invoices/<組織ID>/<請求書番号>.pdf' に変換する。
 * アップロードとダウンロードは必ずこの関数を通す（DBの論理パスをそのままStorageに使わない）。
 */
const DB_PATH = /^invoices\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(BR-[0-9]{4}-[0-9]{6})\.pdf$/;

export function subscriptionObjectKey(dbStoragePath: string): string {
  const m = DB_PATH.exec(dbStoragePath);
  if (!m) throw new Error("invalid subscription invoice storage path");
  return `subscription-invoices/${m[1]}/${m[2]}.pdf`;
}
