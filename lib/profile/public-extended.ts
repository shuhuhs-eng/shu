import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * 公開プロフィールの追加表示（画像・雇用形態・Instagram・大切にしたいこと・年齢）が、いまサロン側に出ているか。
 * 判定はDBの機能フラグ（get_stylist_public_extended_enabled）で行う。生年月日の列があるかどうかでは判定しない
 * （停止中でも列は残るため、列の有無で判定するとプレビューとサロン表示が食い違う）。
 *   enabled     : 出ている
 *   disabled    : 機能はあるが停止中（サロンには従来の項目だけ）
 *   unsupported : 関数が存在しない（0070が未適用）。従来表示に切り替えてよい
 *   error       : 権限・通信などのエラー。未対応扱いにしない
 */
export type PublicExtendedStatus = "enabled" | "disabled" | "unsupported" | "error";

/** 「関数が存在しない」エラーだけを未対応とみなす（PostgreSQL 42883 / PostgREST PGRST202）。 */
export function isMissingFunction(error: { code?: string | null; message?: string | null }): boolean {
  if (error.code === "42883" || error.code === "PGRST202") return true;
  return /could not find the function|function .* does not exist/i.test(error.message ?? "");
}

export async function readPublicExtendedStatus(supabase: SupabaseClient<Database>): Promise<PublicExtendedStatus> {
  const { data, error } = await supabase.rpc("get_stylist_public_extended_enabled");
  if (error) return isMissingFunction(error) ? "unsupported" : "error";
  return data === true ? "enabled" : "disabled";
}
