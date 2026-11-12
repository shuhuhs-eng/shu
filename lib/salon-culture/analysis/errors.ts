export type AnalysisSaveErrorCode =
  | "invalid"
  | "base_changed"
  | "base_not_completed"
  | "not_allowed"
  | "not_found"
  | "unknown";

/** RPCの例外メッセージ → 画面に出す案内。内部のエラー文はそのまま見せない。 */
export function mapAnalysisSaveError(message: string | null | undefined): {
  success: false;
  code: AnalysisSaveErrorCode;
  error: string;
} {
  const m = message ?? "";
  if (m.includes("base answers changed")) {
    return {
      success: false,
      code: "base_changed",
      error: "サロンらしさの回答が、この画面を開いたあとに更新されました。画面を読み込み直して、内容を確認してからもう一度回答してください。",
    };
  }
  if (m.includes("base profile not completed")) {
    return { success: false, code: "base_not_completed", error: "先に、サロンらしさの12項目の回答を完了してください。" };
  }
  if (m.includes("not allowed to edit this store")) {
    return { success: false, code: "not_allowed", error: "この店舗の追加回答を保存する権限がありません（閲覧のみの権限です）。" };
  }
  if (m.includes("store not found or not accessible") || m.includes("caller is not a salon")) {
    return { success: false, code: "not_found", error: "対象の店舗が見つからないか、アクセスできません。" };
  }
  if (m.includes("invalid expected base") || m.includes("invalid answers") || m.includes("unsupported")) {
    return { success: false, code: "invalid", error: "入力内容をご確認ください。" };
  }
  return { success: false, code: "unknown", error: "保存に失敗しました。もう一度お試しください。" };
}
