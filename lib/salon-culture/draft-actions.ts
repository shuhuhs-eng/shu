"use server";

import { after } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit/memory-rate-limiter";
import { runSalonCultureAiGenerationJob } from "@/lib/salon-culture/run-culture-ai-job";
import { looseRpc } from "@/lib/diagnosis-limit/rpc";
import { logError } from "@/lib/security/log";
import { salonCultureStepSchema } from "@/lib/validation/salon-culture";
import { supplementAnswersSchema } from "@/lib/validation/salon-culture-analysis";
import { ANALYSIS_VERSION } from "@/lib/salon-culture/analysis/v1";
import { mapLimitError, type LimitErrorCode } from "@/lib/diagnosis-limit/messages";
import { fromPayload, fromPublished, toPayload, type DraftState } from "@/lib/salon-culture/draft";
import { expectedBaseSchema } from "@/lib/validation/salon-culture-analysis";
import { extractBaseAnswers, extractSupplementAnswers } from "@/lib/salon-culture/analysis/v1";

/**
 * サロンらしさ（本人用: storeId=null／店舗用: storeId=店舗）の「下書き保存」「確定」「破棄」。
 * 判定（権限・回数・版番号・再送・排他）はすべてDB側（0058）。ここは検証して渡し、エラーを利用者向けに直すだけ。
 * 下書きの保存は公開中の結果と回数に一切触れない。公開中の結果が変わるのは、確定（confirm_salon_culture_diagnosis）のときだけ。
 */
export type DraftResult =
  | { success: true; rev: number }
  | { success: false; code: LimitErrorCode | "invalid"; error: string };

export type ConfirmResult =
  | { success: true; action: string; replay: boolean; lockedUntil: string | null }
  | { success: false; code: LimitErrorCode | "invalid"; error: string };

const storeIdSchema = z.string().uuid().nullable();
const requestIdSchema = z.string().uuid();
const revSchema = z.number().int().min(1).nullable();

const INVALID = { success: false as const, code: "invalid" as const, error: "入力内容をご確認ください。" };

export async function saveCultureDraftAction(
  storeIdIn: string | null,
  state: DraftState,
  expectedRevIn: number | null,
): Promise<DraftResult> {
  const storeId = storeIdSchema.safeParse(storeIdIn);
  const rev = revSchema.safeParse(expectedRevIn);
  const step = salonCultureStepSchema.safeParse({
    status: "draft",
    respondentRole: state.respondentRole,
    currentStep: state.currentStep,
    answers: state.answers,
    valuePriorities: state.valuePriorities,
    comment: state.comment,
  });
  const extra = state.extra == null ? { success: true as const, data: null } : supplementAnswersSchema.safeParse(state.extra);
  if (!storeId.success || !rev.success || !step.success || !extra.success) return INVALID;

  const supabase = await createClient();
  const { data, error } = await looseRpc(supabase).rpc("save_salon_culture_draft", {
    p_store_id: storeId.data,
    p_payload: toPayload({ ...state, extra: extra.data as DraftState["extra"] }, ANALYSIS_VERSION),
    p_expected_rev: rev.data,
  });
  if (error || !data) {
    logError("saveCultureDraft", error);
    const e = mapLimitError(error);
    return { success: false, code: e.code, error: e.message };
  }
  return { success: true, rev: (data as { rev: number }).rev };
}

export async function discardCultureDraftAction(storeIdIn: string | null): Promise<{ success: boolean }> {
  const storeId = storeIdSchema.safeParse(storeIdIn);
  if (!storeId.success) return { success: false };
  const supabase = await createClient();
  const { error } = await looseRpc(supabase).rpc("discard_salon_culture_draft", { p_store_id: storeId.data });
  if (error) logError("discardCultureDraft", error);
  return { success: !error };
}

