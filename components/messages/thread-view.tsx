import { DELIVERY_LABEL, KIND_LABEL } from "@/lib/messages/shared";

const fmt = (t: string) => new Date(t).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function FormError({ err }: { err?: string }) {
  return err ? <p role="alert" className="mt-4 rounded-lg bg-[#C24545]/10 px-3 py-2 text-[12.5px] text-[#8A2E2E]">{err.slice(0, 200)}</p> : null;
}

type Item = { id: string; label: string; body: string; at: string; tone: "admin" | "them" | "note"; sub?: string };
/** 連絡の履歴（運営・相手側で共通）。本文は文字列として表示する（HTMLとして解釈しない）。 */
export function ThreadMessages({ items }: { items: Item[] }) {
  const tone = { admin: "border-line bg-surface", them: "border-line bg-surface2", note: "border-dashed border-[#B8892E]/60 bg-[#B8892E]/10" } as const;
  return (
    <ol className="mt-6 space-y-3">
      {items.map((m) => (
        <li key={m.id} className={`rounded-2xl border p-4 ${tone[m.tone]}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-[11.5px] text-sub"><b className="text-ink">{m.label}</b><time dateTime={m.at}>{fmt(m.at)}</time></div>
          <p className="mt-2 whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-charcoal">{m.body}</p>
          {m.sub && <p className="mt-2 text-[11px] text-sub">{m.sub}</p>}
        </li>
      ))}
    </ol>
  );
}
export const adminItems = (messages: { id: string; kind: string; author_name: string | null; body: string; created_at: string; delivery: { status: string; attempts: number } | null }[]): Item[] =>
  messages.map((m) => ({
    id: m.id, body: m.body, at: m.created_at,
    tone: m.kind === "to_recipient" ? "admin" : m.kind === "from_recipient" ? "them" : "note",
    label: `${KIND_LABEL[m.kind] ?? m.kind}${m.author_name ? `（${m.author_name}）` : ""}`,
    sub: m.kind === "to_recipient" && m.delivery ? DELIVERY_LABEL[m.delivery.status] ?? undefined : undefined,
  }));
