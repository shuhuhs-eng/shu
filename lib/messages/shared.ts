/**
 * 運営⇔サロン・美容師の連絡（0061）で、画面とサーバーが共有する純粋な部品。
 * ★送信ID（request id）は「フォームを描画した時点で1つ作り、同じフォームの再送では同じ値」を使う。
 *   DBが (送信者, 送信ID) で重複を防ぐので、二重クリック・再送でも連絡は1件・通知も1件のまま。
 */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

export const BODY_MAX = 4000;
export const SUBJECT_MAX = 120;

export const STATUS_LABEL: Record<string, string> = {
  open_internal: "運営内部",
  waiting_recipient: "相手の返信待ち",
  waiting_admin: "運営の対応待ち",
  done: "完了",
};
export const REOPEN_STATUSES = ["waiting_recipient", "waiting_admin", "open_internal"] as const;
export const KIND_LABEL: Record<string, string> = {
  to_recipient: "相手に送信",
  from_recipient: "相手からの返信",
  internal_note: "運営内部メモ（相手には見えません）",
  offline_log: "電話・対面などの記録（相手には見えません）",
};
export const DELIVERY_LABEL: Record<string, string> = {
  pending: "通知メール: 未送信（送信設定の確認後に別途）",
  sent: "通知メール: 送信済み",
  failed: "通知メール: 送信失敗",
  skipped: "通知メール: 送らない",
};

export type ParsedText = { ok: true; value: string } | { ok: false; error: string };
/** 本文の前後の空白を除き、空・長すぎを弾く（DBと同じ基準）。 */
export function parseBody(raw: unknown, max = BODY_MAX): ParsedText {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (v.length === 0) return { ok: false, error: "本文を入力してください。" };
  if (v.length > max) return { ok: false, error: `本文は${max}文字以内で入力してください。` };
  return { ok: true, value: v };
}
export function parseSubject(raw: unknown): ParsedText {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (v.length === 0) return { ok: false, error: "件名を入力してください。" };
  if (v.length > SUBJECT_MAX) return { ok: false, error: `件名は${SUBJECT_MAX}文字以内で入力してください。` };
  return { ok: true, value: v };
}

/** DBの例外文言を、利用者向けの日本語へ。内部の詳細は出さない。権限なし・存在しないは区別しない。 */
export function mapMessageError(message: string | null | undefined): string {
  const m = String(message ?? "");
  if (m.includes("too many replies")) return "短時間に送れる返信数の上限に達しました。しばらくしてからお試しください。";
  if (m.includes("thread is closed")) return "この連絡は完了しているため、返信できません。";
  if (m.includes("request id content mismatch")) return "前回の送信が保存済みの可能性があり、内容が異なるため送れません。一覧で保存済みか確認し、内容を変える場合は画面を開き直してください。";
  if (m.includes("invalid body")) return "本文を確認してください。";
  if (m.includes("invalid kind") || m.includes("invalid status")) return "入力を確認してください。";
  if (m.includes("recipient cannot access this thread")) return "指定した担当者は、この会社・店舗の連絡を受け取れません。";
  if (m.includes("recipient is not a stylist account")) return "宛先が美容師アカウントではありません。";
  if (m.includes("store does not belong to organization")) return "店舗と会社の組み合わせが正しくありません。";
  if (m.includes("admin access required")) return "この操作を行う権限がありません。";
  if (m.includes("thread not found") || m.includes("login required")) return "連絡が見つからないか、見る権限がありません。";
  return "保存できませんでした。時間をおいて、もう一度お試しください。";
}

export const UNKNOWN_RESULT_MESSAGE = "通信が途切れ、保存されたか確認できませんでした。入力はそのまま残っています。同じ内容でもう一度送信してください（二重には保存されません）。";

/** URLの rid（失敗後の再表示で同じ送信IDを使う）か、無ければ新しいIDを返す。 */
export function requestIdFrom(rid: string | string[] | undefined, make: () => string = () => crypto.randomUUID()): string {
  const v = Array.isArray(rid) ? rid[0] : rid;
  return isUuid(v) ? v : make();
}
