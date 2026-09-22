"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveSalonCultureStep } from "@/lib/salon-culture/actions";
import { FivePointScale } from "@/components/shared/five-point-scale";
import { ValuePrioritySelector } from "@/components/profile/value-priority-selector";
import { TextareaField } from "@/components/profile/textarea-field";
import { SALON_VALUE_PRIORITY_OPTIONS } from "@/lib/validation/profile-options";
import type { Database } from "@/types/database";

/**
 * ★0009で新12問(5段階評価)へ再構築。旧5問(q1_new_hire_mistake等)は
 * このAnswers型・このウィザードからは完全に置き換わる（旧の回答キー名は
 * 新規保存では使わない）。既存ユーザーで旧データのまま（新12問に未回答）の
 * salon_culture_profiles行は、このウィザードを開いて新規に回答するまでは
 * 一切変更されない（DB側のRPCが上書きするのは、本人が実際に保存操作を
 * 行った場合のみ）。
 */
type Answers = {
  q1_education_support?: number;
  q2_challenge_openness?: number;
  q3_personal_brand_support?: number;
  q4_team_collaboration?: number;
  q5_individual_autonomy?: number;
  q6_work_flexibility?: number;
  q7_technical_specialization?: number;
  q8_premium_value?: number;
  q9_trend_orientation?: number;
  q10_creative_output?: number;
  q11_relationship_distance?: number;
  q12_hierarchy_flatness?: number;
};

type RespondentRole = Database["public"]["Enums"]["salon_culture_respondent_role"];

type Props = {
  initialProfile: Database["public"]["Tables"]["salon_culture_profiles"]["Row"] | null;
};

// ★回答者選択ステップは廃止した（新12問はいずれも回答者による文言分岐が
// 無いため、選択自体が機能しておらず、14ステップの構成に含まれない
// 余計な1ステップになっていた）。DB・RPCのスキーマ（respondent_role列・
// p_respondent_roleパラメータ）自体は変更しないため、固定値を自動的に
// 送信する（ユーザーへは表示・選択させない）。
const DEFAULT_RESPONDENT_ROLE: RespondentRole = "owner_representative";

/**
 * 12問の定義。answersKeyでAnswers型のキーと1:1対応させる。
 * 文言は指示いただいたものをそのまま使用（言い換え・要約はしていない）。
 */
