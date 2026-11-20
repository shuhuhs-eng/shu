/**
 * 通知メールの文面（日本語）。方針:
 *  ・「希望が届いた」「連絡があった」ことだけを伝える。見学・体験入店の日程や参加、採用が決まったとは書かない。
 *  ・本文に個人名・メッセージ本文・条件などの中身は入れない（件名・本文とも固定文＋リンク）。詳細はログイン後の画面で見る。
 *  ・取消の訂正連絡は「先に届いたお知らせは取り消された」ことだけを伝える。
 * キーは DB の email_template_keys() と一致させる（テストで確認）。cancel_ 付きは訂正連絡用。
 */
export const NOTICE_KEYS = [
  "interest_visit", "interest_trial", "interest_generic",
  "scout_received", "scout_reply_visit", "scout_reply_trial", "scout_reply_other",
  "hiring_interview", "hiring_interview_changed", "hiring_update",
  "message_received", "message_reply_received",
  "offer_update", "evidence_update", "age_disclosure_update", "action_required",
] as const;
export type NoticeKey = (typeof NOTICE_KEYS)[number];

type Body = { subject: string; lines: string[]; cta: string };
const FOOT = "このメールに心当たりがない場合や、通知の受け取りを止めたい場合は、サービスの画面からお問い合わせください。";

const NOTICE: Record<NoticeKey, Body> = {
  interest_visit: { subject: "【Beauty Reach】店舗の詳細から「見学を希望する」が届きました", lines: ["店舗の詳細ページから、見学を希望する連絡が届きました。", "日程や参加はまだ確定していません。内容の確認は、ログイン後の画面から行えます。"], cta: "画面で確認する" },
  interest_trial: { subject: "【Beauty Reach】店舗の詳細から「体験入店を希望する」が届きました", lines: ["店舗の詳細ページから、体験入店を希望する連絡が届きました。", "日程や参加はまだ確定していません。内容の確認は、ログイン後の画面から行えます。"], cta: "画面で確認する" },
  interest_generic: { subject: "【Beauty Reach】店舗への希望が届きました", lines: ["店舗の詳細ページから、希望の連絡が届きました。", "内容の確認は、ログイン後の画面から行えます。"], cta: "画面で確認する" },
  scout_received: { subject: "【Beauty Reach】新しいスカウトが届いています", lines: ["サロンからスカウトが届きました。", "内容の確認と返信は、ログイン後の画面から行えます。"], cta: "画面で確認する" },
  scout_reply_visit: { subject: "【Beauty Reach】スカウトへの返信（見学の希望）が届きました", lines: ["送ったスカウトに、見学を希望する返信が届きました。", "日程や参加はまだ確定していません。内容の確認は、ログイン後の画面から行えます。"], cta: "画面で確認する" },
  scout_reply_trial: { subject: "【Beauty Reach】スカウトへの返信（体験入店の希望）が届きました", lines: ["送ったスカウトに、体験入店を希望する返信が届きました。", "日程や参加はまだ確定していません。内容の確認は、ログイン後の画面から行えます。"], cta: "画面で確認する" },
  scout_reply_other: { subject: "【Beauty Reach】スカウトへの返信が届きました", lines: ["送ったスカウトに返信が届きました。", "内容の確認は、ログイン後の画面から行えます。"], cta: "画面で確認する" },
  hiring_interview: { subject: "【Beauty Reach】面接に関するお知らせがあります", lines: ["面接に関するお知らせが届いています。", "詳細の確認と必要な操作は、ログイン後の画面から行えます。"], cta: "画面で確認する" },
  hiring_interview_changed: { subject: "【Beauty Reach】面接の日程に変更があります", lines: ["面接の日程に関するお知らせが届いています。", "詳細の確認と必要な操作は、ログイン後の画面から行えます。"], cta: "画面で確認する" },
  hiring_update: { subject: "【Beauty Reach】進捗に関するお知らせがあります", lines: ["採用の進捗に関するお知らせが届いています。", "内容の確認は、ログイン後の画面から行えます。"], cta: "画面で確認する" },
  // 運営との連絡（既存のメッセージ機能）。件名・本文の中身は載せない。
  message_received: { subject: "【Beauty Reach】画面に連絡があります", lines: ["Beauty Reach の画面に連絡があります。", "内容の確認と返信は、ログイン後の画面から行えます。"], cta: "画面で確認する" },
  message_reply_received: { subject: "【Beauty Reach】画面に返信があります", lines: ["連絡への返信が届いています。", "内容の確認は、ログイン後の画面から行えます。"], cta: "画面で確認する" },
  // 条件・実績・年齢開示に関わるものは、種類も中身も書かず「連絡がある」ことだけ伝える。
  offer_update: { subject: "【Beauty Reach】画面に連絡があります", lines: ["Beauty Reach の画面に連絡があります。", "内容の確認は、ログイン後の画面から行えます。"], cta: "画面で確認する" },
  evidence_update: { subject: "【Beauty Reach】画面に連絡があります", lines: ["Beauty Reach の画面に連絡があります。", "内容の確認は、ログイン後の画面から行えます。"], cta: "画面で確認する" },
  age_disclosure_update: { subject: "【Beauty Reach】画面に連絡があります", lines: ["Beauty Reach の画面に連絡があります。", "内容の確認は、ログイン後の画面から行えます。"], cta: "画面で確認する" },
  action_required: { subject: "【Beauty Reach】画面に確認が必要な連絡があります", lines: ["Beauty Reach の画面に、確認が必要な連絡があります。", "内容の確認と必要な操作は、ログイン後の画面から行えます。"], cta: "画面で確認する" },
};

