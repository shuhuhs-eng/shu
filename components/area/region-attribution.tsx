/** 地域選択画面の下部に出す出典表示（e-Stat・国土数値情報の利用条件: 出典と加工の旨の表示）。文言は運営が指定。 */
export const ESTAT_AREACODE_URL = "https://www.e-stat.go.jp/municipalities/cities/areacode";
export const MLIT_N03_URL = "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2026.html";

export function RegionAttribution() {
  const link = "underline underline-offset-2";
  return (
    <p className="mt-4 text-[11.5px] leading-relaxed text-sub" data-region-attribution>
      出典：
      <a href={ESTAT_AREACODE_URL} target="_blank" rel="noopener noreferrer" className={link}>e-Stat『標準地域コード』</a>
      、国土交通省
      <a href={MLIT_N03_URL} target="_blank" rel="noopener noreferrer" className={link}>『国土数値情報 行政区域データ（2026年版）』</a>
      を基にBeauty Reachが加工。
    </p>
  );
}
