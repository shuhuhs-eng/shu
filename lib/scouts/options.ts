export const SCOUT_TEMPLATES = {
  casual: {
    label: "カジュアル型",
    text: "プロフィールを拝見し、当サロンとの相性が高いと感じスカウトをお送りしました。まずは転職を前提とせず、サロンについて気軽にお話しできればと思っています。",
  },
  concrete: {
    label: "具体提案型",
    text: "プロフィールやご希望条件を拝見し、当サロンの働き方や環境との相性が良いと感じました。ご興味がありましたら、具体的な働き方や条件についてお話しさせてください。",
  },
} as const;

export type ScoutTemplateType = keyof typeof SCOUT_TEMPLATES;

// 美容師が送れる返信の選択肢。「話を聞いてみたい」(interested) は新規には送れない（過去の返信としてのみ表示。見学・体験入店へ読み替えない）。
export const SCOUT_RESPONSE_OPTIONS = [
  { value: "visit_requested", label: "見学を希望する" },
  { value: "trial_requested", label: "体験入店を希望する" },
  { value: "question", label: "条件をもう少し知りたい" },
  { value: "considering", label: "今は検討中" },
  { value: "declined", label: "今回は見送る" },
] as const;

export type ScoutResponseType = (typeof SCOUT_RESPONSE_OPTIONS)[number]["value"];

// ★サロン側・美容師側で表示を完全に統一するため、response_statusの
// 日本語ラベルはこの1箇所だけで管理する（複製しない）。
export const SCOUT_RESPONSE_LABELS: Record<string, string> = {
  no_response: "回答待ち",
  visit_requested: "見学を希望する",
  trial_requested: "体験入店を希望する",
  interested: "話を聞いてみたい（以前の返信）",
  question: "条件をもう少し知りたい",
  considering: "今は検討中",
  declined: "今回は見送る",
  expired: "期限切れ",
};

/** 店舗が採用進捗に追加できる「前向きな返信」。見学・体験入店の希望も含む（日程・参加は未確定）。DB（add_hiring_candidate）と同じ集合。 */
export const POSITIVE_SCOUT_RESPONSES = ["visit_requested", "trial_requested", "interested", "question"] as const;
export function isPositiveScoutResponse(status: string): boolean {
  return (POSITIVE_SCOUT_RESPONSES as readonly string[]).includes(status);
}
/** 見学・体験入店の希望（日程・参加はまだ確定していない）。 */
export function isVisitOrTrialRequest(status: string): boolean {
  return status === "visit_requested" || status === "trial_requested";
}
