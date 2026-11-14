import { formatJstDateTime, type LimitStatus } from "@/lib/diagnosis-limit/messages";

/** 結果の変更に関する案内（表示専用。判定は保存時にDBが行う）。状態が取れないとき・初回は何も出さない。 */
export function ChangeLimitBanner({ status, hasPublished }: { status: LimitStatus; hasPublished: boolean }) {
  if (!hasPublished) return null;
  if (status.state === "locked" && status.lockedUntil) {
    return (
      <p className="rounded-xl border border-line bg-surface2 px-4 py-3 text-[13px] leading-relaxed text-charcoal">
        結果を次に変更できるのは {formatJstDateTime(status.lockedUntil)} 以降です。それまでは、回答を下書きとして保存できますが、結果を変える確定はできません。
      </p>
    );
  }
  if (status.state === "can_change") {
    return (
      <p className="rounded-xl border border-line bg-surface2 px-4 py-3 text-[13px] leading-relaxed text-charcoal">
        公開中の結果を変更できるのは、あと1回です。確定するまでは、いまの結果は変わりません。
      </p>
    );
  }
  return null;
}
