"use client";

import { useState } from "react";
import { RegionAttribution } from "@/components/area/region-attribution";
import { filterRegions, regionLabel, toggleRegion, type RegionRow } from "@/lib/area/regions";

type Props = { rows: RegionRow[]; selected: string[]; max: number; onChange: (next: string[]) => void; onError?: (message: string | null) => void; disabled?: boolean };

/** 地域の選択（都道府県→市区町村→区）。重なる地域(親子)は同時に選べない。上限・重なりの最終判定はDB。 */
export function RegionPicker({ rows, selected, max, onChange, onError, disabled = false }: Props) {
  const [query, setQuery] = useState("");
  const found = query.trim() ? filterRegions(rows, query) : null;
  const prefs = rows.filter((r) => r.level === "pref");
  const children = (code: string) => rows.filter((r) => r.parent_code === code);
  const toggle = (code: string) => {
    const r = toggleRegion(selected, code, rows, max);
    if (r.error) { onError?.(`選べる地域は${max}件までです。`); return; }
    onError?.(null); onChange(r.next);
  };
  const Box = ({ r, indent }: { r: RegionRow; indent: number }) => (
    <label className="flex items-center gap-2 py-1 text-[13px] text-charcoal" style={{ paddingLeft: indent * 16 }}>
      <input type="checkbox" checked={selected.includes(r.code)} disabled={disabled} onChange={() => toggle(r.code)} />
      <span>{r.name}{r.has_wards ? "（区を選べます）" : ""}</span>
    </label>
  );
  return (
    <div>
      {selected.length > 0 && (
        <p className="mb-3 text-[12.5px] text-charcoal" aria-live="polite">選択中（{selected.length}/{max}）: {selected.map((c) => regionLabel(c, rows)).join("、")}</p>
      )}
      <label className="mb-2 block text-[12.5px] font-semibold text-ink" htmlFor="region-search">地域名で探す</label>
      <input id="region-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="例: 横浜、梼原" autoComplete="off"
        className="mb-3 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-[14px]" />
      <div className="max-h-[420px] overflow-y-auto rounded-lg border border-line bg-surface px-3 py-2">
        {found ? (
          found.length === 0 ? <p className="py-2 text-[12.5px] text-sub" role="status">該当する地域がありません。</p> : (
            <div role="group" aria-label="検索結果">
              {found.map((r) => (
                <label key={r.code} className="flex items-center gap-2 py-1 text-[13px] text-charcoal">
                  <input type="checkbox" checked={selected.includes(r.code)} disabled={disabled} onChange={() => toggle(r.code)} />
                  <span>{regionLabel(r.code, rows)}{r.has_wards ? "（区を選べます）" : ""}</span>
                </label>
              ))}
            </div>
          )
        ) : prefs.map((p) => (
          <details key={p.code} open={selected.some((c) => c === p.code || rows.find((r) => r.code === c)?.pref_code === p.code)}>
            <summary className="cursor-pointer py-1.5 text-[13.5px] font-semibold text-ink">{p.name}</summary>
            <div className="pb-2">
              <Box r={p} indent={0} />
              {children(p.code).map((c) => (
                <div key={c.code}>
                  <Box r={c} indent={1} />
                  {children(c.code).map((w) => <Box key={w.code} r={w} indent={2} />)}
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
      <RegionAttribution />
    </div>
  );
}