const QUESTIONS: {
  key: keyof Answers;
  title: string;
  leftLabel: string;
  rightLabel: string;
}[] = [
  {
    key: "q1_education_support",
    title: "若手スタッフが新しい技術を身につけるとき、実際のサロンの関わり方に近いのは？",
    leftLabel: "本人のペースや自主性を尊重する",
    rightLabel: "計画・練習・フォローまでサロンが積極的に支援する",
  },
  {
    key: "q2_challenge_openness",
    title: "スタッフから「新しい技術や取り組みをやってみたい」という提案があったとき、実際の対応に近いのは？",
    leftLabel: "実績やリスクを確認し、十分検討してから進める",
    rightLabel: "まず挑戦できる方法を一緒に考える",
  },
  {
    key: "q3_personal_brand_support",
    title: "スタッフが自分のSNSや指名客づくりに力を入れたい場合、サロンのスタンスは？",
    leftLabel: "サロン全体のブランド・集客を中心にする",
    rightLabel: "個人の発信・指名・ブランドづくりも積極的に支援する",
  },
  {
    key: "q4_team_collaboration",
    title: "忙しい時間帯のスタッフ同士の働き方として、実際に近いのは？",
    leftLabel: "各自が自分のお客様・仕事を中心に動く",
    rightLabel: "担当を越えて声を掛け合い、チームで助け合う",
  },
  {
    key: "q5_individual_autonomy",
    title: "日々の仕事の進め方について、実際のサロンに近いのは？",
    leftLabel: "サロン共通のルール・やり方を重視する",
    rightLabel: "基本方針の中で、一人ひとりの判断ややり方を尊重する",
  },
  {
    key: "q6_work_flexibility",
    title: "勤務日数・時間・休みなどについてスタッフから希望があった場合、実際の対応に近いのは？",
    leftLabel: "基本的にサロンの勤務体系を優先する",
    rightLabel: "できるだけ個々の事情や生活に合わせて調整する",
  },
  {
    key: "q7_technical_specialization",
    title: "サロンの技術づくりとして、実際に近い方向は？",
    leftLabel: "幅広いお客様・メニューに対応できることを重視する",
    rightLabel: "特定分野でも高い専門性・技術品質を追求する",
  },
  {
    key: "q8_premium_value",
    title: "価格と提供価値について、サロンが目指している方向に近いのは？",
    leftLabel: "通いやすい価格と利用しやすさを重視する",
    rightLabel: "価格が高くても選ばれる、高い価値・品質を重視する",
  },
  {
    key: "q9_trend_orientation",
    title: "新しいスタイルや技術が話題になったとき、サロンの動きに近いのは？",
    leftLabel: "定着度や再現性を確認してから取り入れる",
    rightLabel: "早い段階から試し、積極的に取り入れる",
  },
  {
    key: "q10_creative_output",
    title: "撮影やSNSなど、サロンからの美容発信について実際に近いのは？",
    leftLabel: "必要な情報やスタイルを中心に発信する",
    rightLabel: "撮影・SNSなどで、新しいスタイルや世界観を積極的に発信する",
  },
  {
    key: "q11_relationship_distance",
    title: "スタッフ同士の仕事以外での関係性として、実際に近いのは？",
    leftLabel: "仕事とプライベートは分けることが多い",
    rightLabel: "仕事以外でも交流することが多い",
  },
  {
    key: "q12_hierarchy_flatness",
    title: "店長・先輩・後輩などの関係性として、実際に近いのは？",
    leftLabel: "役割や立場、上下関係が比較的はっきりしている",
    rightLabel: "立場に関係なく意見を言いやすい",
  },
];

// 0: 回答者選択, 1〜12: Q1〜Q12, 13: value_priorities, 14: comment
// 0〜11: Q1〜Q12（12問）, 12: value_priorities, 13: comment。合計14ステップ。
const TOTAL_STEPS = QUESTIONS.length + 2;
const VALUE_PRIORITIES_STEP = QUESTIONS.length; // 12
const COMMENT_STEP = VALUE_PRIORITIES_STEP + 1; // 13

/**
 * 「サロンらしさ」入力ウィザード（0009: 新12問・5段階評価へ再構築）。
 *
 * ★診断クイズ・美容師オンボーディングとは異なり、各ステップの遷移時に
 * saveSalonCultureStep()を直接呼び、都度DBへ保存する（true partial save）。
 * これにより、途中で離脱してもブラウザを閉じても回答内容が失われない。
 *
 * 質問はすべて「今、実際にどうしているか」（current_culture）のみで構成し、
 * 理想・将来像（aspired_culture）は今回実装しない。
 */
