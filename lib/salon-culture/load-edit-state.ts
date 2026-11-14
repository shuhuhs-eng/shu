import { ANALYSIS_VERSION, extractSupplementAnswers, type SupplementAnswers } from "@/lib/salon-culture/analysis/v1";
import { fromPayload, fromPublished, type DraftState } from "@/lib/salon-culture/draft";
import { looseRpc } from "@/lib/diagnosis-limit/rpc";
import { UNKNOWN_STATUS, type LimitStatus } from "@/lib/diagnosis-limit/messages";
import { getDiagnosisChangeStatus } from "@/lib/diagnosis-limit/status";

export type CultureEditState = {
  hasPublished: boolean;
  publishedStatus: string | null;
  publishedAnswers: unknown;
  publishedExtra: SupplementAnswers | null;
  /** 編集の出発点: 下書きがあれば下書き、なければ公開中の結果（途中保存の旧行も含む）。 */
  initial: DraftState;
  initialRev: number | null;
  hasDraft: boolean;
  limitStatus: LimitStatus;
  /** 店舗用のみ: 保存・確定できる権限（閲覧のみは false）。本人用は常に true。 */
  canEdit: boolean;
  loadError: boolean;
};

/**
 * サロンらしさの編集画面に必要な状態を読む（本人用: storeId=null／店舗用: 店舗ID）。
 * 読み取りはすべて呼び出し本人の権限（RLS）で行う。下書きは、本人または編集権限のある担当者だけが読める。
 */
export async function loadCultureEditState(supabaseIn: unknown, userId: string, storeId: string | null): Promise<CultureEditState> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = supabaseIn as any; // 新しい表（salon_culture_drafts）は自動生成の型定義に無い
  const profileTable = storeId ? "salon_store_culture_profiles" : "salon_culture_profiles";
  const ownerCol = storeId ? "store_id" : "salon_user_id";
  const ownerVal = storeId ?? userId;

  let canEdit = true;
  if (storeId) {
    const { data, error } = await looseRpc(supabaseIn).rpc("can_edit_store_culture_analysis", { p_store_id: storeId });
    if (error) return failed();
    canEdit = data === true;
  }

  const [pub, extra, draft, status] = await Promise.all([
    supabase.from(profileTable).select("*").eq(ownerCol, ownerVal).maybeSingle(),
    supabase.from("salon_culture_analysis_answers").select("answers").eq(ownerCol, ownerVal).eq("analysis_version", ANALYSIS_VERSION).maybeSingle(),
    canEdit ? supabase.from("salon_culture_drafts").select("payload, rev").eq(ownerCol, ownerVal).maybeSingle() : Promise.resolve({ data: null, error: null }),
    getDiagnosisChangeStatus(supabaseIn, storeId ? "salon_culture_store" : "salon_culture_user", storeId ?? undefined),
  ]);
  if (pub.error || extra.error) return failed();
  // 下書きの表が無い（0058未適用）ときは、下書きなしとして扱う。
  const draftRow = draft.error ? null : (draft.data as { payload: unknown; rev: number } | null);

  const profile = pub.data as { status?: string; answers?: unknown; respondent_role?: string | null; value_priorities?: string[] | null; comment?: string | null } | null;
  const published = fromPublished(profile, extra.data as { answers?: unknown } | null);
  const fromDraft = draftRow ? fromPayload(draftRow.payload) : null;
  const publishedExtra = extra.data ? extractSupplementAnswers((extra.data as { answers?: unknown }).answers) : null;

  return {
    hasPublished: profile?.status === "completed",
    publishedStatus: profile?.status ?? null,
    publishedAnswers: profile?.answers ?? null,
    publishedExtra,
    initial: fromDraft ?? published,
    initialRev: draftRow?.rev ?? null,
    hasDraft: !!fromDraft,
    limitStatus: status,
    canEdit,
    loadError: false,
  };

  function failed(): CultureEditState {
    return {
      hasPublished: false, publishedStatus: null, publishedAnswers: null, publishedExtra: null,
      initial: fromPublished(null, null), initialRev: null, hasDraft: false, limitStatus: UNKNOWN_STATUS, canEdit: false, loadError: true,
    };
  }
}
