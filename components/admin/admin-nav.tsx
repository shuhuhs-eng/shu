import Link from "next/link";

const ITEMS = [
  { href: "/admin", label: "運営トップ" },
  { href: "/admin/salons", label: "会社・店舗" },
  { href: "/admin/stylists", label: "美容師" },
  { href: "/admin/companies", label: "会社（採用・請求）" },
  { href: "/admin/contracts", label: "契約" },
  { href: "/admin/success-fees", label: "成功報酬・請求" },
  { href: "/admin/stripe", label: "カード決済" },
  { href: "/admin/issuer-settings", label: "請求書の発行事業者" },
  { href: "/admin/integrity", label: "整合性チェック" },
  { href: "/admin/evidence", label: "実績資料" },
  { href: "/admin/legal", label: "規約・同意" },
] as const;

/** 運営画面の共通ナビ（運営者だけに表示。layoutで権限を確認している）。 */
export function AdminNav() {
  return (
    <nav className="border-b border-line bg-surface" aria-label="運営メニュー">
      <ul className="mx-auto flex max-w-[900px] gap-1 overflow-x-auto px-5 py-2 text-[12px] font-semibold">
        {ITEMS.map((i) => (
          <li key={i.href} className="shrink-0">
            <Link href={i.href} className="inline-flex min-h-[44px] items-center rounded-full px-3 text-charcoal hover:bg-surface2">{i.label}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
