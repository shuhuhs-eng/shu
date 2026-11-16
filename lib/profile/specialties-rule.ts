/**
 * 得意技術の必須/任意ルール（クライアント・サーバー共通）。
 * 「いまの立場＝新卒」(careerPhase === "new_graduate") のときだけ任意（0件で保存可）。
 * 現役の美容師・ブランクありは従来どおり1つ以上が必須。
 */
export const SPECIALTIES_REQUIRED_MESSAGE = "得意技術を1つ以上選択してください";
export const SPECIALTIES_PHASE_CHANGED_MESSAGE =
  "「新卒」以外では得意技術を1つ以上選択してください。";

export function isSpecialtiesOptional(phase: unknown): boolean {
  return phase === "new_graduate";
}

/** 立場と選択数から、得意技術のエラーメッセージ（なければ null）を返す。 */
export function specialtiesError(phase: unknown, selectedCount: number): string | null {
  if (selectedCount > 0) return null;
  return isSpecialtiesOptional(phase) ? null : SPECIALTIES_REQUIRED_MESSAGE;
}
