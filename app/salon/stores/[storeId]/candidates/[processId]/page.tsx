import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { hasCompletedRole } from "@/lib/auth/user-roles";
import { getHiringProcessEvents, getStoreHiringProcesses } from "@/lib/hiring/actions";
import {
  HIRING_EVENT_LABELS,
  HIRING_REASON_LABELS,
  HIRING_SOURCE_LABELS,
  HIRING_STATUS_LABELS,
  INTERVIEW_TYPE_LABELS,
  asSafeHttpUrl,
  canScheduleInterview,
  formatJstDateTimeWithWeekday,
} from "@/lib/hiring/format";
import { canManageStoreHiringHint } from "@/lib/hiring/permissions";
import { formatJstDateTime } from "@/lib/store-activity/format";
import { StorePageShell } from "@/components/store-activity/store-page-shell";
import { HiringStatusBadge } from "@/components/hiring/status-badge";
import { InterviewForm } from "@/components/hiring/interview-form";
import { StatusPanel } from "@/components/hiring/status-panel";
import { InternalNoteForm } from "@/components/hiring/internal-note-form";

type Props = {
  params: Promise<{ storeId: string; processId: string }>;
};

/**
 * 採用進捗の詳細（/salon/stores/[storeId]/candidates/[processId]、Phase 8）。
 *
 * ★processIdはURLのparamsを使うが、表示するのは「このstoreIdの一覧
 * (get_store_hiring_processes)に含まれる行」だけ。別店舗のprocessIdを
 * 指定しても一覧に無いので404になる。履歴はget_hiring_process_events
 * （RPC側でも店舗アクセス権を検証）。社内メモ・理由は店舗側専用の画面で、
 * 美容師向け画面(/stylist/applications)には一切出さない。
 * 書き込み系ボタンは、viewer（閲覧のみ）には出さない（権限の本体はDB）。
 */
