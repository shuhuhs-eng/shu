"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { confirmCultureAction, saveCultureDraftAction } from "@/lib/salon-culture/draft-actions";
import { confirmNotice, UNCERTAIN_ERROR, type LimitErrorCode, type LimitStatus } from "@/lib/diagnosis-limit/messages";
import { countPartial, extraAckValid, previewConfirm, type CultureAnswers, type DraftState, type ExtraAck } from "@/lib/salon-culture/draft";
import { extractBaseAnswers, extractSupplementAnswers, SUPPLEMENT_KEYS, type SupplementAnswers } from "@/lib/salon-culture/analysis/v1";

type Options = {
  /** 本人用は null、店舗用は店舗ID。 */
  storeId: string | null;
  initial: DraftState;
  /** 下書きの版番号（下書きが無ければ null）。別タブ・別担当者の上書きを検出するために保存のたび送る。 */
  initialRev: number | null;
  resultHref: string;
  hasPublished: boolean;
  publishedAnswers: unknown;
  publishedExtra: SupplementAnswers | null;
  /** 公開中の追加5問を答えた時点の基本5問（base_snapshot）。 */
  publishedExtraBase?: unknown;
  limitStatus: LimitStatus;
};

/**
 * サロンらしさ（本人用・店舗用 共通）の下書き保存と確定の状態管理。
 * ・各ステップは「下書き」にだけ保存する（公開中の結果・回数は変わらない）。
 * ・最後に確認画面を挟み、「確定する」を押したときだけ公開結果になる。
 * ・保存の識別子（requestId）は、下書きの版が変わらない限り同じ値を送る（連打・再送で二重に数えない）。
 */
