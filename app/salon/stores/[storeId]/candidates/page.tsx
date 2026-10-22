import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasCompletedRole } from "@/lib/auth/user-roles";
import { getStoreHiringProcesses } from "@/lib/hiring/actions";
import { HIRING_SOURCE_LABELS, formatJstDateTimeWithWeekday } from "@/lib/hiring/format";
import { formatJstDateTime } from "@/lib/store-activity/format";
import { StorePageShell } from "@/components/store-activity/store-page-shell";
import { HiringStatusBadge } from "@/components/hiring/status-badge";

type Props = {
  params: Promise<{ storeId: string }>;
};

/**
 * 店舗単位の採用進捗一覧（/salon/stores/[storeId]/candidates、Phase 8）。
 *
 * ★データはget_store_hiring_processes(storeId)のみ。アクセス権はlayout.tsxと
 * 同じくsalon_storesのRLS結果で判定し、RPCも is_store_accessible で再検証する
 * （viewerも閲覧可）。追加・変更はこの一覧では行わず、既存のInterest/Scout/Offer
 * 画面の「採用進捗に追加」と、詳細画面で行う。同じ美容師でも店舗ごとに別の行。
 */
export default async function StoreCandidatesPage({ params }: Props) {
  const { storeId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=/salon/stores/${storeId}/candidates`);
  }

  if (!(await hasCompletedRole(supabase, user.id, "salon"))) {
    redirect("/onboarding/salon");
  }

  const { data: store, error: storeError } = await supabase
    .from("salon_stores")
    .select("*")
    .eq("id", storeId)
    .maybeSingle();

  if (storeError || !store) {
    redirect("/salon/company");
  }

  const processes = await getStoreHiringProcesses(storeId);

  return (
    <StorePageShell
      storeId={storeId}
      storeName={store.store_name}
      eyebrow="採用進捗"
      description="この店舗で面談・選考を進めている美容師です。「話を聞きたい美容師」「スカウト履歴」「オファー履歴」の画面から追加できます。"
    >
      {processes === null ? (
        <p className="mt-8 text-center text-[13px] text-sub">一覧を取得できませんでした。時間をおいて再度お試しください。</p>
      ) : processes.length === 0 ? (
        <p className="mt-8 text-center text-[13px] text-sub">まだ採用進捗に追加された美容師はいません。</p>
      ) : (
        <div className="mt-8 space-y-3">
          {processes.map((p) => (
            <article key={p.process_id} className="rounded-xl border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-serif text-[16px] font-bold text-ink">{p.public_name ?? "美容師"}</h3>
                  <p className="mt-1 text-[12px] text-sub">
                    {[p.prefecture, p.current_position, p.experience_years != null ? `経験${p.experience_years}年` : null]
                      .filter(Boolean)
                      .join(" / ") || "プロフィール情報未設定"}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <HiringStatusBadge status={p.status} />
                  {p.match.available && p.match.overall_score != null && (
                    <span className="text-[11px] font-semibold" style={{ color: "#2E8B7F" }}>
                      相性 {p.match.overall_score}%
                    </span>
                  )}
                </div>
              </div>

              <dl className="mt-3 space-y-1 text-[12px] text-charcoal">
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-sub">起点</dt>
                  <dd>{HIRING_SOURCE_LABELS[p.source] ?? p.source}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-sub">次回面談</dt>
                  <dd>{p.interview_at ? formatJstDateTimeWithWeekday(p.interview_at) : "未定"}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-sub">最終更新</dt>
                  <dd>{formatJstDateTime(p.updated_at)}</dd>
                </div>
              </dl>

              <Link
                href={`/salon/stores/${storeId}/candidates/${p.process_id}`}
                className="mt-3 inline-block text-[12px] font-semibold text-ink underline"
              >
                詳細を見る ›
              </Link>
            </article>
          ))}
        </div>
      )}
    </StorePageShell>
  );
}
