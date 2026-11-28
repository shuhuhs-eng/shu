import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";
import { getLegalView } from "@/lib/legal/view";
import { SalonPriceList } from "@/components/legal/salon-price-list";
import { scoutLedgerEnabled } from "@/lib/billing/hire-flags";
import { publicPageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = publicPageMetadata({ title: "利用規約 | Beauty Reach", description: "Beauty Reachの利用規約。", path: "/terms" });
export const dynamic = "force-dynamic";

/** 利用規約（公開ページ。ログイン不要）。公開済みの版はDBに保存した本文を表示する。 */
export default async function TermsPage() {
  const view = await getLegalView("terms");
  if (view === null) {
    return (
      <main className="mx-auto max-w-[720px] px-5 py-12">
        <p className="rounded-lg bg-[#C24545]/10 px-3 py-2 text-[12px] text-[#8A2E2E]">現在、内容を表示できません。少し時間をおいて再度お試しください。</p>
      </main>
    );
  }
  return (
    <>
      <LegalPage view={view} other={{ href: "/privacy", label: "プライバシーポリシーを見る" }} />
      {scoutLedgerEnabled() ? <SalonPriceList /> : null}
    </>
  );
}
