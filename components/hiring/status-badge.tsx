import { HIRING_STATUS_LABELS } from "@/lib/hiring/format";

const TONE: Record<string, string> = {
  hired: "bg-[#37755B]/15 text-[#285B45]",
  offered: "bg-[#37755B]/10 text-[#285B45]",
  declined: "bg-[#C24545]/10 text-[#8A2E2E]",
  rejected: "bg-[#C24545]/10 text-[#8A2E2E]",
};

export function HiringStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-bold ${
        TONE[status] ?? "border border-line bg-surface2 text-charcoal"
      }`}
    >
      {HIRING_STATUS_LABELS[status] ?? status}
    </span>
  );
}
