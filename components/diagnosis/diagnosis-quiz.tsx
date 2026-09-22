"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { bankFor, computeDiagnosis, type DiagnosisMode } from "@/lib/diagnosis";
import { DIAGNOSIS_RESULT_STORAGE_KEY } from "@/lib/diagnosis-handoff/constants";
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
export function DiagnosisQuiz({ mode, isLoggedIn }: Props) {
  const router = useRouter();
  const bank = bankFor(mode);

  const [answers, setAnswers] = useState<Array<number | null>>(() => Array(bank.length).fill(null));
  const [index, setIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const question = bank[index];
  const sectionNumber = Math.floor(index / SECTION_SIZE) + 1;
  const totalSections = Math.ceil(bank.length / SECTION_SIZE);
  const progressPct = Math.round((index / bank.length) * 100);

  async function handleSelect(optionIndex: number) {
    if (submitting) return;

    const next = [...answers];
    next[index] = optionIndex;
    setAnswers(next);

    if (index < bank.length - 1) {
      setIndex(index + 1);
      return;
    }

    await submit(next as number[]);
  }

  async function submit(finalAnswers: number[]) {
    setSubmitting(true);
    setError(null);

    // ★ログイン済みの場合のみ、新しい専用経路を使う（不具合修正）。
    // 未ログイン時は以降の分岐に入らず、既存の /api/diagnosis/guest
    // 経路をそのまま通る（挙動は一切変更していない）。
    if (isLoggedIn) {
      try {
        const result = await submitDiagnosisForLoggedInUser(mode, finalAnswers);
        if (!result.success) {
          throw new Error(result.error);
        }
        // 表示用プレビューは既存のcomputeDiagnosis()をクライアント側でも
        // 呼んで作る（ゲスト経路のpreviewと同じ考え方：表示専用であり、
        // 保存済みの真値はサーバー側（Server Action内）で既に再計算・
        // 確定保存済み）。
        const preview = computeDiagnosis(mode, finalAnswers);
        sessionStorage.setItem(DIAGNOSIS_RESULT_STORAGE_KEY, JSON.stringify(preview));
        router.push("/diagnosis/result");
      } catch {
        setError("結果の保存に失敗しました。もう一度お試しください。");
        setSubmitting(false);
      }
      return;
    }

    try {
      const res = await fetch("/api/diagnosis/guest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, answers: finalAnswers }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error("save_failed");
      }
      sessionStorage.setItem(DIAGNOSIS_RESULT_STORAGE_KEY, JSON.stringify(data.preview));
      router.push("/diagnosis/result");
    } catch {
      setError("結果の保存に失敗しました。もう一度お試しください。");
      setSubmitting(false);
    }
  }

  function handleBack() {
    if (index > 0 && !submitting) setIndex(index - 1);
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

      <div className="mt-7 space-y-3">
        {question.opts.map((opt, i) => (
          <button
            key={i}
            type="button"
            disabled={submitting}
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
        <p
          role="alert"
          className="mt-4 rounded-xl border border-[#C24545]/30 bg-[#C24545]/10 px-4 py-3 text-[13px] text-[#8A2E2E]"
        >
          {error}
        </p>
      )}

      <div className="mt-8 flex min-h-[20px] items-center justify-between">
        <button
          type="button"
          onClick={handleBack}
          disabled={index === 0 || submitting}
          className="text-[13px] font-semibold text-sub underline disabled:opacity-0"
        >
          戻る
        </button>
        {submitting && <span className="text-[13px] text-sub">結果を計算しています...</span>}
      </div>
    </main>
  );
}
