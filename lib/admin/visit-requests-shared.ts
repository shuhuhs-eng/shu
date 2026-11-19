/** 見学・体験入店の受付（運営）: 画面とテストで共有する定数・表示名・戻り値の検証（server-only に依存しない）。 */
export const VISIT_ENTRANCES = ["scout_reply", "direct_interest"] as const;
export const VISIT_KINDS = ["visit", "trial"] as const;
export const VISIT_STATUSES = ["received", "reviewing", "scheduling", "scheduled", "post_visit_check", "attended", "closed"] as const;
export const VISIT_LIST_STATUSES = ["unclaimed", ...VISIT_STATUSES] as const;

export const ENTRANCE_LABELS: Record<string, string> = { scout_reply: "スカウトへの返信", direct_interest: "美容師から店舗へ（見学を希望したい）" };
export const KIND_LABELS: Record<string, string> = { visit: "見学", trial: "体験入店" };
export const STATUS_LABELS: Record<string, string> = {
  unclaimed: "未受付", received: "受付", reviewing: "運営確認中", scheduling: "日程調整中", scheduled: "日程確定",
  post_visit_check: "実施後の確認中", attended: "実施済み", closed: "終了",
};
export const CLOSED_REASON_LABELS: Record<string, string> = { not_held: "実施されなかった", declined: "辞退", duplicate: "重複", cancelled: "取消", other: "その他" };
export const CONFIRM_LABELS: Record<string, string> = { held: "実施された", not_held: "実施されなかった" };
/** 次に選べる状態（DBの遷移規則と同じ。最終判断はDB）。 */
export const NEXT_STATUSES: Record<string, string[]> = {
  received: ["reviewing", "closed"], reviewing: ["scheduling", "closed"], scheduling: ["scheduled", "closed"],
  scheduled: ["scheduled", "scheduling", "post_visit_check", "closed"], post_visit_check: ["attended", "closed"], attended: [], closed: [],
};

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

export type VisitRow = {
  entrance: string; kind: string | null; legacy_interested: boolean; source_id: string; requested_at: string | null;
  stylist_user_id: string; stylist_public_name: string | null; stylist_full_name: string | null;
  store_id: string; store_name: string; organization_id: string; organization_name: string;
  request_id: string | null; status: string; assigned_admin_id: string | null; scheduled_on: string | null;
  closed_reason: string | null; merged_into_request_id: string | null; occurrence_id: string | null; has_note: boolean; updated_at: string | null;
  salon_confirmation: string | null; stylist_confirmation: string | null;
  /** 入口の希望（スカウト返信／直接の見学希望）が、その後に取り消されたか。受付・履歴は残る。 */
  source_cancelled?: boolean;
};
export type VisitList = { as_of: string; total: number; rows: VisitRow[] };
export function isVisitList(d: unknown): d is VisitList {
  if (!isObj(d) || !isCount(d.total) || !Array.isArray(d.rows)) return false;
  return d.rows.every((r) => isObj(r) && isStr(r.entrance) && isStr(r.source_id) && isStr(r.stylist_user_id) && isStr(r.store_id) && isStr(r.status) && typeof r.legacy_interested === "boolean");
}
export type VisitDetail = {
  id: string; status: string; kind: string; source_kind: string; stylist_user_id: string; store_id: string; scheduled_on: string | null;
  occurrence_id: string | null; internal_note: string | null; closed_reason: string | null; merged_into_request_id: string | null; updated_at: string; assigned_admin_id: string | null;
  source_cancelled?: boolean;
  confirmations: { party: string; result: string; channel: string; confirmed_at: string; note: string | null }[];
  events: { action: string; actor_user_id: string; created_at: string }[];
};
export function isVisitDetail(d: unknown): d is VisitDetail {
  return isObj(d) && isStr(d.id) && isStr(d.status) && isStr(d.kind) && isStr(d.updated_at) && Array.isArray(d.confirmations) && Array.isArray(d.events);
}

/** DBが返す英語のメッセージを、運営向けの日本語にする（未知のメッセージは汎用文）。 */
export function visitErrorMessage(m: string): string {
  const table: [RegExp, string][] = [
    [/admin access required/, "運営の権限が必要です。"],
    [/updated by someone else/, "他の担当者が先に更新しました。画面を開き直して内容を確認してください。"],
    [/already finished/, "この受付はすでに終了しています。"],
    [/invalid transition/, "その状態へは進められません。"],
    [/scheduled date required/, "実施日を入力してください。"],
    [/visit date has not come yet/, "実施日になるまで、実施後の確認には進めません。"],
    [/change the date while scheduled/, "実施後の確認に進んだ後は日付を変更できません。"],
    [/both parties must confirm/, "サロンと本人の両方が「実施された」と確認されるまで、実施済みにできません。"],
    [/already completed/, "同じ日の同じ見学はすでに実施済みです。重複として終了してください。"],
    [/merge target/, "統合先は、同じ美容師・店舗・種別の未終了の受付を選んでください。"],
    [/closed reason required/, "終了の理由を選んでください。"],
    [/confirmations can be recorded only/, "確認の記録は「実施後の確認中」の受付でのみ行えます。"],
    [/not a visit or trial request/, "過去の「話を聞いてみたい」は、見学・体験入店の希望として受付できません。"],
    [/note too long/, "メモが長すぎます。"],
    [/assignee must be an admin/, "担当者は運営者を選んでください。"],
    [/request not found/, "受付が見つかりません。"],
  ];
  for (const [re, msg] of table) if (re.test(m)) return msg;
  return "保存できませんでした。時間をおいて再度お試しください。";
}


export const SOURCE_CANCELLED_TEXT = "入口の希望は取消されました（受付・履歴は残ります）";
