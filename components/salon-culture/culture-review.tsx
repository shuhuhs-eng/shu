"use client";

import Link from "next/link";
import { SALON_VALUE_PRIORITY_OPTIONS } from "@/lib/validation/profile-options";
import type { LimitErrorCode } from "@/lib/diagnosis-limit/messages";
import type { CultureAnswers } from "@/lib/salon-culture/draft";

type Q = { key: string; title: string; leftLabel: string; rightLabel: string };

type Props = {
  questions: Q[];
  answers: CultureAnswers;
  valuePriorities: string[];
  comment: string;
  notice: { lines: string[]; blocking: boolean };
  /** 追加5問が回答済みで、5問を変えたため、追加5問も答え直す必要がある */
  extraRequired: boolean;
  analysisHref: string;
  error: string | null;
  errorCode: LimitErrorCode | "invalid" | null;
  saving: boolean;
  blocked: boolean;
  onEdit: (stepIndex: number) => void;
  onConfirm: () => void;
  onBack: () => void;
  onReload: () => void;
};

/** サロンらしさ（本人用・店舗用 共通）の確認画面。確定するまで、公開中の結果は変わらない。 */
export function CultureReview(p: Props) {
  const labelOf = (code: string) => SALON_VALUE_PRIORITY_OPTIONS.find((o) => o.code === code)?.label ?? code;
  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-serif text-xl font-bold leading-snug text-ink">この内容で確定しますか？</h2>
        <p className="mt-2 text-[13.5px] leading-relaxed text-sub">
          確定するまでは、いま公開されている結果は変わりません。直したい質問の「直す」を押してください。
        </p>
      </div>

      {p.notice.lines.length > 0 && (
        <div className="rounded-2xl border border-line bg-surface2 px-4 py-3 text-[13.5px] leading-relaxed text-charcoal">
          {p.notice.lines.map((l) => (
            <p key={l} className="mt-1 first:mt-0">{l}</p>
          ))}
        </div>
      )}

      {p.extraRequired && (
        <div role="alert" className="rounded-2xl border border-line bg-surface px-4 py-3 text-[13.5px] leading-relaxed text-ink">
          <p>5つの質問の回答を変えたため、追加の5問も答え直してから確定します。</p>
          <Link href={p.analysisHref} className="mt-2 inline-flex min-h-[44px] items-center font-semibold underline">
            追加の5問に答え直す
          </Link>
        </div>
      )}

      <ol className="space-y-3">
        {p.questions.map((q, i) => (
          <li key={q.key} className="rounded-2xl border border-line bg-surface px-4 py-3">
            <p className="text-[12.5px] leading-relaxed text-sub">問 {i + 1}　{q.title}</p>
            <p className="mt-1 text-[14px] leading-relaxed text-ink">
              {p.answers[q.key] != null ? `${p.answers[q.key]} / 5` : "未回答"}
            </p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-sub">1：{q.leftLabel}　／　5：{q.rightLabel}</p>
            <button type="button" onClick={() => p.onEdit(i)} disabled={p.saving}
              className="mt-1 inline-flex min-h-[44px] items-center text-[13px] font-semibold text-sub underline disabled:opacity-60">
              直す
            </button>
          </li>
        ))}
        <li className="rounded-2xl border border-line bg-surface px-4 py-3">
          <p className="text-[12.5px] leading-relaxed text-sub">大切にしている価値観トップ3</p>
          <ul className="mt-1 list-disc pl-5 text-[14px] leading-relaxed text-ink">
            {p.valuePriorities.map((c) => <li key={c}>{labelOf(c)}</li>)}
          </ul>
          <button type="button" onClick={() => p.onEdit(p.questions.length)} disabled={p.saving}
            className="mt-1 inline-flex min-h-[44px] items-center text-[13px] font-semibold text-sub underline disabled:opacity-60">
            直す
          </button>
        </li>
        <li className="rounded-2xl border border-line bg-surface px-4 py-3">
          <p className="text-[12.5px] leading-relaxed text-sub">サロンの雰囲気（任意）</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-ink">{p.comment || "（未入力）"}</p>
          <button type="button" onClick={() => p.onEdit(p.questions.length + 1)} disabled={p.saving}
            className="mt-1 inline-flex min-h-[44px] items-center text-[13px] font-semibold text-sub underline disabled:opacity-60">
            直す
          </button>
        </li>
      </ol>

      {p.error && (
        <div role="alert" className="rounded-xl border border-[#C24545]/30 bg-[#C24545]/10 px-4 py-3 text-[13px] leading-relaxed text-[#8A2E2E]">
          <p>{p.error}</p>
          {(p.errorCode === "draft_changed") && (
            <button type="button" onClick={p.onReload} className="mt-2 inline-flex min-h-[44px] items-center font-semibold underline">
              画面を読み込み直す
            </button>
          )}
          {p.errorCode === "extra_required" && (
            <Link href={p.analysisHref} className="mt-2 inline-flex min-h-[44px] items-center font-semibold underline">追加の5問に答え直す</Link>
          )}
        </div>
      )}

      <button type="button" onClick={p.onConfirm} disabled={p.saving || p.blocked}
        className="flex min-h-[48px] w-full items-center justify-center rounded-full bg-ink px-6 py-4 text-[15px] font-semibold text-surface disabled:opacity-50">
        {p.saving ? "保存しています..." : "この内容で確定する"}
      </button>
      <button type="button" onClick={p.onBack} disabled={p.saving}
        className="inline-flex min-h-[44px] items-center text-[13px] font-semibold text-sub underline disabled:opacity-60">
        最後の質問に戻る
      </button>
    </div>
  );
}
