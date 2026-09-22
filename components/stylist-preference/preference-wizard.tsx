"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveStylistPreferenceStep } from "@/lib/stylist-preference/actions";
import { FivePointScale } from "@/components/shared/five-point-scale";
import type { Database } from "@/types/database";

/**
 * 美容師「働きたいサロン環境」Preference診断（8問・5段階評価）。
 *
 * ★既存の30問美容師診断（才能診断）とは完全に別物。混同を避けるため、
 * 30問診断のUI（components/diagnosis/diagnosis-quiz.tsx）とは別コンポーネント
 * として独立させている。結果タイプ・相性％・キャラクター等は一切表示しない
 * （今回はまだ実装しない）。
 *
 * ★components/salon-culture/salon-culture-wizard.tsxと対称構造。ただし
 * サロンらしさと異なり、回答者選択・value_priorities・commentのステップは
 * 無く、8問のみで完結する。完了後は結果ページを作らず /stylist/mypage へ
 * 戻る（マイページ側で「回答済み」であることが分かれば十分という方針のため）。
 */

type Answers = {
  q1_education_preference?: number;
  q2_challenge_preference?: number;
  q3_personal_brand_preference?: number;
  q4_collaboration_preference?: number;
  q5_autonomy_preference?: number;
  q6_work_flexibility_preference?: number;
  q7_relationship_distance_preference?: number;
  q8_hierarchy_preference?: number;
};

type Props = {
  initialProfile: Database["public"]["Tables"]["stylist_preference_profiles"]["Row"] | null;
};

/** 8問の定義。answersKeyでAnswers型のキーと1:1対応させる。文言は指定されたものをそのまま使用。 */
const QUESTIONS: {
  key: keyof Answers;
  title: string;
  leftLabel: string;
  rightLabel: string;
}[] = [
  {
    key: "q1_education_preference",
    title: "美容師として成長していく上で、あなたが働きやすいと感じる環境に近いのは？",
    leftLabel: "自分のペースで学び、必要なときに相談したい",
    rightLabel: "教育計画や練習、フォローまでしっかり支援してほしい",
  },
  {
    key: "q2_challenge_preference",
    title: "新しい技術や取り組みに挑戦するとき、あなたが働きやすいと感じる環境は？",
    leftLabel: "実績やリスクを確認しながら慎重に進めたい",
    rightLabel: "新しい挑戦を積極的に応援してほしい",
  },
  {
    key: "q3_personal_brand_preference",
    title: "SNSや指名客づくりについて、あなたが働きやすいと感じる環境は？",
    leftLabel: "サロンのブランドや集客を活かして働きたい",
    rightLabel: "自分の発信・指名・ブランドづくりも積極的に支援してほしい",
  },
  {
    key: "q4_collaboration_preference",
    title: "忙しい時間帯のスタッフ同士の働き方として、あなたが働きやすいと感じる環境は？",
    leftLabel: "それぞれが自分のお客様・仕事を中心に動きたい",
    rightLabel: "担当を越えて声を掛け合い、チームで助け合いたい",
  },
  {
    key: "q5_autonomy_preference",
    title: "日々の仕事の進め方について、あなたが働きやすいと感じる環境は？",
    leftLabel: "サロン共通のルールややり方が明確な方が働きやすい",
    rightLabel: "基本方針の中で、自分の判断ややり方を尊重してほしい",
  },
  {
    key: "q6_work_flexibility_preference",
    title: "勤務時間・休み・働き方について、あなたが働きやすいと感じる環境は？",
    leftLabel: "勤務体系が明確に決まっている方が働きやすい",
    rightLabel: "自分の事情や生活に合わせて柔軟に調整できる方が働きやすい",
  },
  {
    key: "q7_relationship_distance_preference",
    title: "スタッフ同士の仕事以外での関係性について、あなたが心地よいと感じる環境は？",
    leftLabel: "仕事とプライベートは分けたい",
    rightLabel: "仕事以外でも自然に交流できる関係が好き",
  },
  {
    key: "q8_hierarchy_preference",
    title: "店長・先輩・後輩などの関係性について、あなたが働きやすいと感じる環境は？",
    leftLabel: "役割や立場が明確な方が働きやすい",
    rightLabel: "立場に関係なく意見を言いやすい方が働きやすい",
  },
];

const TOTAL_STEPS = QUESTIONS.length; // 8

export function StylistPreferenceWizard({ initialProfile }: Props) {
  const router = useRouter();
  // ステップ番号は常に0（Q1）から開始する（サロンらしさ側の不具合修正と同じ
  // 理由: 保存済みcurrent_stepをそのまま再利用すると、途中の質問が一度も
  // 表示されないまま進んでしまうリスクがあるため）。既に回答済みの内容は
  // 下記のとおりanswersのstateとして正しく復元されるため、既回答の質問は
  // 選択済み状態で表示され、ユーザーは「次へ」で素早く進められる。
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>((initialProfile?.answers as Answers) ?? {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentQuestion = QUESTIONS[step];

  async function persist(status: "draft" | "completed", nextStep: number) {
    setSaving(true);
    setError(null);
    const result = await saveStylistPreferenceStep({
      status,
      currentStep: nextStep,
      answers,
    });
    setSaving(false);

    if (!result.success) {
      setError(result.error);
      return false;
    }
    return true;
  }

  async function handleNext() {
    if (answers[currentQuestion.key] == null) {
      setError("回答してください");
      return;
    }

    if (step === TOTAL_STEPS - 1) {
      // 最終問。completedとして保存し、結果ページは作らず
      // マイページへ戻る（マイページ側で「回答済み」表示になる）。
      const ok = await persist("completed", step);
      if (ok) router.push("/stylist/mypage");
      return;
    }

    const nextStep = step + 1;
    const ok = await persist("draft", nextStep);
    if (ok) setStep(nextStep);
  }

  function handleBack() {
    setError(null);
    setStep((s) => Math.max(s - 1, 0));
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="eyebrow">
            {step + 1} / {TOTAL_STEPS}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface2">
          <div
            className="h-full rounded-full bg-ink transition-all"
            style={{ width: `${((step + 1) / TOTAL_STEPS) * 100}%` }}
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-[#C24545]/30 bg-[#C24545]/10 px-4 py-3 text-[13px] text-[#8A2E2E]">
          {error}
        </p>
      )}

      <div>
        <h2 className="font-serif text-xl font-bold leading-snug text-ink">{currentQuestion.title}</h2>
        <div className="mt-6">
          <FivePointScale
            leftLabel={currentQuestion.leftLabel}
            rightLabel={currentQuestion.rightLabel}
            value={answers[currentQuestion.key]}
            onChange={(v) => setAnswers((a) => ({ ...a, [currentQuestion.key]: v }))}
            disabled={saving}
            note="どちらも良し悪しではなく、働き方の好みです"
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={handleBack}
          disabled={step === 0 || saving}
          className="text-[13px] font-semibold text-sub underline disabled:opacity-0"
        >
          戻る
        </button>

        <button
          type="button"
          onClick={handleNext}
          disabled={saving}
          className="flex items-center justify-center rounded-full bg-ink px-8 py-3 text-[14px] font-semibold text-surface disabled:opacity-60"
        >
          {saving ? "保存中..." : step === TOTAL_STEPS - 1 ? "完了する" : "次へ"}
        </button>
      </div>
    </div>
  );
}
