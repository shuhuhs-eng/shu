"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ExtraQuestions } from "@/components/salon-culture/extra-questions";
import { SUPPLEMENT_KEYS, type BaseAnswers, type SupplementAnswers, type SupplementKey, type SupplementValue } from "@/lib/salon-culture/analysis/v1";
import type { SaveExtraResult } from "@/lib/salon-culture/draft-actions";
import { SaveFeedback } from "@/components/profile/save-feedback";
import { UNCERTAIN_ERROR } from "@/lib/diagnosis-limit/messages";

type Props = {
  /** 回答の対象（例: サロン名・店舗名）。保存先と同じものを画面に出す。 */
  targetName: string;
  targetKind: "personal" | "store";
  /** この画面を表示した時点の既存回答5つ。保存時にサーバーが現在値と照合する。 */
  expectedBase: BaseAnswers;
  initial: Partial<SupplementAnswers> | null;
  /** 保存処理（Server Action を呼ぶ薄い関数）。 */
  /** 追加5問を保存して確定する（requestIdは同じ内容の再送で同じ値）。 */
  save: (answers: SupplementAnswers, expectedBase: BaseAnswers, requestId: string, acknowledged: boolean) => Promise<SaveExtraResult>;
  /**
   * 追加回答を答えたときの基本5問から、いまの基本5問が変わっている（追加回答は消さずに表示している）。
   * 追加回答を直さずに保存するときは、「この内容で確認しました」の操作を必須にする。
   */
  requireAck?: boolean;
  /** 保存前の回数の案内（表示専用。判定は保存時にDB）。 */
  notices?: string[];
  doneHref: string;
  cancelHref: string;
};

/**
 * サロンらしさ 追加5問の回答フォーム。回答を促すが強制はしない（既存機能は回答なしでも使える）。
 * 「当てはまらない」は数値で埋めず、そのまま保存する。
 */
export function AnalysisForm({ targetName, targetKind, expectedBase, initial, save, requireAck = false, notices = [], doneHref, cancelHref }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<Partial<SupplementAnswers>>(initial ?? {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  // 実際に保存が成功した直後だけ true。回答を変え始めたら消す（保存済みの内容と食い違うため）。
  const [saved, setSaved] = useState(false);
  // 保存の識別子。同じ回答の再送では同じ値（二重に数えない）、回答を変えたら作り直す。
  const requestRef = useRef<{ id: string; key: string } | null>(null);
  const inFlight = useRef(false);

  const complete = SUPPLEMENT_KEYS.every((k) => values[k] != null);
  // 回答を1つでも直したなら確認は不要（直したこと自体が見直し）。直さないで保存するときだけ確認を必須にする。
  const [acked, setAcked] = useState(false);
  const untouched = SUPPLEMENT_KEYS.every((k) => (initial ?? {})[k] != null && values[k] === (initial ?? {})[k]);
  const needAck = requireAck && untouched;

  function set(key: SupplementKey, v: SupplementValue) {
    setAcked(false); // 回答を変えたら確認は取り消す（元の値に戻しても確認し直す）
    setSaved(false);
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  async function handleSave() {
    if (!complete || saving || inFlight.current || (needAck && !acked)) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const key = JSON.stringify(values) + (needAck && acked ? "|ack" : "");
      if (!requestRef.current || requestRef.current.key !== key) requestRef.current = { id: crypto.randomUUID(), key };
      const result = await save(values as SupplementAnswers, expectedBase, requestRef.current.id, needAck && acked);
      if (!result.success) {
        setError({ code: result.code, message: result.error });
        return;
      }
      // 5軸の図が出ない回答（「当てはまらない」を含む）でも保存できたと分かるよう、その場に結果を出す。
      setSaved(true);
      router.refresh();
    } catch {
      setError({ code: "uncertain", message: UNCERTAIN_ERROR.message });
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-line bg-surface p-5">
        <p className="eyebrow mb-1">回答の対象</p>
        <p className="text-[15px] font-bold text-ink">{targetName}</p>
        <p className="mt-1 text-[12px] leading-relaxed text-sub">
          {targetKind === "store"
            ? "この回答は、この店舗の「サロンらしさ」に保存されます。ご自身の個人の回答や他の店舗とは、自動では共有されません。"
            : "この回答は、あなた個人の「サロンらしさ」に保存されます。店舗の回答とは、自動では共有されません。"}
        </p>
      </section>

      {notices.length > 0 && (
        <div className="rounded-2xl border border-line bg-surface2 px-4 py-3 text-[13.5px] leading-relaxed text-charcoal">
          {notices.map((l) => (
            <p key={l} className="mt-1 first:mt-0">{l}</p>
          ))}
        </div>
      )}

      <p className="text-[13px] leading-relaxed text-charcoal">
        サロンらしさを、5つの観点でくわしく見るための追加の質問です。「今、実際にどうしているか」でお答えください。
        どちらが良い・悪いという質問ではありません。当てはまらない場合は「当てはまらない」を選べます。
      </p>

      {needAck && (
        <div role="alert" className="rounded-2xl border border-line bg-surface px-4 py-3 text-[13.5px] leading-relaxed text-ink">
          <p>基本の質問のうち5つの回答が、追加の回答をしたときから変わっています。追加の回答は消さずに表示しています。今の内容でよいか確認してください。</p>
          <button
            type="button"
            aria-pressed={acked}
            disabled={saving}
            onClick={() => setAcked((v) => !v)}
            className={`mt-3 min-h-[44px] w-full rounded-full border px-4 py-2.5 text-[13px] font-semibold disabled:opacity-60 ${acked ? "border-ink bg-ink text-surface" : "border-line bg-surface text-charcoal"}`}
          >
            {acked ? "✓ この内容で確認しました" : "この内容で確認しました"}
          </button>
        </div>
      )}

      <ExtraQuestions values={values} onChange={set} disabled={saving} />

      {error && (
        <div role="alert" className="rounded-xl border border-line bg-surface2 p-4 text-[13px] leading-relaxed text-ink">
          <p>{error.message}</p>
          {error.code === "base_changed" && (
            <button
              type="button"
              onClick={() => router.refresh()}
              className="mt-3 min-h-[44px] rounded-full border border-line bg-surface px-4 py-2 text-[13px] font-semibold"
            >
              画面を読み込み直す
            </button>
          )}
        </div>
      )}

      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={!complete || saving || (needAck && !acked)}
          className="flex w-full items-center justify-center rounded-full bg-ink px-6 py-4 text-[15px] font-semibold text-surface disabled:opacity-50"
        >
          {saving ? "保存しています…" : "回答を保存する"}
        </button>
        {saved && (
          <div className="w-full">
            <SaveFeedback success="回答を保存しました" />
            <Link href={doneHref} className="mt-3 flex min-h-[44px] w-full items-center justify-center rounded-full border border-line bg-surface px-4 py-2.5 text-[13px] font-semibold text-ink">
              結果を見る
            </Link>
          </div>
        )}
        {!complete && <p className="text-[12px] text-sub">すべての質問に回答すると保存できます。</p>}
        {complete && needAck && !acked && <p className="text-[12px] text-sub">「この内容で確認しました」を押すと保存できます。</p>}
        <Link href={cancelHref} className="inline-flex min-h-[44px] items-center text-[13px] text-sub underline">
          あとで回答する
        </Link>
      </div>
    </div>
  );
}
