import { HIRING_STATUS_LABELS, stylistStatusLabel } from "@/lib/hiring/format";

const TONE: Record<string, string> = {
  hired: "bg-[#37755B]/15 text-[#285B45]",
  declined: "bg-[#C24545]/10 text-[#8A2E2E]",
  rejected: "bg-[#C24545]/10 text-[#8A2E2E]",
};

/** audience="stylist" のときは「内定」を見せない（過去の offered は選考中として表示）。 */
export function HiringStatusBadge({ status, audience = "store" }: { status: string; audience?: "store" | "stylist" }) {
  return (
    <span
      className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-bold ${
        TONE[status] ?? "border border-line bg-surface2 text-charcoal"
      }`}
    >
      {audience === "stylist" ? stylistStatusLabel(status) : (HIRING_STATUS_LABELS[status] ?? status)}
    </span>
  );
}
