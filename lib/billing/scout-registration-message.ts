/** 登録区分の設定でDBが返した拒否理由を、利用者向けの文言にする（内部名を出さない）。 */
export function registrationErrorMessage(m: string): string {
  if (m.includes("locked after the initial grant")) return "初回付与が済んでいるため、登録区分は変更できません。";
  if (/responsible only|insufficient permission|admin access required/.test(m)) return "この操作は責任者のみ行えます。";
  if (m.includes("unknown registration class")) return "登録区分が正しくありません。";
  if (m.includes("organization not found")) return "法人が見つかりません。";
  return "登録区分を設定できませんでした。時間をおいて、もう一度お試しください。";
}
