import { LegalLinks } from "@/components/legal/legal-links";

// 管理者専用ログイン入口。見た目は他のログイン入口（(auth)/サロン/美容師）と同じ。
export default function AdminLoginLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-[440px] flex-col justify-center px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5">
        <span className="eyebrow">Beauty Reach Admin</span>
        <hr className="h-px flex-1 border-0 bg-line" />
      </div>
      <div className="rounded-2xl border border-line bg-surface p-6">{children}</div>
      <LegalLinks className="mt-5" />
    </main>
  );
}