export function useCultureDraft(o: Options) {
  const router = useRouter();
  const [answers, setAnswers] = useState<CultureAnswers>(o.initial.answers);
  const [valuePriorities, setValuePriorities] = useState<string[]>(o.initial.valuePriorities);
  const [comment, setComment] = useState(o.initial.comment);
  // 追加5問（任意）。途中の入力を持てるよう部分回答で持ち、5問すべて揃ったときだけ「回答あり」として下書きへ送る。
  const [extraDraft, setExtraDraft] = useState<Partial<SupplementAnswers>>(o.initial.extra ?? o.initial.extraPartial ?? {});
  // 「この内容で確認しました」の記録。下書きから読み戻さない（再開・別タブでは必ず確認し直す）。
  const [ack, setAck] = useState<ExtraAck | null>(null);
  const [step, setStep] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<LimitErrorCode | "invalid" | null>(null);
  const rev = useRef<number | null>(o.initialRev);
  const request = useRef<{ id: string; rev: number | null } | null>(null);
  const inFlight = useRef(false);

  const extraComplete = extractSupplementAnswers(extraDraft);
  const extraAnsweredCount = SUPPLEMENT_KEYS.filter((k) => extraDraft[k] != null).length;
  /** 一部だけ答えている（5問すべてに答えるか、すべて空にする必要がある）。 */
  const extraPartial = extraAnsweredCount > 0 && !extraComplete;

  function current(nextStep: number, ackOverride?: ExtraAck | null, extraOverride?: Partial<SupplementAnswers>): DraftState {
    const ex = extraOverride ?? extraDraft;
    const exComplete = extractSupplementAnswers(ex);
    return {
      respondentRole: o.initial.respondentRole,
      currentStep: nextStep,
      answers,
      valuePriorities,
      comment,
      extra: exComplete,
      // 途中回答（1〜4問）は別に持つ。5問そろうまで公開用の extra にはしない。補完もしない。
      extraPartial: !exComplete && countPartial(ex) > 0 ? ex : null,
      extraAck: ackOverride === undefined ? ack : ackOverride,
    };
  }

  function fail(code: LimitErrorCode | "invalid", message: string) {
    setError(message);
    setErrorCode(code);
  }

  /** 下書きに保存する（公開中の結果・回数は変わらない）。成功したら true。 */
  async function saveDraft(nextStep: number, ackOverride?: ExtraAck | null, extraOverride?: Partial<SupplementAnswers>): Promise<boolean> {
    if (inFlight.current) return false;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    setNote(null);
    setErrorCode(null);
    try {
      const r = await saveCultureDraftAction(o.storeId, current(nextStep, ackOverride, extraOverride), rev.current);
      if (!r.success) {
        fail(r.code, r.error);
        return false;
      }
      rev.current = r.rev;
      return true;
    } catch {
      fail("unknown", "下書きの保存に失敗しました。通信状況を確認して、もう一度お試しください。公開中の結果は変わっていません。");
      return false;
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  /** 最後の質問のあと: 下書きを保存してから確認画面へ。 */
  async function startReview(lastStep: number) {
    if (await saveDraft(lastStep)) setReviewing(true);
  }

  const preview = previewConfirm({
    hasPublished: o.hasPublished,
    draft: current(step),
    publishedAnswers: o.publishedAnswers,
    publishedExtra: o.publishedExtra,
    publishedExtraBase: o.publishedExtraBase,
  });
  const notice = confirmNotice(o.limitStatus, new Date(), { unchanged: !preview.changed && !preview.initial, extraFirst: preview.extraFirst });
  const blocked = notice.blocking || preview.extraRequired || preview.extraAckRequired || extraPartial || incompleteAnswers(valuePriorities, answers);

  /** 「この内容で確認しました」。いまの基本5問と追加5問をそのまま記録し、下書きにも保存する（保存に失敗したら記録しない）。 */
  async function acknowledgeExtra(): Promise<boolean> {
    const base = extractBaseAnswers(answers);
    if (!base || !extraComplete) return false;
    const next: ExtraAck = { base, extra: extraComplete };
    if (!(await saveDraft(step, next))) return false;
    setAck(next);
    return true;
  }

  async function saveDraftExplicit(): Promise<boolean> {
    const ok = await saveDraft(step);
    if (ok) setNote("下書きに保存しました。再読み込みしても、続きから入力できます。");
    return ok;
  }

  /**
   * 「今回の追加入力をクリアする」: 追加5問を未回答に戻して下書きへ保存する（保存に失敗したら画面の入力も戻さない）。
   * 公開中の追加回答は消さない（公開中の回答がある人には使えない）。基本12問・価値観・コメントには触れない。
   */
  async function clearExtra(): Promise<boolean> {
    if (o.publishedExtra != null) return false;
    if (!(await saveDraft(step, null, {}))) return false;
    setAck(null);
    setExtraDraft({});
    setNote("今回の追加入力をクリアしました。追加の5問は未回答のまま進められます。");
    return true;
  }

  async function confirm() {
    if (inFlight.current || blocked) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    setErrorCode(null);
    try {
      if (!request.current || request.current.rev !== rev.current) request.current = { id: crypto.randomUUID(), rev: rev.current };
      const r = await confirmCultureAction(o.storeId, request.current.id, rev.current);
      if (!r.success) {
        fail(r.code, r.error);
        return;
      }
      router.push(o.resultHref);
      router.refresh();
    } catch {
      fail("uncertain", UNCERTAIN_ERROR.message);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return {
    answers,
    // 回答を変えたら、確認記録は必ず消す（元の値に戻しても確認し直す）。
    setAnswers: ((f: Parameters<typeof setAnswers>[0]) => { setAck(null); setAnswers(f); }) as typeof setAnswers,
    valuePriorities, setValuePriorities, comment, setComment,
    step, setStep, reviewing, setReviewing, saving, error, setError, errorCode,
    saveDraft, startReview, confirm, preview, notice, blocked,
    extraDraft, setExtraDraft: ((f: Parameters<typeof setExtraDraft>[0]) => { setAck(null); setExtraDraft(f); }) as typeof setExtraDraft, extraPartial, extraAnsweredCount, canClearExtra: o.publishedExtra == null && extraAnsweredCount > 0, clearExtra, saveDraftExplicit, note, extraAckOk: extraAckValid({ answers, extra: extraComplete, extraAck: ack }), acknowledgeExtra,
    refresh: () => router.refresh(),
  };
}

function incompleteAnswers(priorities: string[], answers: CultureAnswers): boolean {
  return priorities.length !== 3 || Object.values(answers).filter((v) => v != null).length < 12;
}
