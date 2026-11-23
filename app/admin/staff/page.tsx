import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdminOperator } from "@/lib/admin/operator-guard";
import { STAFF_MENU } from "@/lib/admin/staff-menu";

/** 運営スタッフのホーム（通常業務の入口）。データ取得はしない（各画面が自分で権限を確認する）。責任者は /admin へ。 */
export default async function StaffHomePage() {
  const { state } = await requireAdminOperator("/admin/staff");
  if (state === "responsible") redirect("/admin");
  return (
    <main className="mx-auto max-w-[900px] px-5 py-10">
      <h1 className="text-[20px] font-bold text-charcoal">運営（スタッフ）</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-charcoal">通常業務の画面です。請求・料金・契約・権限・個人情報の一覧などは責任者のみが扱います。</p>
      <ul className="mt-6 grid gap-3">
        {STAFF_MENU.map((m) => (
          <li key={m.href}>
            <Link href={m.href} className="block rounded-2xl border border-line bg-surface p-4 hover:bg-surface2">
              <span className="block text-[15px] font-semibold text-charcoal">{m.label}</span>
              <span className="mt-1 block text-[12px] text-charcoal">{m.lead}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
