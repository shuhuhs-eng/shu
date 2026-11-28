"use client";

import { useState } from "react";
import { RegionPicker } from "@/components/area/region-picker";
import type { RegionRow } from "@/lib/area/regions";

/** 「地域を指定」検索の条件入力。選んだ地域をクエリ文字列(codes)にして同じ画面を開き直す（GET）。 */
export function ManualRegionForm({ rows, initialCodes, basePath }: { rows: RegionRow[]; initialCodes: string[]; basePath: string }) {
  const [codes, setCodes] = useState<string[]>(initialCodes);
  const [error, setError] = useState<string | null>(null);
  return (
    <form method="get" action={basePath} className="mt-5">
      <input type="hidden" name="mode" value="manual" />
      <input type="hidden" name="codes" value={codes.join(",")} />
      <RegionPicker rows={rows} selected={codes} max={10} onChange={setCodes} onError={setError} />
      {error && <p role="alert" className="mt-2 text-[12.5px] text-red-700">{error}</p>}
      <button type="submit" disabled={codes.length === 0} className="mt-4 w-full rounded-full bg-ink px-5 py-3 text-[14px] font-semibold text-white disabled:opacity-50">この地域で探す</button>
    </form>
  );
}
