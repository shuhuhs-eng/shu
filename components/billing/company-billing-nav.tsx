import Link from "next/link";

const ITEMS = [
  { href: "/salon/company/billing", label: "請求・成功報酬" },
  { href: "/salon/company/contract", label: "契約内容" },
  { href: "/salon/company/billing-profile", label: "請求先の設定" },
] as const;

/** 請求まわり3ページの行き来（company_owner / company_admin だけが入れるページにのみ置く）。 */
export function CompanyBillingNav({ current }: { current: (typeof ITEMS)[number]["href"] }) {
  return (
    <nav className="mt-4 flex flex-wrap gap-2" aria-label="請求・契約">
      {ITEMS.map((i) => (
        <Link key={i.href} href={i.href} aria-current={i.href === current ? "page" : undefined}
          className={`rounded-full border px-3.5 py-1.5 text-[12px] font-semibold ${i.href === current ? "border-ink bg-ink text-white" : "border-line bg-surface text-charcoal"}`}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
