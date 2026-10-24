import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";
import { TERMS } from "@/lib/legal/documents";

export const metadata: Metadata = { title: "利用規約 | Beauty Reach" };

/** 利用規約（公開ページ。ログイン不要）。 */
export default function TermsPage() {
  return <LegalPage doc={TERMS} other={{ href: "/privacy", label: "プライバシーポリシーを見る" }} />;
}