export async function confirmCultureAction(
  storeIdIn: string | null,
  requestIdIn: string,
  expectedRevIn: number | null,
): Promise<ConfirmResult> {
  const storeId = storeIdSchema.safeParse(storeIdIn);
  const requestId = requestIdSchema.safeParse(requestIdIn);
  const rev = revSchema.safeParse(expectedRevIn);
  if (!storeId.success || !requestId.success || !rev.success) return INVALID;

  const supabase = await createClient();
  const { data, error } = await looseRpc(supabase).rpc("confirm_salon_culture_diagnosis", {
    p_store_id: storeId.data,
    p_request_id: requestId.data,
    p_expected_rev: rev.data,
  });
  if (error || !data) {
    logError("confirmCulture", error);
    const e = mapLimitError(error);
    return { success: false, code: e.code, error: e.message };
  }
  const g = data as { action?: string; replay?: boolean; locked_until?: string | null };

  // 本人用の確定が成功したときだけ、サロン専用AI解説を作る（従来どおり。店舗用は対象外）。
  // 再送（replay）では作らない。AIの失敗は保存結果に影響しない（after内）。
  if (storeId.data === null && g.replay !== true) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const accessToken = session?.access_token ?? null;
    const allowed = checkRateLimit(`salon-culture-ai:${session?.user.id ?? "anon"}`, 5, 60 * 60 * 1000).allowed;
    if (accessToken && allowed && session?.user.id) {
      const { data: profile } = await supabase.from("salon_culture_profiles").select("*").eq("salon_user_id", session.user.id).maybeSingle();
      if (profile) after(() => runSalonCultureAiGenerationJob(profile, accessToken));
    }
  }

  return { success: true, action: String(g.action ?? ""), replay: g.replay === true, lockedUntil: typeof g.locked_until === "string" ? g.locked_until : null };
}

export type SaveExtraResult =
  | { success: true; action: string; replay: boolean; lockedUntil: string | null }
  | { success: false; code: LimitErrorCode | "invalid" | "base_changed" | "base_not_completed"; error: string };

/**
 * 追加5問の回答を、下書き（12問＋追加5問）に載せて確定する。
 *  - 12問の出発点は「下書きがあれば下書き、なければ公開中の結果」。表示時点の5問（expectedBase）と違えば base_changed。
 *  - 12問が公開中と同じで、追加5問を初めて回答するだけなら、変更として数えない（DB側の判定）。
 *  - 確定に失敗しても、公開中の結果と回数は変わらない（下書きには追加5問が残る）。
 *  - requestId は画面で1回だけ作られ、同じ内容の再送では同じ値（二重に数えない）。
 */
export async function saveExtraAndConfirmAction(
  storeIdIn: string | null,
  extraIn: unknown,
  expectedBaseIn: unknown,
  requestIdIn: string,
): Promise<SaveExtraResult> {
  const storeId = storeIdSchema.safeParse(storeIdIn);
  const requestId = requestIdSchema.safeParse(requestIdIn);
  const extra = supplementAnswersSchema.safeParse(extraIn);
  const expectedBase = expectedBaseSchema.safeParse(expectedBaseIn);
  if (!storeId.success || !requestId.success || !extra.success || !expectedBase.success) return INVALID;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, code: "not_authenticated", error: mapLimitError({ message: "not authenticated" }).message };

  const store = storeId.data;
  const table = store ? "salon_store_culture_profiles" : "salon_culture_profiles";
  const col = store ? "store_id" : "salon_user_id";
  const owner = store ?? user.id;

  if (store) {
    const { data: can } = await looseRpc(supabase).rpc("can_edit_store_culture_analysis", { p_store_id: store });
    if (can !== true) return { success: false, code: "not_allowed", error: mapLimitError({ message: "not allowed to edit this store" }).message };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any; // 表名・列名を切り替えるため緩い型で読む（読み取りは本人のRLS）
  const [{ data: pub }, { data: draftRow }, { data: extraRow }] = await Promise.all([
    db.from(table).select("*").eq(col, owner).maybeSingle(),
    db.from("salon_culture_drafts").select("payload, rev").eq(col, owner).maybeSingle(),
    db.from("salon_culture_analysis_answers").select("answers").eq(col, owner).eq("analysis_version", ANALYSIS_VERSION).maybeSingle(),
  ]);

  const draft = draftRow ? fromPayload((draftRow as { payload: unknown }).payload) : null;
  const state: DraftState = draft ?? fromPublished(pub, extraRow);
  const base = extractBaseAnswers(state.answers);
  if (!base || Object.keys(state.answers).length < 12) {
    return { success: false, code: "base_not_completed", error: "先に、サロンらしさの12項目の回答を完了してください。" };
  }
  if (JSON.stringify(base) !== JSON.stringify(expectedBase.data)) {
    return {
      success: false,
      code: "base_changed",
      error: "サロンらしさの回答が、この画面を開いたあとに更新されました。画面を読み込み直して、内容を確認してからもう一度回答してください。",
    };
  }
  state.extra = extractSupplementAnswers(extra.data);

  const saved = await saveCultureDraftAction(store, state, draftRow ? (draftRow as { rev: number }).rev : null);
  if (!saved.success) return saved;
  const confirmed = await confirmCultureAction(store, requestId.data, saved.rev);
  if (!confirmed.success) return confirmed;
  if (confirmed.replay) await discardCultureDraftAction(store); // 再送で残った同一内容の下書きを片付ける
  return confirmed;
}