const CANCEL_KIND: Partial<Record<NoticeKey, string>> = {
  interest_visit: "「見学を希望する」",
  interest_trial: "「体験入店を希望する」",
  interest_generic: "店舗への希望",
};

export function isNoticeKey(k: string): k is NoticeKey { return (NOTICE_KEYS as readonly string[]).includes(k); }

function jst(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  const f = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(t);
  return f;
}

/**
 * DB上のキー（interest_visit / cancel_interest_visit）→ 件名・本文。未知のキーは null（送らない）。
 * 取消の訂正連絡は「希望が取り消された」ことと「調整中・確定済みの日程は運営へ確認」を伝え、参照用に元の通知の日時を添える。
 * （日程が確定したとは書かない。取消でも既に調整が進んでいる場合があるため、運営への確認を案内する。）
 */
export function renderMail(templateKey: string, linkUrl: string, opts: { notifiedAt?: string | null } = {}): { subject: string; text: string } | null {
  const isCancel = templateKey.startsWith("cancel_");
  const base = isCancel ? templateKey.slice("cancel_".length) : templateKey;
  if (!isNoticeKey(base)) return null;
  if (isCancel) {
    const kind = CANCEL_KIND[base];
    if (!kind) return null; // 取消の訂正連絡は直接希望のみ対象
    const when = jst(opts.notifiedAt);
    const ref = when ? `（参照: ${when}頃にお送りした通知）` : "";
    return {
      subject: "【Beauty Reach】先にお送りした通知の希望が取り消されました",
      text: [
        `先にお送りした${kind}の通知について、希望が取り消されました。${ref}`,
        "すでに調整中・確定済みの日程がある場合は、運営へご確認ください。",
        "最新の状況は、ログイン後の画面で確認できます。",
        "",
        linkUrl,
        "",
        FOOT,
      ].join("\n"),
    };
  }
  const t = NOTICE[base];
  return { subject: t.subject, text: [...t.lines, "", `${t.cta}: ${linkUrl}`, "", FOOT].join("\n") };
}

/** サイトの絶対URL＋パス。パスは「/」始まりの相対パスのみ許可（外部URLへ誘導しない）。 */
export function buildLink(siteUrl: string, linkPath: string | null | undefined): string | null {
  const base = siteUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/]+$/.test(base)) return null;
  const p = (linkPath ?? "").trim();
  if (!p.startsWith("/") || p.startsWith("//") || /[\s\\]/.test(p)) return null;
  return base + p;
}
