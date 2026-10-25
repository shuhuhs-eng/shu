"use client";

import { useState, useTransition } from "react";
import { upsertScoutCreditPackageAction } from "@/lib/stripe/admin-actions";
import { previewTax } from "@/lib/stripe/tax-preview";

/**
 * 追加スカウト枠の商品（件数・税抜価格・税率）。価格は事業判断のため、ここで明示的に設定して「有効」にするまで
 * 会社側からは購入できない（コード・migrationには価格を持たない）。
 * 税額・税込額の確定はDB。ここの表示は入力確認用のプレビュー。
 */
type Pkg = { package_id: string; label: string; credits_count: number; price_excl_tax: number; tax_rate: number; active: boolean };
export function ScoutPackageForm({ pkg }: { pkg?: Pkg }) {
  const [label, setLabel] = useState(pkg?.label ?? "");
  const [credits, setCredits] = useState(pkg ? String(pkg.credits_count) : "");
  const [price, setPrice] = useState(pkg ? String(pkg.price_excl_tax) : "");
  const [rate, setRate] = useState(pkg ? String(pkg.tax_rate) : "10");
  const [active, setActive] = useState(pkg?.active ?? false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const p = Number(price), r = Number(rate);
  const preview = Number.isInteger(p) && p > 0 && Number.isFinite(r) ? previewTax(p, r) : null;
  return (
    <form className="mt-2 grid gap-2 sm:grid-cols-[1fr_90px_120px_80px_auto_auto]" onSubmit={(e) => {
      e.preventDefault(); setMsg(null);
      const c = Number(credits);
      if (!Number.isInteger(c) || !Number.isInteger(p)) { setMsg({ ok: false, text: "件数と税抜価格は整数で入力してください。" }); return; }
      if (!Number.isFinite(r) || r < 0 || r > 100) { setMsg({ ok: false, text: "税率は0〜100で入力してください。" }); return; }
      start(async () => {
        const res = await upsertScoutCreditPackageAction({ packageId: pkg?.package_id ?? null, label, creditsCount: c, priceExclTax: p, taxRate: r, active });
        setMsg(res.success ? { ok: true, text: "保存しました。" } : { ok: false, text: res.error });
        if (res.success && !pkg) { setLabel(""); setCredits(""); setPrice(""); setRate("10"); setActive(false); }
      });
    }}>
      <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={100} required placeholder="名称" aria-label="名称" className="rounded-lg border border-line bg-white px-3 py-1.5 text-[12px]" />
      <input value={credits} onChange={(e) => setCredits(e.target.value)} inputMode="numeric" required placeholder="件数" aria-label="件数" className="rounded-lg border border-line bg-white px-3 py-1.5 text-[12px]" />
      <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="numeric" required placeholder="税抜価格（円）" aria-label="税抜価格（円）" className="rounded-lg border border-line bg-white px-3 py-1.5 text-[12px]" />
      <input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" required placeholder="税率%" aria-label="税率（%）" className="rounded-lg border border-line bg-white px-3 py-1.5 text-[12px]" />
      <label className="flex items-center gap-1.5 text-[12px] text-charcoal"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />購入を許可</label>
      <button type="submit" disabled={pending} className="rounded-full bg-ink px-4 py-1.5 text-[12px] font-bold text-white disabled:opacity-60">{pkg ? "更新" : "追加"}</button>
      {preview && <p className="text-[11.5px] text-sub sm:col-span-6">プレビュー: 税抜 {p.toLocaleString("ja-JP")}円 ＋ 消費税 {preview.tax.toLocaleString("ja-JP")}円 ＝ 税込 {preview.total.toLocaleString("ja-JP")}円（確定はDBが行います）</p>}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[11.5px] sm:col-span-6 ${msg.ok ? "text-[#285B45]" : "text-[#8A2E2E]"}`}>{msg.text}</p>}
    </form>
  );
}
