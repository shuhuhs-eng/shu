"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { answersAfterSwitch, planFirstAnswerChange } from "@/lib/diagnosis/quiz-switch";
import { DIAGNOSIS_VERSION, QS, entryQuestionFor, quizBankFor, setFromFirstAnswer, submissionErrorNotice, verifySubmission, versionOfSet, type DiagnosisMode, type DiagnosisSetId } from "@/lib/diagnosis";
import { DIAGNOSIS_NEXT_CHANGE_STORAGE_KEY, DIAGNOSIS_RESULT_STORAGE_KEY, DIAGNOSIS_SAVED_STORAGE_KEY } from "@/lib/diagnosis-handoff/constants";
import { confirmNotice, UNCERTAIN_ERROR, UNKNOWN_STATUS, type LimitErrorCode, type LimitStatus } from "@/lib/diagnosis-limit/messages";
import { submitDiagnosisForLoggedInUser } from "@/lib/diagnosis-handoff/submit-logged-in";

const SECTION_SIZE = 5;

type Props = {
  mode: DiagnosisMode;
  /**
   * サーバー側（呼び出し元のpage.tsx）で確認済みのログイン状態。
   * true の場合、送信時は /api/diagnosis/guest（pending_diagnoses経由）
   * ではなく、ログイン済み専用の submitDiagnosisForLoggedInUser()
   * Server Actionを使い、diagnosis_results へ直接確定保存する
   * （不具合修正: 以前はログイン状態に関わらず常にpending_diagnoses
   * 経由だったため、既にログイン済みのユーザーは再ログインイベントが
   * 発生せず claimPendingDiagnosisIfPresent() が呼ばれないままだった）。
   * 未ログイン時の挙動・APIは一切変更していない。
   */
  isLoggedIn: boolean;
  /** ログイン済みの本人の、結果の変更状態（案内用。保存の可否は保存時にDBが判断する）。 */
  limitStatus?: LimitStatus;
  /** 新卒の入口（1問目の5つ目の選択肢）を出すか。サーバー（page.tsx）が環境変数で決めて渡す。既定は出さない（明示的に有効化したときだけ出す）。 */
  newgradEnabled?: boolean;
};

/**
 * 診断クイズ本体（美容師30問／サロン14問 共通）。
 * 質問データ・判定ロジックは既存の lib/diagnosis をそのまま再利用し、
 * ここでは新しいロジックを作らない。bankFor(mode) が
 * mode="stylist" なら Q（30問）、mode="salon" なら QS（14問）を返す。
 *
 * 未ログインでも回答できる。最終問に回答すると /api/diagnosis/guest へ
 * { mode, answers } を送信し、pending_diagnoses への保存と claim_token
 * Cookieの発行を行う（サーバー側処理は既存のAPIをそのまま再利用）。
 * 表示用の結果は同じレスポンスの preview（computeDiagnosis()の戻り値。
 * mode情報も含む）を sessionStorage経由で結果画面へ渡す。
 *
 * ★ログイン済みの場合（isLoggedIn=true）は、上記のpending_diagnoses経由
 * ではなく submitDiagnosisForLoggedInUser() Server Actionを呼び、
 * diagnosis_results へその場で直接確定保存する（美容師診断なら
 * save_core_type_result() も実行される）。未ログイン時の経路・挙動は
 * この分岐の影響を一切受けない。
 */
