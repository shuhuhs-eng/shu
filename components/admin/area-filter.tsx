import { PREFECTURES } from "@/lib/validation/profile-options";
import { REGION_BLOCKS } from "@/lib/admin/regions";

/** 地域ブロック＋都道府県（47）＋未設定の絞り込み入力（GETフォームの一部）。 */
export function AreaFilterFields({ label, prefKey = "pref", regionKey = "region", region, prefecture, allowUnset = true }: {
  label: string; prefKey?: string; regionKey?: string; region: string; prefecture: string; allowUnset?: boolean;
}) {
  const sel = "min-h-[44px] w-full rounded-xl border border-line bg-surface px-3 text-[13px]";
  return (
    <fieldset className="grid grid-cols-2 gap-2">
      <legend className="mb-1 text-[11.5px] font-semibold text-sub">{label}</legend>
      <select name={regionKey} defaultValue={region} className={sel} aria-label={`${label}の地域ブロック`}>
        <option value="">全地域</option>
        {REGION_BLOCKS.map((b) => <option key={b} value={b}>{b}</option>)}
      </select>
      <select name={prefKey} defaultValue={prefecture} className={sel} aria-label={`${label}の都道府県`}>
        <option value="">全都道府県</option>
        {allowUnset && <option value="unset">未設定</option>}
        {PREFECTURES.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
    </fieldset>
  );
}
