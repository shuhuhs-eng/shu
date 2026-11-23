/** 運営での自分の状態の解釈（純関数。DB呼び出しは operator.ts）。画面の出し分け専用で、権限判定ではない（各RPCがDBで確認する）。 */
export type OperatorState =
  | "responsible"
  | "staff_active"
  | "staff_invited"
  | "staff_invited_expired"
  | "staff_suspended"
  | "staff_relogin"
  | "none"
  | "error";

const KNOWN: ReadonlySet<string> = new Set(["responsible", "staff_active", "staff_invited", "staff_invited_expired", "staff_suspended", "staff_relogin", "none"]);

/** RPC(admin_my_operator_state)の戻り値を状態へ。想定外の形は error（運営でないと決めつけない）。 */
export function parseOperatorState(data: unknown): OperatorState {
  if (typeof data !== "object" || data === null) return "error";
  const s = (data as { state?: unknown }).state;
  return typeof s === "string" && KNOWN.has(s) ? (s as OperatorState) : "error";
}

export const STAFF_HOME_PATH = "/admin/staff";
export const STAFF_ACCEPT_PATH = "/admin/staff/accept";
export const STAFF_SUSPENDED_PATH = "/admin/staff/suspended";
export const ADMIN_LOGIN_PATH = "/admin/login";

/** 業務の画面に入れる状態（責任者・承諾済みで有効なスタッフ）。 */
export function canEnterOperations(s: OperatorState): boolean {
  return s === "responsible" || s === "staff_active";
}
/** スタッフ（どの状態でも）。一般ログインからは入れず、運営ログインへ誘導する対象。 */
export function isStaffState(s: OperatorState): boolean {
  return s.startsWith("staff_");
}
/** ログイン後・誤った入口に来たときの行き先。運営でない/確認できないときは null（呼び出し側が従来どおり扱う）。 */
export function operatorHomePath(s: OperatorState): string | null {
  switch (s) {
    case "responsible": return "/admin";
    case "staff_active": return STAFF_HOME_PATH;
    case "staff_invited":
    case "staff_invited_expired": return STAFF_ACCEPT_PATH;
    case "staff_suspended": return STAFF_SUSPENDED_PATH;
    case "staff_relogin": return `${ADMIN_LOGIN_PATH}?relogin=1`;
    default: return null;
  }
}
/** 各スタッフ状態ページが「自分の状態」として受け入れる状態（リダイレクトの輪を作らないための表。試験で検証）。 */
export const STATE_PAGE_ACCEPTS: Record<string, readonly OperatorState[]> = {
  [STAFF_HOME_PATH]: ["staff_active"],
  [STAFF_ACCEPT_PATH]: ["staff_invited", "staff_invited_expired"],
  [STAFF_SUSPENDED_PATH]: ["staff_suspended"],
};
