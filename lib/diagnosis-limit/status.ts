import { parseLimitStatus, UNKNOWN_STATUS, type LimitStatus } from "@/lib/diagnosis-limit/messages";

type RpcCaller = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

/**
 * 画面の案内用に、変更できる状態を読む（get_diagnosis_change_status。本人のJWTで呼ぶ）。
 * 0058の適用前（関数なし）や通信失敗のときは unknown を返し、案内を出さないだけにする（画面は壊さない）。
 * ここで読む状態は案内のためで、保存の可否は保存時にDBが判断する。
 */
export async function getDiagnosisChangeStatus(
  supabase: unknown,
  kind: "stylist" | "salon_quiz" | "salon_culture_user" | "salon_culture_store",
  storeId?: string,
): Promise<LimitStatus> {
  try {
    const { data, error } = await (supabase as RpcCaller).rpc("get_diagnosis_change_status", {
      p_kind: kind,
      p_store_id: storeId ?? null,
    });
    if (error) return UNKNOWN_STATUS;
    return parseLimitStatus(data);
  } catch {
    return UNKNOWN_STATUS;
  }
}
