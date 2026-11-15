import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * サロン向けの候補一覧（get_public_stylists_for_scout）を、店舗を指定して取得する。
 * 0070（確定方針）適用後は p_store_id を受け取り、その店舗に承認された実年齢だけが含まれる。
 * 0070が未適用のDBには引数付きの関数が無い（PostgREST PGRST202）ため、その場合に限り従来の引数なしで取得し直す
 * （適用順の途中でも一覧が空にならないようにするため。この場合は年齢情報は含まれない＝何も開示されない）。
 */
export async function fetchPublicStylistsForScout(supabase: SupabaseClient<Database>, storeId: string) {
  const first = await supabase.rpc("get_public_stylists_for_scout", { p_store_id: storeId });
  if (first.error && first.error.code === "PGRST202") {
    return supabase.rpc("get_public_stylists_for_scout");
  }
  return first;
}
