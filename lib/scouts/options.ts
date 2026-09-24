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

export const SCOUT_RESPONSE_OPTIONS = [
  { value: "interested", label: "話を聞いてみたい" },
  { value: "question", label: "条件をもう少し知りたい" },
  { value: "considering", label: "今は検討中" },
  { value: "declined", label: "今回は見送る" },
] as const;

export type ScoutResponseType = (typeof SCOUT_RESPONSE_OPTIONS)[number]["value"];

export const SCOUT_RESPONSE_LABELS: Record<string, string> = {
  no_response: "未回答",
  interested: "話を聞いてみたい",
  question: "条件をもう少し知りたい",
  considering: "今は検討中",
  declined: "今回は見送る",
  expired: "期限切れ",
};