export default async function CandidateDetailPage({ params }: Props) {
  const { storeId, processId } = await params;
  if (!z.string().uuid().safeParse(processId).success) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=/salon/stores/${storeId}/candidates/${processId}`);
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

  const [processes, canManage] = await Promise.all([
    getStoreHiringProcesses(storeId),
    canManageStoreHiringHint(supabase, user.id, storeId, store.organization_id),
  ]);

  const p = processes?.find((row) => row.process_id === processId) ?? null;
  if (!p) notFound();

  const events = await getHiringProcessEvents(processId);
  const interviewUrl = p.interview_type === "online" ? asSafeHttpUrl(p.interview_location) : null;

  return (
    <StorePageShell storeId={storeId} storeName={store.store_name} eyebrow="採用進捗の詳細">
      <div className="mt-2 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl font-bold text-ink">{p.public_name ?? "美容師"}</h2>
          <p className="mt-1 text-[12px] text-sub">
            {[p.prefecture, p.current_position, p.experience_years != null ? `経験${p.experience_years}年` : null]
              .filter(Boolean)
              .join(" / ") || "プロフィール情報未設定"}
          </p>
        </div>
        <HiringStatusBadge status={p.status} />
      </div>

      <section className="mt-5 rounded-xl border border-line bg-surface p-4">
        <dl className="space-y-2 text-[12.5px] text-charcoal">
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-sub">相性</dt>
            <dd>
              {p.match.available && p.match.overall_score != null ? `${p.match.overall_score}%` : "相性診断準備中"}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-sub">起点</dt>
            <dd>{HIRING_SOURCE_LABELS[p.source] ?? p.source}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-sub">追加日</dt>
            <dd>{formatJstDateTime(p.created_at)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-sub">最終更新</dt>
            <dd>{formatJstDateTime(p.updated_at)}</dd>
          </div>
          {p.hired_at && (
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-sub">採用確定</dt>
              <dd className="font-semibold">{formatJstDateTime(p.hired_at)}</dd>
            </div>
          )}
          {p.status === "declined" && (
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-sub">辞退の起点</dt>
              <dd>{p.declined_by === "stylist" ? "美容師からの辞退" : "店舗側で辞退として記録"}</dd>
            </div>
          )}
          {(p.status === "declined" || p.status === "rejected") && (p.reason_code || p.reason_note) && (
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-sub">理由（社内）</dt>
              <dd>
                {p.reason_code && <span>{HIRING_REASON_LABELS[p.reason_code] ?? p.reason_code}</span>}
                {p.reason_note && <span className="block whitespace-pre-line text-sub">{p.reason_note}</span>}
              </dd>
            </div>
          )}
        </dl>
      </section>

      <section className="mt-4 rounded-xl border border-line bg-surface p-4">
        <p className="eyebrow mb-2">面談</p>
        {p.interview_at ? (
          <dl className="space-y-1 text-[12.5px] text-charcoal">
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-sub">日時</dt>
              <dd className="font-semibold">{formatJstDateTimeWithWeekday(p.interview_at)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-sub">形式</dt>
              <dd>{p.interview_type ? INTERVIEW_TYPE_LABELS[p.interview_type] ?? p.interview_type : "未設定"}</dd>
            </div>
            {p.interview_location && (
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-sub">場所/URL</dt>
                <dd className="break-all">
                  {interviewUrl ? (
                    <a href={interviewUrl} target="_blank" rel="noopener noreferrer" className="underline">
                      {p.interview_location}
                    </a>
                  ) : (
                    p.interview_location
                  )}
                </dd>
              </div>
            )}
          </dl>
        ) : (
          <p className="text-[12.5px] text-sub">面談はまだ設定されていません。</p>
        )}
        {canManage && canScheduleInterview(p.status) && (
          <div className="mt-3">
            <InterviewForm
              storeId={storeId}
              processId={processId}
              current={{
                interviewAt: p.interview_at,
                interviewType: p.interview_type,
                location: p.interview_location,
                candidateMessage: p.candidate_message,
              }}
            />
          </div>
        )}
      </section>

      <section className="mt-4 rounded-xl border border-line bg-surface p-4">
        <p className="eyebrow mb-2">店舗からの案内（美容師に表示）</p>
        <p className="whitespace-pre-line text-[12.5px] leading-relaxed text-charcoal">
          {p.candidate_message ?? "案内はまだありません"}
        </p>
      </section>

      <section className="mt-4 rounded-xl border border-line bg-surface p-4">
        <p className="eyebrow mb-1">社内メモ</p>
        <p className="mb-2 text-[10.5px] text-sub">美容師には表示されません。</p>
        <InternalNoteForm storeId={storeId} processId={processId} initialNote={p.internal_note} canManage={canManage} />
      </section>

      {canManage ? (
        <div className="mt-4">
          <StatusPanel storeId={storeId} processId={processId} currentStatus={p.status} />
        </div>
      ) : (
        <p className="mt-4 rounded-lg bg-surface2 px-3 py-2 text-[11px] leading-relaxed text-sub">
          この店舗では閲覧のみの権限です。面談の設定やステータスの変更はできません。
        </p>
      )}

      <section className="mt-6">
        <p className="eyebrow mb-3">履歴</p>
        {events === null ? (
          <p className="text-[12px] text-sub">履歴を取得できませんでした。</p>
        ) : events.length === 0 ? (
          <p className="text-[12px] text-sub">履歴はまだありません。</p>
        ) : (
          <ol className="space-y-2">
            {[...events].reverse().map((e) => (
              <li key={e.id} className="rounded-lg border border-line bg-surface p-3 text-[12px] text-charcoal">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-ink">
                    {e.event_type === "declined" && e.actor_kind === "stylist"
                      ? "美容師が辞退"
                      : HIRING_EVENT_LABELS[e.event_type] ?? e.event_type}
                    {e.from_status && e.to_status && e.from_status !== e.to_status && (
                      <span className="ml-2 font-normal text-sub">
                        {HIRING_STATUS_LABELS[e.from_status] ?? e.from_status} → {HIRING_STATUS_LABELS[e.to_status] ?? e.to_status}
                      </span>
                    )}
                  </p>
                  <span className="shrink-0 text-[10.5px] text-sub">{formatJstDateTime(e.created_at)}</span>
                </div>
                <p className="mt-0.5 text-[10.5px] text-sub">
                  {e.actor_kind === "stylist" ? "美容師" : e.is_me ? "あなた" : "店舗の担当者"}
                </p>
                {e.interview_at && (
                  <p className="mt-1 text-sub">面談日時: {formatJstDateTimeWithWeekday(e.interview_at)}</p>
                )}
                {e.public_note && (
                  <p className="mt-1 whitespace-pre-line">案内: {e.public_note}</p>
                )}
                {e.reason_code && (
                  <p className="mt-1 text-sub">理由（社内）: {HIRING_REASON_LABELS[e.reason_code] ?? e.reason_code}</p>
                )}
                {e.internal_note && (
                  <p className="mt-1 whitespace-pre-line rounded bg-surface2 px-2 py-1 text-sub">社内メモ: {e.internal_note}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </StorePageShell>
  );
}
