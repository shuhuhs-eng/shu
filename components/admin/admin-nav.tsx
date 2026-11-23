import Link from "next/link";
import { STAFF_MENU } from "@/lib/admin/staff-menu";

const ITEMS = [
  // 一般向けサイトのホーム（エラー画面の「管理画面へ戻る」→/admin とは行き先を分けている）。スマホでも先頭で見えるよう最初に置く。
  { href: "/", label: "HOME" },
  { href: "/admin", label: "運営TOP" },
  { href: "/admin/salons", label: "会社・店舗" },
  { href: "/admin/stylists", label: "美容師" },
  { href: "/admin/messages", label: "連絡" },
  { href: "/admin/interviews", label: "面接・進捗" },
  { href: "/admin/visit-requests", label: "見学・体験入店" },
  { href: "/admin/interests", label: "直接希望（見学・体験入店）" },
  { href: "/admin/email-outbox", label: "通知メール" },
  { href: "/admin/culture-readiness", label: "診断の状況" },
  { href: "/admin/companies", label: "会社（採用・請求）" },
  { href: "/admin/contracts", label: "契約" },
  { href: "/admin/success-fees", label: "成功報酬・請求" },
  { href: "/admin/stripe", label: "カード決済" },
  { href: "/admin/issuer-settings", label: "請求書の発行事業者" },
  { href: "/admin/integrity", label: "整合性チェック" },
  { href: "/admin/evidence", label: "実績資料" },
  { href: "/admin/legal", label: "規約・同意" },
  { href: "/admin/staff-members", label: "スタッフ管理" },
] as const;

const STAFF_ITEMS = [{ href: "/", label: "HOME" }, { href: "/admin/staff", label: "運営TOP" }, ...STAFF_MENU.map((m) => ({ href: m.href, label: m.label }))] as const;

/** 運営画面の共通ナビ（運営者だけに表示。layoutで権限を確認している）。スタッフには通常業務の画面だけを出す（権限の本体はDB）。 */
export function AdminNav({ variant = "responsible" }: { variant?: "responsible" | "staff" }) {
  const items = variant === "staff" ? STAFF_ITEMS : ITEMS;
  return (
    <nav className="border-b border-line bg-surface" aria-label="運営メニュー">
      <ul className="mx-auto flex max-w-[900px] gap-1 overflow-x-auto px-5 py-2 text-[12px] font-semibold">
        {items.map((i) => (
          <li key={i.href} className="shrink-0">
            <Link href={i.href} className="inline-flex min-h-[44px] items-center rounded-full px-3 text-charcoal hover:bg-surface2">{i.label}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
