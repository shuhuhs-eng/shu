/**
 * サロン登録時のカード必須（決定済み）。カード未登録の会社に所属する担当者は、サロン業務機能を使えない。
 *
 * ★入口は残す: カードの登録・更新（/salon/company/billing）、請求先情報・契約の確認、ログイン、案内画面（/salon/card-required）は常に開ける。
 * ★画面側の制御: middleware が、サロン業務のパスへの移動を案内へ移す。
 * ★サーバー側の制御: 業務の書き込み（server action）は、ここの判定で拒否する。画面を経由しない直接の呼び出しも止まる。
 * ★fail-closed: カード状態を確認できないときも、業務は止める（案内画面で『確認できません』と表示）。
 * ★切替の唯一の元: DBの設定 salon_card_required（既定 false。責任者だけが変更できる。本番適用・有効化は承認後）。環境変数では切り替えない。
 * ★DBでも強制: 業務表への書き込みは、同じ判定のトリガー（_salon_card_gate）がDBで拒否する。公開API（PostgREST/RPC）を直接呼ぶ経路も止まる。
 *   ここ（アプリ側）の判定は、画面の移動と、分かりやすい案内文のため。DBが拒否したときの文言も {@link cardGateErrorMessage} で同じ案内にそろえる。
 * ★対象: 所属する会社が1つでもカード未登録なら止める。所属が無いユーザー（美容師・運営）は対象外。
 */
export const CARD_GATED_PREFIXES = ["/salon/", "/salon-culture", "/diagnosis/salon", "/messages"] as const;
export const CARD_EXEMPT_PREFIXES = ["/salon/card-required", "/salon/login", "/salon/company/billing", "/salon/company/billing-profile", "/salon/company/contract"] as const;

const under = (pathname: string, p: string) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`);
export function isCardGatedPath(pathname: string): boolean {
  if (CARD_EXEMPT_PREFIXES.some((p) => under(pathname, p))) return false;
  return CARD_GATED_PREFIXES.some((p) => (p.endsWith("/") ? pathname.startsWith(p) : under(pathname, p)));
}

export type CardRow = { organization_id: string; card_ready: boolean; can_register: boolean; required?: boolean };
export type CardGate = { blocked: boolean; canRegister: boolean; unknown: boolean };
/** rows が null（取得失敗）なら fail-closed。所属なし（空）は対象外。 */
export function decideCardGate(rows: CardRow[] | null): CardGate {
  if (rows === null) return { blocked: true, canRegister: false, unknown: true };
  const missing = rows.filter((r) => r.required === true && !r.card_ready);   // required が無い（古いDB）場合は、必須とは見なさない
  return { blocked: missing.length > 0, canRegister: missing.some((r) => r.can_register), unknown: false };
}
export const cardRequiredPath = (g: CardGate): string => (g.canRegister ? "/salon/company/billing?card=required" : "/salon/card-required");

// 型付きのSupabaseクライアントをそのまま受け取れるよう、内部で緩める（呼ぶRPCは get_my_salon_card_state だけ）。
type RpcClient = object;
type LooseRpc = { rpc: (fn: string) => PromiseLike<{ data: unknown; error: unknown }> };
/** 判定用の関数がDBに無い（0109未適用）ときのエラー。この場合は機能自体が無いので、必須とは見なさない（DB側の強制も無いため、整合する）。 */
const isMissingFunction = (e: unknown): boolean => { const c = (e as { code?: string } | null)?.code; return c === "PGRST202" || c === "42883"; };
export async function getSalonCardGate(supabase: RpcClient): Promise<CardGate> {
  try {
    const { data, error } = await (supabase as LooseRpc).rpc("get_my_salon_card_state");
    if (error) return isMissingFunction(error) ? decideCardGate([]) : decideCardGate(null);
    if (!Array.isArray(data)) return decideCardGate(null);
    return decideCardGate(data as CardRow[]);
  } catch { return decideCardGate(null); }
}

export const CARD_REQUIRED_MESSAGE = "サロンのカード登録が完了していないため、この操作はできません。会社の管理者がカードを登録すると利用できます。";
/** カード状態を確認できなかったとき（通信失敗など）。操作は行わない（fail-closed）。登録が未完了という意味ではないので、文言を分ける。 */
export const CARD_UNKNOWN_MESSAGE = "通信に失敗しました。カード登録の状態を確認できなかったため、操作は行っていません。通信状況を確認して、もう一度お試しください。";
/** DBの拒否（カード必須）かどうか。 */
export const isCardGateError = (message: string | null | undefined): boolean => (message ?? "").includes("card registration required");
/** DBが拒否した場合の案内文（カード必須の拒否なら案内文、それ以外は null）。 */
export const cardGateErrorMessage = (message: string | null | undefined): string | null => (isCardGateError(message) ? CARD_REQUIRED_MESSAGE : null);
/** server action 用。DBの設定が有効かつ未登録（または確認不能）なら案内文、問題なければ null。 */
export async function salonCardBlockMessage(supabase: RpcClient): Promise<string | null> {
  const g = await getSalonCardGate(supabase);
  if (!g.blocked) return null;
  return g.unknown ? CARD_UNKNOWN_MESSAGE : CARD_REQUIRED_MESSAGE;
}
