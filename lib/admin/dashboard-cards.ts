import type { AdminSuccessFee } from "@/lib/billing/types";
import type { BillingIntegrityIssue } from "@/lib/billing/integrity";
import type { AdminContractListItem } from "@/lib/contracts/types";
import type { InvoiceDocumentRow } from "@/lib/invoices/types";
import { summarizeFees } from "@/lib/billing/summary";
import { countPaymentStates } from "@/lib/billing/payment";
import { countSeverities } from "@/lib/billing/integrity";
import { formatYen } from "@/lib/billing/format";

/**
 * 運営ダッシュボードのカード（/admin）。
 * ★取得に失敗した情報は value=null にする。カードは残し、画面は「取得できませんでした」と表示する。
 *   取得できていない数字を 0 にしない（正常な 0 件と区別する）。
 * ★カードごとに必要な取得元だけを見る。1つの取得が失敗しても、無関係なカードは数字を出せる。
 * 入力の null は「取得失敗」を表す（取得成功の空配列は 0 件）。
 */
export type DashboardCard = {
  label: string;
  /** null＝取得できなかった。0＝取得できて0件。 */
  value: number | null;
  href?: string;
  alert?: boolean;
};

export type AmountCard = { label: string; value: string | null; note: string };

export type DashboardSources = {
  fees: AdminSuccessFee[] | null;
  issues: BillingIntegrityIssue[] | null;
  contracts: AdminContractListItem[] | null;
  documents: InvoiceDocumentRow[] | null;
};

export const FETCH_FAILED_TEXT = "取得できませんでした";

/** 表示用の文字列。値が無い（取得失敗）ときは「取得できませんでした」。 */
export function cardValueText(value: number | null, unit = "件"): string {
  return value === null ? FETCH_FAILED_TEXT : `${value}${unit}`;
}

export function buildCountCards(fees: AdminSuccessFee[] | null): DashboardCard[] {
  const s = fees ? summarizeFees(fees) : null;
  return [
    { label: "採用成立", value: s ? s.hiredCount : null },
    { label: "請求確認中", value: s ? s.counts.pending_confirmation : null },
    { label: "請求額確定", value: s ? s.counts.confirmed : null },
    { label: "請求済み", value: s ? s.counts.invoiced : null },
    { label: "入金済み", value: s ? s.counts.paid : null },
    { label: "免除", value: s ? s.counts.waived : null },
    { label: "取消", value: s ? s.counts.cancelled : null },
  ];
}

export function buildAmountCards(fees: AdminSuccessFee[] | null): AmountCard[] {
  const s = fees ? summarizeFees(fees) : null;
  return [
    { label: "成功報酬総額", value: s ? formatYen(s.confirmedTotal) : null, note: "金額確定以降（免除・取消を除く）の合計" },
    { label: "請求済み総額", value: s ? formatYen(s.invoicedTotal) : null, note: "請求済み＋入金済みの合計" },
    { label: "入金済み総額", value: s ? formatYen(s.paidTotal) : null, note: "入金済みの合計" },
  ];
}

/** 「毎日の確認」。累計（採用成立）は件数カード側にあるため、ここには含めない。 */
export function buildDailyCards(src: DashboardSources, today?: string): DashboardCard[] {
  const { fees, issues, contracts, documents } = src;
  const s = fees ? summarizeFees(fees) : null;
  const pay = fees ? countPaymentStates(fees, today) : null;
  const withoutPdf =
    fees && documents
      ? (() => {
          const issued = new Set(documents.map((d) => d.success_fee_id));
          return fees.filter((f) => (f.fee_status === "invoiced" || f.fee_status === "paid") && f.invoice_number !== null && !issued.has(f.fee_id)).length;
        })()
      : null;
  return [
    { label: "成功報酬の確認待ち", value: s ? s.counts.pending_confirmation : null, href: "/admin/success-fees?view=pre_invoice" },
    { label: "請求待ち（金額確定済み）", value: s ? s.counts.confirmed : null, href: "/admin/success-fees?view=pre_invoice" },
    // 請求書PDFの判定には、請求と発行済み書類の両方が必要。
    { label: "請求書PDFが未発行", value: withoutPdf, href: "/admin/success-fees" },
    { label: "未入金", value: pay ? pay.unpaid + pay.overdue : null, href: "/admin/success-fees?view=unpaid" },
    { label: "支払期限超過", value: pay ? pay.overdue : null, href: "/admin/success-fees?view=overdue", alert: true },
    { label: "整合性の異常", value: issues ? countSeverities(issues).total : null, href: "/admin/integrity", alert: true },
    {
      label: "契約が停止中の会社",
      value: contracts ? contracts.filter((o) => o.contract?.contract_status === "suspended").length : null,
      href: "/admin/contracts?filter=suspended",
    },
  ];
}

export function buildContractCards(contracts: AdminContractListItem[] | null, fees: AdminSuccessFee[] | null): DashboardCard[] {
  const n = (f: (o: AdminContractListItem) => boolean) => (contracts ? contracts.filter(f).length : null);
  return [
    { label: "契約条件が未設定の会社", value: n((o) => o.contract === null), href: "/admin/contracts?filter=unset" },
    { label: "試用中の会社", value: n((o) => o.contract?.contract_status === "trial"), href: "/admin/contracts?filter=trial" },
    { label: "一時停止の会社", value: n((o) => o.contract?.contract_status === "suspended"), href: "/admin/contracts?filter=suspended" },
    { label: "解約の会社", value: n((o) => o.contract?.contract_status === "cancelled"), href: "/admin/contracts?filter=cancelled" },
    { label: "成功報酬額が未設定の契約", value: n((o) => o.contract !== null && o.contract.success_fee_amount === null), href: "/admin/contracts?filter=no_amount" },
    {
      label: "基準額と請求額が異なる成功報酬",
      value: fees
        ? fees.filter((f) => f.contract_success_fee_amount !== null && f.fee_amount !== null && f.fee_amount !== f.contract_success_fee_amount).length
        : null,
      href: "/admin/success-fees?view=diff",
    },
  ];
}

/**
 * 「面接・関心・診断」のカード。0085 のRPCから件数だけを取る。
 * ★RPCが未適用・取得失敗のときは value=null（「取得できませんでした」）。0件にしない。
 */
export type OperationCounts = { elapsedNotUpdated: number | null; interestsNotCreated: number | null; cultureNotReady: number | null };
export function buildOperationCards(c: OperationCounts): DashboardCard[] {
  return [
    { label: "面接予定日時を過ぎて結果が未更新", value: c.elapsedNotUpdated, href: "/admin/interviews?view=interview_elapsed_not_updated", alert: true },
    { label: "直接希望で進捗が未作成", value: c.interestsNotCreated, href: "/admin/interests?progress=not_created" },
    { label: "公開店舗でサロンらしさが未完成", value: c.cultureNotReady, href: "/admin/culture-readiness" },
  ];
}
