"use client";

import { useMemo, useState, useTransition } from "react";
import { RegionAttribution } from "@/components/area/region-attribution";
import { confirmStoreRegionAction } from "@/lib/area/actions";
import { matchesRegionQuery, type RegionRow } from "@/lib/area/regions";

type Props = { storeId: string; rows: RegionRow[]; initialCity: string | null; initialWard: string | null; fingerprint: string; revision: number };

/** サロン: 店舗の所在地（市区・区）の確定。画面を開いた時点の住所の指紋とリビジョンを送り、別の更新と重なれば拒否される。 */
export function StoreRegionForm({ storeId, rows, initialCity, initialWard, fingerprint, revision: rev0 }: Props) {
  const cities = useMemo(() => rows.filter((r) => r.level === "city").sort((a, b) => a.code.localeCompare(b.code)), [rows]);
  const [city, setCity] = useState(initialCity ?? "");
  const [cityQuery, setCityQuery] = useState("");
  const [ward, setWard] = useState(initialWard ?? "");
  const [revision, setRevision] = useState(rev0);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const shownCities = useMemo(() => (cityQuery.trim() ? cities.filter((c) => c.code === city || matchesRegionQuery(c, cityQuery)) : cities), [cities, cityQuery, city]);
  const cityRow = cities.find((c) => c.code === city);
  const wards = useMemo(() => (cityRow?.has_wards ? rows.filter((r) => r.level === "ward" && r.parent_code === cityRow.code).sort((a, b) => a.code.localeCompare(b.code)) : []), [rows, cityRow]);
  const needsWard = !!cityRow?.has_wards;
  const canSubmit = !pending && !!city && (!needsWard || !!ward);

  function submit() {
    setMsg(null);
    start(async () => {
      const r = await confirmStoreRegionAction({ storeId, cityCode: city, wardCode: needsWard ? ward : null, expectedFingerprint: fingerprint, expectedRevision: revision });
      if (r.success) { setRevision((n) => n + 1); setMsg({ kind: "ok", text: "所在地を確定しました。" }); } else setMsg({ kind: "error", text: r.error });
    });
  }
  return (
    <div>
      <label className="block text-[13px] font-semibold text-ink" htmlFor="region-city">市区町村</label>
      <input type="search" value={cityQuery} onChange={(e) => setCityQuery(e.target.value)} aria-label="市区町村名で絞り込む" placeholder="市区町村名で絞り込む（例: 梼原）" autoComplete="off" className="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-[14px]" />
      <select id="region-city" value={city} disabled={pending} onChange={(e) => { setCity(e.target.value); setWard(""); }} className="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-[14px]">
        <option value="">選択してください</option>
        {shownCities.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
      </select>
      {needsWard && (
        <>
          <label className="mt-4 block text-[13px] font-semibold text-ink" htmlFor="region-ward">区（政令指定都市は区まで選択）</label>
          <select id="region-ward" value={ward} disabled={pending} onChange={(e) => setWard(e.target.value)} className="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-[14px]">
            <option value="">選択してください</option>
            {wards.map((w) => <option key={w.code} value={w.code}>{w.name}</option>)}
          </select>
        </>
      )}
      <button type="button" onClick={submit} disabled={!canSubmit} className="mt-6 w-full rounded-full bg-ink px-5 py-3 text-[14px] font-semibold text-white disabled:opacity-50">{pending ? "確定中…" : "この所在地で確定する"}</button>
      {msg && <p role={msg.kind === "error" ? "alert" : "status"} className={`mt-3 text-[13px] leading-relaxed ${msg.kind === "error" ? "text-red-700" : "text-charcoal"}`}>{msg.text}{msg.kind === "error" && <> <button type="button" className="underline" onClick={() => window.location.reload()}>最新の内容を読み込み直す</button></>}</p>}
      <RegionAttribution />
    </div>
  );
}
