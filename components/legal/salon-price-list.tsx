import { salonPriceRows } from "@/lib/billing/price-list";

/** サロン向け料金表。 */
export function SalonPriceList() {
  const rows = salonPriceRows();
  return (
    <section aria-labelledby="salon-price-title" className="mx-auto max-w-[720px] px-5 pb-12">
      <h2 id="salon-price-title" className="text-[15px] font-semibold text-[#2A2A2A]">サロン向け料金表</h2>
      <dl className="mt-3 divide-y divide-[#E8E4DC] rounded-lg border border-[#E8E4DC]">
        {rows.map((r) => (
          <div key={r.label} className="px-3 py-2">
            <div className="flex justify-between gap-3 text-[13px]"><dt>{r.label}</dt><dd className="font-semibold">{r.price}</dd></div>
            {r.note ? <p className="mt-0.5 text-[11px] text-[#6B6B6B]">{r.note}</p> : null}
          </div>
        ))}
      </dl>
    </section>
  );
}
