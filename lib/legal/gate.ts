import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * 規約・プライバシーポリシーへの同意ゲート（middlewareから使う）。
 *
 * ★fail-closed：ログイン済みのユーザーがサービス本体へ入るとき、同意状況を確認できなければ
 *   通さない（未確認のまま通さない）。確認できない場合は「確認処理を完了できません」画面へ
 *   誘導する。ただしその画面・規約・プライバシー・同意画面・ログイン・認証・API・静的ファイルは
 *   ゲートの対象外なので、誘導先でループしない。
 * ★公開された版が1件も無いときは「同意不要」。0047適用直後の既存ユーザーは止まらない。
 */

export type LegalCheck = "ok" | "pending" | "error";
export type LegalGateDecision = "allow" | "accept" | "unavailable";

/** サービス本体（ゲートの対象）のパス。ここ以外（規約・ログイン・認証・公開ページ・API等）は対象外。 */
const GATED_PREFIXES = ["/onboarding", "/mypage", "/profile", "/salon-culture", "/stylist", "/salon"];
/** 本体の接頭辞に含まれるが、ゲートの対象外にする公開の入口。 */
const GATE_EXEMPT_EXACT = ["/stylist", "/stylist/login", "/salon", "/salon/login"];

export function isLegalGatedPath(pathname: string): boolean {
  if (GATE_EXEMPT_EXACT.includes(pathname)) return false;
  return GATED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** 判定だけを行う純粋関数（テスト可能）。 */
export function legalGateDecision(pathname: string, check: LegalCheck): LegalGateDecision {
  if (!isLegalGatedPath(pathname)) return "allow";
  if (check === "pending") return "accept";
  if (check === "error") return "unavailable";
  return "allow";
}

/** 同意状況を確認する。確認できなければ "error"（通さない側に倒す）。 */
export async function checkLegalAcceptance(supabase: SupabaseClient<Database>): Promise<LegalCheck> {
  const { data, error } = await supabase.rpc("get_my_legal_acceptance_status");
  if (error) {
    console.error("[legal gate] status check failed", { message: error.message, code: error.code });
    return "error";
  }
  if (data && typeof data === "object" && !Array.isArray(data) && typeof data.accepted === "boolean") {
    return data.accepted ? "ok" : "pending";
  }
  console.error("[legal gate] unexpected status shape");
  return "error";
}

/** 同意後の戻り先。アプリ内の絶対パスだけ許す（外部URLへの誘導を防ぐ）。 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  if (raw === "/legal/accept" || raw.startsWith("/legal/accept?") || raw.startsWith("/legal/unavailable")) return "/";
  return raw;
}
