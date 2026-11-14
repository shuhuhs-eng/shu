import { BASE_KEYS, extractBaseAnswers, extractSupplementAnswers, type SupplementAnswers } from "@/lib/salon-culture/analysis/v1";

/**
 * サロンらしさの「途中回答（下書き）」の形と、画面側の判定（純粋関数）。
 * DB（0058: salon_culture_drafts.payload）の形: {respondent_role, current_step, answers{q1..q12}, value_priorities[], comment, extra{version, answers{q13..q17}}|null}
 * 公開中の結果（salon_culture_profiles / salon_store_culture_profiles）とは別に保存され、確定するまで公開結果は変わらない。
 */
export type CultureAnswers = Record<string, number | undefined>;

export type DraftState = {
  respondentRole: string;
  currentStep: number;
  answers: CultureAnswers;
  valuePriorities: string[];
  comment: string;
  extra: SupplementAnswers | null;
};

export type DraftPayload = {
  respondent_role: string;
  current_step: number;
  answers: CultureAnswers;
  value_priorities: string[];
  comment: string;
  extra: { version: string; answers: SupplementAnswers } | null;
};

export const DEFAULT_RESPONDENT_ROLE = "owner_representative";

export const ANSWER_KEYS_12 = [
  "q1_education_support",
  "q2_challenge_openness",
  "q3_personal_brand_support",
  "q4_team_collaboration",
  "q5_individual_autonomy",
  "q6_work_flexibility",
  "q7_technical_specialization",
  "q8_premium_value",
  "q9_trend_orientation",
  "q10_creative_output",
  "q11_relationship_distance",
  "q12_hierarchy_flatness",
] as const;

export function toPayload(s: DraftState, version: string): DraftPayload {
  return {
    respondent_role: s.respondentRole,
    current_step: s.currentStep,
    answers: s.answers,
    value_priorities: s.valuePriorities,
    comment: s.comment,
    extra: s.extra ? { version, answers: s.extra } : null,
  };
}

/** DBの payload を画面用の状態へ。形が違う・欠けている部分は空として扱う（推測で補わない）。 */
export function fromPayload(payload: unknown): DraftState | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  const answers: CultureAnswers = {};
  if (p.answers && typeof p.answers === "object" && !Array.isArray(p.answers)) {
    for (const k of ANSWER_KEYS_12) {
      const v = (p.answers as Record<string, unknown>)[k];
      if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5) answers[k] = v;
    }
  }
  const extraRaw = p.extra && typeof p.extra === "object" ? (p.extra as Record<string, unknown>).answers : null;
  return {
    respondentRole: typeof p.respondent_role === "string" ? p.respondent_role : DEFAULT_RESPONDENT_ROLE,
    currentStep: typeof p.current_step === "number" ? p.current_step : 0,
    answers,
    valuePriorities: Array.isArray(p.value_priorities) ? p.value_priorities.filter((x): x is string => typeof x === "string") : [],
    comment: typeof p.comment === "string" ? p.comment : "",
    extra: extraRaw ? extractSupplementAnswers(extraRaw) : null,
  };
}

/** 公開中の結果の行（または null）を、編集の出発点となる状態へ。 */
export function fromPublished(
  profile: { respondent_role?: string | null; answers?: unknown; value_priorities?: string[] | null; comment?: string | null } | null,
  extraRow: { answers?: unknown } | null,
): DraftState {
  const base = fromPayload({
    respondent_role: profile?.respondent_role ?? DEFAULT_RESPONDENT_ROLE,
    current_step: 0,
    answers: profile?.answers ?? {},
    value_priorities: profile?.value_priorities ?? [],
    comment: profile?.comment ?? "",
  })!;
  return { ...base, extra: extraRow ? extractSupplementAnswers(extraRow.answers) : null };
}

/** 12問の回答が、公開中の結果と同じか（同じなら、確定しても変更として数えない）。 */
export function answersSameAsPublished(draft: CultureAnswers, published: unknown): boolean {
  const pub = fromPayload({ answers: published })?.answers ?? {};
  return ANSWER_KEYS_12.every((k) => draft[k] != null && draft[k] === pub[k]);
}

/** 追加5問に使う5問（q2,q3,q4,q5,q9）が、公開中の結果から変わったか。 */
export function baseFiveChanged(draft: CultureAnswers, published: unknown): boolean {
  const pubBase = extractBaseAnswers(published);
  if (!pubBase) return false;
  return BASE_KEYS.some((k) => draft[k] !== pubBase[k]);
}

/**
 * 確定前の事前判定（案内用。最終判定はDB）。
 *  - extraRequired: 追加5問が回答済みの人が5問を変えたのに、追加5問が下書きにない → 追加5問も答え直す必要がある
 *  - changed: 公開中の結果に対して、12問または追加5問が変わる → 変更として数える
 *  - extraFirst: 12問は同じで、未回答だった追加5問を初めて完成させる → 数えない
 */
export function previewConfirm(args: {
  hasPublished: boolean;
  draft: DraftState;
  publishedAnswers: unknown;
  publishedExtra: SupplementAnswers | null;
}): { changed: boolean; extraRequired: boolean; extraFirst: boolean; initial: boolean } {
  const { hasPublished, draft, publishedAnswers, publishedExtra } = args;
  if (!hasPublished) return { changed: true, extraRequired: false, extraFirst: false, initial: true };
  const same12 = answersSameAsPublished(draft.answers, publishedAnswers);
  let changed = !same12;
  let extraRequired = false;
  let extraFirst = false;
  if (publishedExtra) {
    if (baseFiveChanged(draft.answers, publishedAnswers) && !draft.extra) extraRequired = true;
    if (draft.extra && JSON.stringify(draft.extra) !== JSON.stringify(publishedExtra)) changed = true;
  } else if (!changed && draft.extra) {
    extraFirst = true;
  }
  return { changed, extraRequired, extraFirst, initial: false };
}
