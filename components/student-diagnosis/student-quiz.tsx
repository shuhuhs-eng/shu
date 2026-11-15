"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  STUDENT_QUESTIONS, isValidStudentAnswers, type StudentAnswers, type StudentQuestion,
} from "@/lib/student-diagnosis/questions";
import type { SubmitStudentResult } from "@/lib/student-diagnosis/actions";
import { UNCERTAIN_ERROR } from "@/lib/diagnosis-limit/messages";

type Props = {
  submit: (answers: StudentAnswers, requestId: string) => Promise<SubmitStudentResult>;
  resultHref: string;
  cancelHref: string;
  /** 回数の案内（表示専用。判定は保存時にDB）。 */
  notices?: string[];
};

const SECTION_TITLE: Record<string, string> = {
  interest: "気になること", learning: "学びたいこと", learningFocus: "学びたいこと", values: "大切にしたい働き方", env: "合いやすい教え方", concern: "不安に感じること",
};

/**
 * 美容学生・新卒 診断（student_newgrad_v1・15問）。実績や経験は聞かない。「できる/できない」を測らない。
 * 保存はサーバーで回答から結果を作り直す。成功した後だけ結果画面へ進む。失敗時は回答とエラーを残す。
 */
export function StudentQuiz({ submit, resultHref, cancelHref, notices = [] }: Props) {
  const router = useRouter();
  const [answers, setAnswers] = useState<StudentAnswers>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<{ id: string; key: string } | null>(null);
  const inFlight = useRef(false);

  const complete = isValidStudentAnswers(answers);

  function setAns(q: StudentQuestion, next: string[]) {
    setError(null);
    setAnswers((prev) => {
      const a = { ...prev };
      if (next.length === 0) delete a[q.id]; else a[q.id] = next;
      // Q7を変えたら、Q8（特に学びたいもの）がQ7の中に無くなる場合は外す
      if (q.id === "q7" && a.q8 && !a.q8.every((x) => next.includes(x))) delete a.q8;
      return a;
    });
  }
  function toggleMulti(q: Extract<StudentQuestion, { kind: "multi" | "ranked" }>, id: string) {
    const cur = answers[q.id] ?? [];
    if (cur.includes(id)) return setAns(q, cur.filter((x) => x !== id));
    if (cur.length >= q.max) return;
    setAns(q, [...cur, id]);
  }

  async function handleSave() {
    if (!complete || saving || inFlight.current) return;
    inFlight.current = true; setSaving(true); setError(null);
    try {
      const key = JSON.stringify(answers);
      if (!requestRef.current || requestRef.current.key !== key) requestRef.current = { id: crypto.randomUUID(), key };
      const r = await submit(answers, requestRef.current.id);
      if (!r.success) { setError(r.message); return; }
      router.push(resultHref);
    } catch {
      setError(UNCERTAIN_ERROR.message);
    } finally {
      inFlight.current = false; setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {notices.length > 0 && (
        <div className="rounded-2xl border border-line bg-surface2 px-4 py-3 text-[13.5px] leading-relaxed text-charcoal">
          {notices.map((l) => <p key={l} className="mt-1 first:mt-0">{l}</p>)}
        </div>
      )}
      <p className="text-[13px] leading-relaxed text-charcoal">
        実績や経験を聞く質問はありません。「想像してどう感じるか」でお答えください。正解はなく、点数もつけません。
      </p>
      {STUDENT_QUESTIONS.map((q, idx) => {
        const showTitle = idx === 0 || SECTION_TITLE[q.section] !== SECTION_TITLE[STUDENT_QUESTIONS[idx - 1].section];
        const sel = answers[q.id] ?? [];
        if (q.kind === "focus" && !(answers[q.of]?.length)) return null;
        const options = q.kind === "focus"
          ? (STUDENT_QUESTIONS.find((x) => x.id === q.of) as Extract<StudentQuestion, { kind: "multi" }>).options.filter((o) => answers[q.of]?.includes(o.id))
          : q.options;
        return (
          <section key={q.id} className="rounded-2xl border border-line bg-surface p-5">
            {showTitle && <p className="eyebrow mb-2">{SECTION_TITLE[q.section]}</p>}
            <h2 className="text-[14.5px] font-bold leading-relaxed text-ink">{q.text}</h2>
            <div role={q.kind === "single" || q.kind === "focus" ? "radiogroup" : "group"} aria-label={q.text} className="mt-3 grid gap-2">
              {options.map((o) => {
                const on = sel.includes(o.id);
                const order = q.kind === "ranked" && on ? sel.indexOf(o.id) + 1 : null;
                return (
                  <button
                    key={o.id} type="button" disabled={saving}
                    role={q.kind === "single" || q.kind === "focus" ? "radio" : "checkbox"} aria-checked={on}
                    onClick={() => (q.kind === "single" || q.kind === "focus" ? setAns(q, on && q.kind === "focus" ? [] : [o.id]) : toggleMulti(q, o.id))}
                    className={`min-h-[44px] rounded-xl border px-4 py-2.5 text-left text-[13.5px] leading-snug disabled:opacity-60 ${on ? "border-ink bg-ink text-surface" : "border-line bg-surface text-charcoal"}`}
                  >
                    {order ? `${order}. ` : ""}{o.label}
                  </button>
                );
              })}
            </div>
            {(q.kind === "multi" || q.kind === "ranked") && (
              <p className="mt-2 text-[12px] text-sub">{q.kind === "ranked" ? `選んだ順が優先順位になります（${q.max}つまで）。` : `${q.max}つまで選べます${q.min === 0 ? "（任意）" : ""}。`}</p>
            )}
          </section>
        );
      })}

      {error && <div role="alert" className="rounded-xl border border-line bg-surface2 p-4 text-[13px] leading-relaxed text-ink">{error}</div>}
      <div className="flex flex-col items-center gap-3">
        <button type="button" onClick={handleSave} disabled={!complete || saving}
          className="flex w-full items-center justify-center rounded-full bg-ink px-6 py-4 text-[15px] font-semibold text-surface disabled:opacity-50">
          {saving ? "保存しています…" : "結果を見る"}
        </button>
        {!complete && <p className="text-[12px] text-sub">すべての質問に答えると進めます。</p>}
        <Link href={cancelHref} className="inline-flex min-h-[44px] items-center text-[13px] text-sub underline">あとで答える</Link>
      </div>
    </div>
  );
}
