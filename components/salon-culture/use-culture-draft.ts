"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { confirmCultureAction, saveCultureDraftAction } from "@/lib/salon-culture/draft-actions";
import { confirmNotice, UNCERTAIN_ERROR, type LimitErrorCode, type LimitStatus } from "@/lib/diagnosis-limit/messages";
import { previewConfirm, type CultureAnswers, type DraftState } from "@/lib/salon-culture/draft";
import type { SupplementAnswers } from "@/lib/salon-culture/analysis/v1";

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
  const [step, setStep] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<LimitErrorCode | "invalid" | null>(null);
  const rev = useRef<number | null>(o.initialRev);
  const request = useRef<{ id: string; rev: number | null } | null>(null);
  const inFlight = useRef(false);

  function current(nextStep: number): DraftState {
    return {
      respondentRole: o.initial.respondentRole,
      currentStep: nextStep,
      answers,
      valuePriorities,
      comment,
      extra: o.initial.extra,
    };
  }

  function fail(code: LimitErrorCode | "invalid", message: string) {
    setError(message);
    setErrorCode(code);
  }

  /** 下書きに保存する（公開中の結果・回数は変わらない）。成功したら true。 */
  async function saveDraft(nextStep: number): Promise<boolean> {
    if (inFlight.current) return false;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    setErrorCode(null);
    try {
      const r = await saveCultureDraftAction(o.storeId, current(nextStep), rev.current);
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
  });
  const notice = confirmNotice(o.limitStatus, new Date(), { unchanged: !preview.changed && !preview.initial, extraFirst: preview.extraFirst });
  const blocked = notice.blocking || preview.extraRequired || incompleteAnswers(valuePriorities, answers);

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
    answers, setAnswers, valuePriorities, setValuePriorities, comment, setComment,
    step, setStep, reviewing, setReviewing, saving, error, setError, errorCode,
    saveDraft, startReview, confirm, preview, notice, blocked,
    refresh: () => router.refresh(),
  };
}

function incompleteAnswers(priorities: string[], answers: CultureAnswers): boolean {
  return priorities.length !== 3 || Object.values(answers).filter((v) => v != null).length < 12;
}