export function DiagnosisQuiz({ mode, isLoggedIn, limitStatus = UNKNOWN_STATUS, newgradEnabled = false }: Props) {
  const router = useRouter();
  // 美容師診断は共通の30問。1問目の回答で、2問目以降のセット（経験者版／新卒版）が決まる。サロン診断は従来どおり14問。
  const [answers, setAnswers] = useState<Array<number | null>>(() => Array(mode === "salon" ? QS.length : 30).fill(null));
  const set: DiagnosisSetId = mode === "salon" ? "experienced" : (setFromFirstAnswer(answers[0]) ?? "experienced");
  const fullBank = mode === "salon" ? QS : quizBankFor(set);
  // 入口を止めている間は、1問目の5つ目の選択肢を出さない（途中で止まった画面の回答も、サーバーが拒否する）。
  const bank = mode === "salon" || newgradEnabled ? fullBank : [entryQuestionFor(false), ...fullBank.slice(1)];
  // 送信に添える「どの版・どの質問の並びで答えたか」。サーバーは1問目の回答から公式の版を決め、この申告と照合する。
  const declared = { setVersion: mode === "salon" ? DIAGNOSIS_VERSION : versionOfSet(set), questionIds: bank.map((q) => q.id) };
  // 1問目を変えて別のセットになる操作の確認待ち（2問目以降に回答があるときだけ）。値は選ぼうとした選択肢の添字。
  const [switchPrompt, setSwitchPrompt] = useState<number | null>(null);
  const [index, setIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<LimitErrorCode | "closed" | null>(null);
  // ログイン済みは、最後の質問のあと確認画面を挟み、そこで「確定する」を押したときだけ保存する。
  const [reviewing, setReviewing] = useState(false);
  // 確認画面から回答を直しに行ったあとは、次の質問へ進まず確認画面へ戻る。
  const [returnToReview, setReturnToReview] = useState(false);
  // 保存の識別子。同じ回答の再送では同じ値を送り（二重に数えない）、回答が変わったら作り直す
  // （同じ識別子で別の内容を送ると、DBが拒否する）。
  const requestRef = useRef<{ id: string; key: string } | null>(null);
  // 送信中の連打を、再描画を待たずに止める。
  const inFlight = useRef(false);

  const question = bank[index];
  const sectionNumber = Math.floor(index / SECTION_SIZE) + 1;
  const totalSections = Math.ceil(bank.length / SECTION_SIZE);
  const progressPct = Math.round((index / bank.length) * 100);

  /** 別のセットへ切り替える: 2問目以降の回答・確認画面への戻り・保存の識別子をすべて作り直し、2問目から始める。 */
  function applySwitch(optionIndex: number) {
    setAnswers(answersAfterSwitch(answers.length, optionIndex));
    requestRef.current = null;
    setSwitchPrompt(null);
    setReturnToReview(false);
    setReviewing(false);
    setError(null);
    setErrorCode(null);
    setIndex(1);
  }

  async function handleSelect(optionIndex: number) {
    if (submitting) return;

    const plan = planFirstAnswerChange(mode, index, answers, optionIndex);
    if (plan === "confirm") {
      // 別のセットになり、2問目以降に回答がある。消してよいか確認する。
      setSwitchPrompt(optionIndex);
      return;
    }
    if (plan === "switch") {
      applySwitch(optionIndex);
      return;
    }

    const next = [...answers];
    next[index] = optionIndex;
    setAnswers(next);

    if (returnToReview) {
      setReturnToReview(false);
      setReviewing(true);
      return;
    }

    if (index < bank.length - 1) {
      setIndex(index + 1);
      return;
    }

    if (isLoggedIn) {
      setReviewing(true);
      return;
    }

    await submit(next as number[]);
  }

  async function submit(finalAnswers: number[]) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    setErrorCode(null);
    // 今回の回答で結果を作り直すため、前回の「保存済み」「プレビュー」を残さない。
    try {
      sessionStorage.removeItem(DIAGNOSIS_SAVED_STORAGE_KEY);
      sessionStorage.removeItem(DIAGNOSIS_RESULT_STORAGE_KEY);
    } catch {
      // sessionStorageが使えない環境でも診断自体は続行する。
    }

    // ★ログイン済みの場合のみ、新しい専用経路を使う（不具合修正）。
    // 未ログイン時は以降の分岐に入らず、既存の /api/diagnosis/guest
    // 経路をそのまま通る（挙動は一切変更していない）。
    if (isLoggedIn) {
      try {
        const key = JSON.stringify({ d: declared, a: finalAnswers });
        if (!requestRef.current || requestRef.current.key !== key) {
          requestRef.current = { id: crypto.randomUUID(), key };
        }
        const result = await submitDiagnosisForLoggedInUser(mode, finalAnswers, requestRef.current.id, declared);
        if (!result.success) {
          const notice = submissionErrorNotice(result.error);
          setError(notice?.message ?? result.message ?? UNCERTAIN_ERROR.message);
          setErrorCode(notice ? "closed" : result.code ?? "uncertain");
          inFlight.current = false;
          setSubmitting(false);
          return;
        }
        // 表示用プレビューは既存のcomputeDiagnosis()をクライアント側でも
        // 呼んで作る（ゲスト経路のpreviewと同じ考え方：表示専用であり、
        // 保存済みの真値はサーバー側（Server Action内）で既に再計算・
        // 確定保存済み）。
        const verified = verifySubmission(mode, finalAnswers, declared);
        if (!verified.ok) throw new Error("preview_failed");
        const preview = verified.computed;
        sessionStorage.setItem(DIAGNOSIS_RESULT_STORAGE_KEY, JSON.stringify(preview));
        // 保存に成功した場合だけ「保存済み」を結果画面へ伝える（失敗時は書かない）。
        sessionStorage.setItem(DIAGNOSIS_SAVED_STORAGE_KEY, result.diagnosisResultId);
        if (result.lockedUntil) sessionStorage.setItem(DIAGNOSIS_NEXT_CHANGE_STORAGE_KEY, result.lockedUntil);
        else sessionStorage.removeItem(DIAGNOSIS_NEXT_CHANGE_STORAGE_KEY);
        router.push("/diagnosis/result");
      } catch {
        setError(UNCERTAIN_ERROR.message);
        setErrorCode("uncertain");
        inFlight.current = false;
        setSubmitting(false);
      }
      return;
    }

    try {
      const res = await fetch("/api/diagnosis/guest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, answers: finalAnswers, ...declared }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        const notice = submissionErrorNotice(data?.error);
        if (notice) {
          setError(notice.message);
          inFlight.current = false;
          setSubmitting(false);
          return;
        }
        throw new Error("save_failed");
      }
      sessionStorage.setItem(DIAGNOSIS_RESULT_STORAGE_KEY, JSON.stringify(data.preview));
      router.push("/diagnosis/result");
    } catch {
      setError("結果の保存に失敗しました。もう一度お試しください。");
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  function handleBack() {
    if (submitting) return;
    if (reviewing) {
      setError(null);
      setErrorCode(null);
      setReviewing(false);
      setIndex(bank.length - 1);
      return;
    }
    if (index > 0) setIndex(index - 1);
  }

  function editAnswer(i: number) {
    if (submitting) return;
    setError(null);
    setErrorCode(null);
    setReviewing(false);
    setReturnToReview(true);
    setIndex(i);
  }

  if (reviewing) {
    const notice = confirmNotice(limitStatus);
    const canRetry = errorCode !== null && errorCode !== "locked" && errorCode !== "not_authenticated" && errorCode !== "closed";
    return (
      <main className="mx-auto max-w-[520px] px-5 py-10">
        <div className="mb-7 flex items-center gap-2.5">
          <span className="eyebrow">Beauty Reach</span>
          <hr className="h-px flex-1 border-0 bg-line" />
          <span className="eyebrow" style={{ color: "var(--gold)" }}>回答の確認</span>
        </div>
        <h1 className="font-serif text-2xl font-bold leading-snug text-ink">この内容で確定しますか？</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-sub">
          確定する前に、回答を見直せます。直したい質問の「直す」を押してください。
        </p>

        {notice.lines.length > 0 && (
          <div className="mt-5 rounded-2xl border border-line bg-surface2 px-4 py-3 text-[13.5px] leading-relaxed text-charcoal">
            {notice.lines.map((l) => (
              <p key={l} className="mt-1 first:mt-0">{l}</p>
            ))}
          </div>
        )}

        <ol className="mt-6 space-y-3">
          {bank.map((q, i) => (
            <li key={i} className="rounded-2xl border border-line bg-surface px-4 py-3">
              <p className="text-[12.5px] leading-relaxed text-sub">問 {i + 1}　{q.q}</p>
              <p className="mt-1 text-[14px] leading-relaxed text-ink">{answers[i] !== null ? q.opts[answers[i] as number].t : "未回答"}</p>
              <button
                type="button"
                onClick={() => editAnswer(i)}
                disabled={submitting}
                className="mt-1 inline-flex min-h-[44px] items-center text-[13px] font-semibold text-sub underline disabled:opacity-60"
              >
                直す
              </button>
            </li>
          ))}
        </ol>

        {error && (
          <div role="alert" className="mt-4 rounded-xl border border-[#C24545]/30 bg-[#C24545]/10 px-4 py-3 text-[13px] text-[#8A2E2E]">
            <p>{error}</p>
            {canRetry && (
              <button
                type="button"
                onClick={() => submit(answers as number[])}
                disabled={submitting}
                className="mt-2 inline-flex min-h-[44px] items-center font-semibold underline disabled:opacity-60"
              >
                今回の回答でもう一度保存する
              </button>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => submit(answers as number[])}
          disabled={submitting || notice.blocking || answers.some((a) => a === null)}
          className="mt-6 flex min-h-[48px] w-full items-center justify-center rounded-full bg-ink px-6 py-4 text-[15px] font-semibold text-surface disabled:opacity-50"
        >
          {submitting ? "保存しています..." : "この内容で確定する"}
        </button>
        <button
          type="button"
          onClick={handleBack}
          disabled={submitting}
          className="mt-2 inline-flex min-h-[44px] items-center text-[13px] font-semibold text-sub underline disabled:opacity-60"
        >
          最後の質問に戻る
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[520px] px-5 py-10">
      <div className="mb-7 flex items-center gap-2.5">
        <span className="eyebrow">Beauty Reach</span>
        <hr className="h-px flex-1 border-0 bg-line" />
        <span className="eyebrow" style={{ color: "var(--gold)" }}>
          セクション {sectionNumber} / {totalSections}
        </span>
      </div>

      <div className="mb-6 h-1.5 w-full overflow-hidden rounded-full bg-surface2">
        <div
          className="h-full rounded-full bg-ink transition-all"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <p className="eyebrow mb-2">
        問 {index + 1} / {bank.length}
      </p>
      <h1 className="font-serif text-2xl font-bold leading-snug text-ink">{question.q}</h1>

      {switchPrompt !== null && (
        <div role="alertdialog" aria-live="polite" className="mt-5 rounded-2xl border border-line bg-surface2 px-4 py-3 text-[13.5px] leading-relaxed text-charcoal">
          <p>
            1問目の回答を変えると、{setFromFirstAnswer(switchPrompt) === "newgrad" ? "新卒・これから美容師として働く人向け" : "現役の美容師向け"}の質問に切り替わります。2問目以降の回答は消えて、2問目からやり直しになります。
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4">
            <button type="button" onClick={() => applySwitch(switchPrompt)} className="inline-flex min-h-[44px] items-center font-semibold underline">
              回答を消して切り替える
            </button>
            <button type="button" onClick={() => setSwitchPrompt(null)} className="inline-flex min-h-[44px] items-center font-semibold text-sub underline">
              今の回答のままにする
            </button>
          </div>
        </div>
      )}

      <div className="mt-7 space-y-3">
        {question.opts.map((opt, i) => (
          <button
            key={i}
            type="button"
            disabled={submitting || switchPrompt !== null}
            onClick={() => handleSelect(i)}
            aria-pressed={answers[index] === i}
            className={`w-full rounded-2xl border px-5 py-4 text-left text-[14.5px] leading-relaxed transition-colors disabled:opacity-60 ${
              answers[index] === i
                ? "border-ink bg-ink text-surface"
                : "border-line bg-surface text-charcoal"
            }`}
          >
            {opt.t}
          </button>
        ))}
      </div>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-[#C24545]/30 bg-[#C24545]/10 px-4 py-3 text-[13px] text-[#8A2E2E]"
        >
          <p>{error}</p>
          {/* 回答はこの画面に残っている。最後まで答え終えていれば、回答し直さずに再送信できる。 */}
          {answers.every((a) => a !== null) && (
            <button
              type="button"
              onClick={() => submit(answers as number[])}
              disabled={submitting}
              className="mt-2 inline-flex min-h-[44px] items-center font-semibold underline disabled:opacity-60"
            >
              今回の回答でもう一度保存する
            </button>
          )}
        </div>
      )}

      <div className="mt-8 flex min-h-[20px] items-center justify-between">
        <button
          type="button"
          onClick={handleBack}
          disabled={index === 0 || submitting}
          className="inline-flex min-h-[44px] items-center text-[13px] font-semibold text-sub underline disabled:opacity-0"
        >
          戻る
        </button>
        {submitting && <span className="text-[13px] text-sub">結果を計算しています...</span>}
      </div>
    </main>
  );
}