export function SalonCultureWizard({ initialProfile }: Props) {
  const router = useRouter();
  // ★原因Cの修正: 新12問への再構築でステップ番号の意味が変わったため、
  // 旧フロー時代（?edit=1でアクセスされる既存ユーザーを含む）に保存された
  // current_stepの値を、そのまま新しいステップ番号として使うと、質問が
  // 途中から始まってしまい一部の質問が一度も表示・回答されないまま
  // 「完了する」まで進めてしまう不具合があった。常に0（Q1）から開始する
  // ことで、この不整合を避ける。既に回答済みの内容自体は下記のとおり
  // answers/valuePriorities/commentのstateとして正しく復元されるため、
  // 既回答の質問は選択済み状態で表示され、ユーザーは「次へ」で素早く
  // 進められる。
  const [step, setStep] = useState(0);
  // ★回答者選択ステップは廃止したため、respondentRoleは固定値を自動的に
  // 保持する（DB・RPCのスキーマは変更していないため、有効な値を送り続ける
  // 必要がある）。
  const [respondentRole] = useState<RespondentRole>(
    initialProfile?.respondent_role ?? DEFAULT_RESPONDENT_ROLE,
  );
  const [answers, setAnswers] = useState<Answers>((initialProfile?.answers as Answers) ?? {});
  const [valuePriorities, setValuePriorities] = useState<string[]>(initialProfile?.value_priorities ?? []);
  const [comment, setComment] = useState(initialProfile?.comment ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function persist(status: "draft" | "completed", nextStep: number) {
    setSaving(true);
    setError(null);
    const result = await saveSalonCultureStep({
      status,
      respondentRole,
      currentStep: nextStep,
      answers,
      valuePriorities,
      comment,
    });
    setSaving(false);

    if (!result.success) {
      setError(result.error);
      return false;
    }
    return true;
  }

  // 0〜11がQ1〜Q12に対応（回答者選択ステップを廃止したため、stepとQUESTIONSの
  // インデックスがそのまま一致する）。
  const isQuestionStep = step >= 0 && step < QUESTIONS.length;
  const currentQuestion = isQuestionStep ? QUESTIONS[step] : null;

  async function handleNext() {
    // ステップごとの簡易な必須チェック（未回答のまま進めない）。
    if (currentQuestion && answers[currentQuestion.key] == null) {
      setError("回答してください");
      return;
    }
    if (step === VALUE_PRIORITIES_STEP && valuePriorities.length !== 3) {
      setError("重要な項目を3つ選択してください");
      return;
    }

    const nextStep = Math.min(step + 1, TOTAL_STEPS - 1);
    const ok = await persist("draft", nextStep);
    if (ok) setStep(nextStep);
  }

  function handleBack() {
    setError(null);
    setStep((s) => Math.max(s - 1, 0));
  }

  async function handleComplete() {
    const ok = await persist("completed", step);
    if (ok) router.push("/salon/culture/result");
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

      {currentQuestion && (
        <div>
          <h2 className="font-serif text-xl font-bold leading-snug text-ink">{currentQuestion.title}</h2>
          <div className="mt-6">
            <FivePointScale
              leftLabel={currentQuestion.leftLabel}
              rightLabel={currentQuestion.rightLabel}
              value={answers[currentQuestion.key]}
              onChange={(v) => setAnswers((a) => ({ ...a, [currentQuestion.key]: v }))}
              disabled={saving}
              note="どちらも良し悪しではなく、サロンの特徴です"
            />
          </div>
        </div>
      )}

      {step === VALUE_PRIORITIES_STEP && (
        <div>
          <h2 className="font-serif text-xl font-bold text-ink">
            今、実際に大切にしている価値観トップ3は？
          </h2>
          <div className="mt-5">
            <ValuePrioritySelector
              name="valuePriorities"
              label=""
              options={SALON_VALUE_PRIORITY_OPTIONS}
              defaultValues={valuePriorities}
              onChange={setValuePriorities}
            />
          </div>
        </div>
      )}

      {step === COMMENT_STEP && (
        <div>
          <h2 className="font-serif text-xl font-bold text-ink">今のサロンの雰囲気を一言で（任意）</h2>
          <div className="mt-5">
            <TextareaField
              id="comment"
              name="comment"
              label=""
              required={false}
              defaultValue={comment}
              maxLength={500}
              onChange={setComment}
            />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={handleBack}
          disabled={step === 0 || saving}
          className="text-[13px] font-semibold text-sub underline disabled:opacity-0"
        >
          戻る
        </button>

        {step < TOTAL_STEPS - 1 ? (
          <button
            type="button"
            onClick={handleNext}
            disabled={saving}
            className="flex items-center justify-center rounded-full bg-ink px-8 py-3 text-[14px] font-semibold text-surface disabled:opacity-60"
          >
            {saving ? "保存中..." : "次へ"}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleComplete}
            disabled={saving}
            className="flex items-center justify-center rounded-full bg-ink px-8 py-3 text-[14px] font-semibold text-surface disabled:opacity-60"
          >
            {saving ? "保存中..." : "完了する"}
          </button>
        )}
      </div>
    </div>
  );
}
