import Link from "next/link";
import { retakeNotice, type RetakeLimit } from "@/lib/diagnosis-limit/retake-status";

/**
 * ページ最下部の控えめな再診断リンク。見た目は小さくても、タップ領域は縦48px以上を確保する。
 * 制限の説明は、制限が実際に有効（0058適用済みで状態が取れた）ときだけ表示する。
 */
export function RetakeLink({ limit }: { limit: RetakeLimit }) {
  const n = retakeNotice(limit);
  return (
    <section aria-label="診断のやり直し" className="mt-10 border-t border-line pt-4 text-center">
      <p className="text-[12px] leading-relaxed text-sub">才能は経験とともに変わります。3か月〜半年ごとに診断を受け直すことをおすすめします。</p>
      {n.canStart ? (
        <Link href="/stylist/diagnosis" className="mt-1 inline-flex min-h-[48px] min-w-[48px] items-center justify-center px-4 text-[13px] text-sub underline">
          診断を受け直す
        </Link>
      ) : (
        <span aria-disabled="true" className="mt-1 inline-flex min-h-[48px] items-center justify-center px-4 text-[13px] text-sub/70">
          診断を受け直す（いまは変更できません）
        </span>
      )}
      {n.lockedText && <p className="text-[12px] font-semibold text-charcoal">{n.lockedText}</p>}
      {n.rule && <p className="mt-1 text-[11.5px] leading-relaxed text-sub">{n.rule}</p>}
    </section>
  );
}
