import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";
import { PRIVACY } from "@/lib/legal/documents";

export const metadata: Metadata = { title: "プライバシーポリシー | Beauty Reach" };

/** プライバシーポリシー（公開ページ。ログイン不要）。 */
export default function PrivacyPage() {
  return <LegalPage doc={PRIVACY} other={{ href: "/terms", label: "利用規約を見る" }} />;
}
