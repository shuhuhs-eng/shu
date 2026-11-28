/**
 * 地域検索 v2 の機能フラグ（サーバー側のみ・既定オフ）。
 * AREA_SEARCH_V2=1 のときだけ新しい画面・処理を有効にする。DB草案の適用（レビュー・承認後）より前に有効にしない。
 * NEXT_PUBLIC_ を付けない（ブラウザへ出さない）。
 */
export function areaSearchV2Enabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.AREA_SEARCH_V2 === "1";
}
