import { BASE_KEYS, changedBaseKeys, extractBaseAnswers, extractSupplementAnswers, SUPPLEMENT_KEYS, type BaseAnswers, type SupplementAnswers } from "@/lib/salon-culture/analysis/v1";

/**
 * サロンらしさの「途中回答（下書き）」の形と、画面側の判定（純粋関数）。
 * DB（0058: salon_culture_drafts.payload）の形: {respondent_role, current_step, answers{q1..q12}, value_priorities[], comment, extra{version, answers{q13..q17}}|null}
 * 公開中の結果（salon_culture_profiles / salon_store_culture_profiles）とは別に保存され、確定するまで公開結果は変わらない。
 */
export type CultureAnswers = Record<string, number | undefined>;

/**
 * 「この内容で確認しました」の記録。確認した時点の基本5問と追加5問をそのまま持つ。
 * 値が1つでも変わると無効（値の比較で決めるので、確認済みフラグだけが残ることはない）。
 * 下書きから読み戻さない（下書き再開・別タブでは必ず確認し直す）。
 */
export type ExtraAck = { base: BaseAnswers; extra: SupplementAnswers };

export type DraftState = {
  respondentRole: string;
  currentStep: number;
  answers: CultureAnswers;
  valuePriorities: string[];
  comment: string;
  extra: SupplementAnswers | null;
  /**
   * 追加5問の「途中回答」（1〜4問だけ答えた状態）。5問そろっていない回答は公開できないので、完成済みの extra とは別に持つ。
   * 未回答の問は欠けたまま（数値や「当てはまらない」で補わない）。extra が完成しているときは使わない。
   */
  extraPartial?: Partial<SupplementAnswers> | null;
  /** 画面内の確認記録。fromPayload / fromPublished では常に null。 */
  extraAck?: ExtraAck | null;
};

export type DraftPayload = {
  respondent_role: string;
  current_step: number;
  answers: CultureAnswers;
  value_priorities: string[];
  comment: string;
  extra: { version: string; answers: SupplementAnswers; acknowledged?: ExtraAck } | null;
  /** 途中回答。DBの確定処理は extra だけを読むため、ここに入れた値が公開されることはない（既存RPCと互換）。 */
  extra_partial?: { version: string; answers: Partial<SupplementAnswers> };
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
    // 確認記録は、いまの回答と一致するときだけ書く（古い確認を下書きへ残さない）。
    extra: s.extra ? { version, answers: s.extra, ...(extraAckValid(s) && s.extraAck ? { acknowledged: s.extraAck } : {}) } : null,
    ...(!s.extra && countPartial(s.extraPartial) > 0 ? { extra_partial: { version, answers: cleanPartial(s.extraPartial) } } : {}),
  };
}

export function countPartial(p: Partial<SupplementAnswers> | null | undefined): number {
  return p ? SUPPLEMENT_KEYS.filter((k) => p[k] != null).length : 0;
}

/** 有効な値（1〜5 / "na"）だけを残す。それ以外は捨てる（補完しない）。 */
export function cleanPartial(raw: unknown): Partial<SupplementAnswers> {
  const out: Partial<SupplementAnswers> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const k of SUPPLEMENT_KEYS) {
    const v = (raw as Record<string, unknown>)[k];
    if (v === "na") out[k] = "na";
    else if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5) out[k] = v as SupplementAnswers[typeof k];
  }
  return out;
}

/** 確認記録が、いまの基本5問・追加5問と完全に一致しているか。 */
export function extraAckValid(s: Pick<DraftState, "answers" | "extra" | "extraAck">): boolean {
  if (!s.extraAck || !s.extra) return false;
  const base = extractBaseAnswers(s.answers);
  if (!base) return false;
  return JSON.stringify(sortKeys(s.extraAck.base)) === JSON.stringify(sortKeys(base)) &&
    JSON.stringify(sortKeys(s.extraAck.extra)) === JSON.stringify(sortKeys(s.extra));
}

function sortKeys(o: object): object {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
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
  const partialRaw = p.extra_partial && typeof p.extra_partial === "object" ? (p.extra_partial as Record<string, unknown>).answers : null;
  const extraComplete = extraRaw ? extractSupplementAnswers(extraRaw) : null;
  const partial = extraComplete ? {} : cleanPartial(partialRaw);
  return {
    respondentRole: typeof p.respondent_role === "string" ? p.respondent_role : DEFAULT_RESPONDENT_ROLE,
    currentStep: typeof p.current_step === "number" ? p.current_step : 0,
    answers,
    valuePriorities: Array.isArray(p.value_priorities) ? p.value_priorities.filter((x): x is string => typeof x === "string") : [],
    comment: typeof p.comment === "string" ? p.comment : "",
    extra: extraComplete,
    extraPartial: countPartial(partial) > 0 ? partial : null,
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
  /** 公開中の追加5問を答えた時点の基本5問（base_snapshot）。無ければ null（公開中の回答で代用しない）。 */
  publishedExtraBase?: unknown;
}): { changed: boolean; extraRequired: boolean; extraAckNeeded: boolean; extraAckRequired: boolean; extraFirst: boolean; initial: boolean } {
  const { hasPublished, draft, publishedAnswers, publishedExtra } = args;
  if (!hasPublished) return { changed: true, extraRequired: false, extraAckNeeded: false, extraAckRequired: false, extraFirst: false, initial: true };
  const same12 = answersSameAsPublished(draft.answers, publishedAnswers);
  let changed = !same12;
  let extraRequired = false;
  let extraAckNeeded = false;
  let extraAckRequired = false;
  let extraFirst = false;
  if (publishedExtra) {
    if (baseFiveChanged(draft.answers, publishedAnswers) && !draft.extra) extraRequired = true;
    const extraEdited = !!draft.extra && JSON.stringify(sortKeys(draft.extra)) !== JSON.stringify(sortKeys(publishedExtra));
    if (extraEdited) changed = true;
    // 追加回答を答えたときの基本5問と、いまの基本5問が違うのに、追加回答を直していない → 明示的な確認が必要。
    // （公開中の回答との差ではなく、追加回答の基準との差で見る。古い状態の追加回答を黙って組み合わせない）
    const base = extractBaseAnswers(draft.answers);
    const snapshotDiffers = args.publishedExtraBase !== undefined
      ? !base || changedBaseKeys(args.publishedExtraBase, base).length > 0
      : baseFiveChanged(draft.answers, publishedAnswers);
    // Needed: 確認が要る状況（確認済みでも表示は残す）。Required: 要るのに、いまの値に対する確認が済んでいない。
    extraAckNeeded = !!draft.extra && !extraEdited && snapshotDiffers;
    extraAckRequired = extraAckNeeded && !extraAckValid(draft);
  } else if (!changed && draft.extra) {
    extraFirst = true;
  }
  return { changed, extraRequired, extraAckNeeded, extraAckRequired, extraFirst, initial: false };
}
