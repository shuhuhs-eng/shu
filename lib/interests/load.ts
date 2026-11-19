import { interestedKinds, isMissingColumnError, type InterestKind } from "@/lib/interests/kinds";

/** 希望状態の取得結果。取得できなかったときは「未送信」ではなく unknown（送信・取消を止める）。 */
export type OwnInterestState = { status: "known"; kinds: Record<InterestKind, boolean> } | { status: "unknown" };

type Q = PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
type Client = {
  from: (t: string) => { select: (cols: string) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => Q } } };
};

/**
 * 本人×店舗の希望（見学／体験入店）を取得する。
 * ・kind列あり: 行の kind で判定。
 * ・kind列なし（0095適用前のDB）: 行があれば見学（旧DBでは見学しか送れない）。体験入店は未送信。
 * ・上記いずれでも取得に失敗（権限・通信・想定外の形）: unknown。未送信として扱わない。
 */
export async function loadOwnInterestState(supabase: Client, userId: string, storeId: string): Promise<OwnInterestState> {
  const run = (cols: string) => supabase.from("stylist_salon_interests").select(cols).eq("stylist_user_id", userId).eq("store_id", storeId);
  try {
    const first = await run("id, kind");
    if (!first.error) {
      if (!Array.isArray(first.data)) return { status: "unknown" };
      return { status: "known", kinds: interestedKinds(first.data as Array<{ kind?: unknown }>) };
    }
    if (!isMissingColumnError(first.error)) return { status: "unknown" };
    const legacy = await run("id");
    if (legacy.error || !Array.isArray(legacy.data)) return { status: "unknown" };
    return { status: "known", kinds: interestedKinds((legacy.data as unknown[]).map(() => ({}))) };
  } catch {
    return { status: "unknown" };
  }
}
