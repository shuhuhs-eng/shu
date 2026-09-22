export const EVIDENCE_TYPES = [
  { code: "pos_sales", label: "POS・売上管理画面" },
  { code: "payslip", label: "給与明細・歩合明細" },
  { code: "performance_report", label: "実績表・売上証明" },
  { code: "other", label: "その他の証明資料" },
] as const;

export type EvidenceType = (typeof EVIDENCE_TYPES)[number]["code"];

