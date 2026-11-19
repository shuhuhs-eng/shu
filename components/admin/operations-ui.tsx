import Link from "next/link";
import { OPS_PAGE_SIZE, type OpsFailure, type Period } from "@/lib/admin/operations";

/** 取得に失敗したときの表示。「0件」とは違うことを明記する（RPCが未適用のときは別の文言）。 */
export function OpsError({ reason }: { reason: OpsFailure }) {
  const msg =
    reason === "forbidden"
      ? "この情報を見る権限がありません。"
      : reason === "unavailable"
        ? "取得できませんでした。この一覧に必要なデータベースの機能がまだ使えない状態です。（0件という意味ではありません）"
        : "取得できませんでした。時間をおいて再度お試しください。（0件という意味ではありません）";
  return (
    <p role="alert" className="mt-6 rounded-lg bg-[#C24545]/10 px-3 py-2 text-[12px] text-[#8A2E2E]">
      {msg}
    </p>
  );
}

export function OpsEmpty({ children }: { children: React.ReactNode }) {
  return <p className="mt-8 rounded-2xl border border-line bg-surface p-8 text-center text-[13px] text-sub">{children}</p>;
}

export function OpsPager({ total, page, basePath, params }: { total: number; page: number; basePath: string; params: Record<string, string> }) {
  const pages = Math.max(1, Math.ceil(total / OPS_PAGE_SIZE));
  const href = (p: number) => `${basePath}?${new URLSearchParams({ ...params, page: String(p) }).toString()}`;
  return (
    <nav className="mt-6 flex items-center justify-between text-[12.5px]" aria-label="ページ送り">
      {page > 1 ? <Link href={href(page - 1)} className="inline-flex min-h-[44px] items-center rounded-full border border-line px-4 font-semibold">前へ</Link> : <span />}
      <span className="text-sub">{total}件中 {page} / {pages} ページ</span>
      {page < pages ? <Link href={href(page + 1)} className="inline-flex min-h-[44px] items-center rounded-full border border-line px-4 font-semibold">次へ</Link> : <span />}
    </nav>
  );
}

/** 期間の入力欄（日本時間の日付。開始日・終了日を含む）。 */
export function PeriodFields({ period, label }: { period: Period; label: string }) {
  const cls = "min-h-[44px] w-full rounded-xl border border-line bg-surface px-3 text-[13px]";
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-[11.5px] font-semibold text-charcoal">{label}（日本時間・開始日と終了日を含む）</legend>
      <div className="grid grid-cols-2 gap-2">
        <input type="date" name="from" defaultValue={period.fromDate} className={cls} aria-label="開始日" />
        <input type="date" name="to" defaultValue={period.toDate} className={cls} aria-label="終了日" />
      </div>
      {period.invalid && <p role="alert" className="text-[12px] text-[#8A2E2E]">開始日が終了日より後です。日付を見直してください。</p>}
    </fieldset>
  );
}

export function PageHead({ title, lead }: { title: string; lead: React.ReactNode }) {
  return (
    <>
      <div className="mb-6 flex items-center gap-2.5"><span className="eyebrow">Beauty Reach Admin</span><hr className="h-px flex-1 border-0 bg-line" /></div>
      <h1 className="font-serif text-2xl font-bold text-ink">{title}</h1>
      <p className="mt-2 text-[12.5px] leading-relaxed text-sub">{lead}</p>
    </>
  );
}

/** 日時の表示（日本時間）。 */
export function fmtJst(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

export function stylistLabel(r: { stylist_public_name: string | null; stylist_full_name: string | null }): string {
  return r.stylist_public_name || r.stylist_full_name || "（名前未設定）";
}

/** 既存の連絡機能（/admin/messages/new）へのリンク。ここでは送信しない。 */
export function contactStylistHref(userId: string) {
  return `/admin/messages/new?${new URLSearchParams({ audience: "stylist", recipient: userId }).toString()}`;
}
export function contactSalonHref(organizationId: string, storeId: string) {
  return `/admin/messages/new?${new URLSearchParams({ audience: "salon", org: organizationId, store: storeId }).toString()}`;
}

export const linkCls = "inline-flex min-h-[44px] items-center rounded-full border border-line px-3 text-[12px] font-semibold text-charcoal hover:bg-surface2";
