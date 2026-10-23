import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getBillingIntegrityIssues } from "@/lib/billing/actions";
import { countSeverities, issueTypeLabel, severityLabel } from "@/lib/billing/integrity";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric" });
}

/**
 * 採用と成功報酬の整合性チェック（/admin/integrity、Phase 15）。完全read-only。
 * ★運営者(is_platform_admin)のみ。自動修復・再生成・状態/金額の変更は行わない。
 * ★取得に失敗した場合は「0件」と表示せず、取得できなかったことを表示する。
 */
export default async function AdminIntegrityPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/integrity");
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (!isAdmin) redirect("/mypage");

  const issues = await getBillingIntegrityIssues();
  const counts = issues ? countSeverities(issues) : null;

  return (
    <main className="mx-auto max-w-[760px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5"><span className="eyebrow">Beauty Reach Admin</span><hr className="h-px flex-1 border-0 bg-line" /></div>
      <Link href="/admin" className="text-[13px] font-semibold text-sub underline">← 運営ダッシュボード</Link>
      <h1 className="mt-4 font-serif text-2xl font-bold text-ink">整合性チェック</h1>
      <p className="mt-2 text-[12.5px] leading-relaxed text-sub">
        採用の成立と成功報酬の記録を突き合わせた結果です。この画面は確認専用で、データの修正や再作成は行いません。
      </p>

      {issues === null || counts === null ? (
        <p className="mt-6 rounded-lg bg-[#C24545]/10 px-3 py-2 text-[12px] text-[#8A2E2E]">チェック結果を取得できませんでした。時間をおいて再度お試しください。</p>
      ) : (
        <>
          <section className="mt-6 grid grid-cols-3 gap-3">
            {[
              { label: "異常の件数", value: counts.total },
              { label: "要対応", value: counts.critical },
              { label: "要確認", value: counts.warning },
            ].map((c) => (
              <div key={c.label} className="rounded-2xl border border-line bg-surface p-4">
                <p className="text-[11px] text-sub">{c.label}</p>
                <p className="mt-1 font-serif text-[26px] font-bold text-ink">{c.value}</p>
              </div>
            ))}
          </section>

          {issues.length === 0 ? (
            <p className="mt-8 rounded-2xl border border-line bg-surface p-8 text-center text-[13px] text-charcoal">問題は検出されていません</p>
          ) : (
            <div className="mt-8 space-y-3">
              {issues.map((i, idx) => (
                <article key={`${i.hiring_process_id}-${i.issue_type}-${idx}`} className="rounded-2xl border border-line bg-surface p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] text-sub">{i.store_name ?? "店舗"} ／ 採用成立日 {fmtDate(i.hired_at)}</p>
                      <h2 className="mt-1 font-serif text-[16px] font-bold text-ink">{issueTypeLabel(i.issue_type)}</h2>
                    </div>
                    <span className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-bold ${i.severity === "critical" ? "bg-[#C24545]/10 text-[#8A2E2E]" : "bg-surface2 text-sub"}`}>
                      {severityLabel(i.severity)}
                    </span>
                  </div>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-charcoal">{i.message}</p>
                  <p className="mt-2 text-[11px] text-sub">美容師：{i.stylist_name ?? "—"}</p>
                  <div className="mt-3 text-[12px]">
                    <Link href="/admin/success-fees" className="font-semibold underline">成功報酬の管理を開く</Link>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}
