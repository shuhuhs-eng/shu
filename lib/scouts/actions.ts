"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { RECRUITING_PAUSED_MESSAGE, isRecruitingPausedError } from "@/lib/contracts/recruiting-access";
import { scoutLedgerEnabled } from "@/lib/billing/hire-flags";
import { ledgerSendErrorMessage, nextSendMode, isUnknownOutcome, UNKNOWN_OUTCOME_MESSAGE, type SendRpcError } from "@/lib/billing/scout-send-rules";
import { cardGateErrorMessage, salonCardBlockMessage } from "@/lib/billing/salon-card-gate";

const sendStoreScoutSchema = z.object({
  storeId: z.string().uuid(),
  stylistUserId: z.string().uuid(),
  message: z.string().trim().min(1).max(1000),
  templateType: z.enum(["casual", "concrete"]).nullable(),
  /** 台帳方式の再試行キー（SCOUT_LEDGER_ENABLED=1 のときだけ使う。無ければサーバーで新規に作る）。 */
  requestId: z.string().uuid().optional(),
});

/**
 * 店舗単位Scout送信（法人・複数店舗対応 Phase 5）。send_scout_v2のみを
 * 呼び出す薄いラッパー。storeIdは呼び出し元（店舗workspaceの
 * params.storeId）が明示的に渡す値であり、auth.uid()・salon_user_id・
 * organization_idから推測しない。既存sendScout（旧send_scout）は変更せず
 * 並走させたまま、本番UIからの呼び出し元だけをこちらへ切り替える。
 */
export async function sendStoreScout(
  input: z.infer<typeof sendStoreScoutSchema>,
): Promise<{ success: true } | { success: false; error: string }> {
  const parsed = sendStoreScoutSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "スカウト内容を確認してください。" };
  const supabase = await createClient();
  const cardBlock = await salonCardBlockMessage(supabase);
  if (cardBlock) return { success: false, error: cardBlock };
  // ★SCOUT_LEDGER_ENABLED=1（既定オフ）のときだけ、DBの送信方式スイッチ（scout_send_mode）を読み、台帳方式なら送信と台帳の消費を同じDBトランザクションで行う関数を使う。
  //   オフの間は従来どおり send_scout_v2（旧の月次枠）のまま。DBとアプリの切替の途中でも送信不能にならないよう、方式の食い違いを示すエラーのときだけ逆の方式で1回やり直す。
  const flagOn = scoutLedgerEnabled();
  const args = {
    p_store_id: parsed.data.storeId,
    p_stylist_user_id: parsed.data.stylistUserId,
    p_message: parsed.data.message,
    p_template_type: parsed.data.templateType,
  };
  const requestId = parsed.data.requestId ?? randomUUID();
  const send = (ledgerMode: boolean) => ledgerMode
    ? supabase.rpc("send_scout_with_ledger" as never, { ...args, p_request_id: requestId } as never)
    : supabase.rpc("send_scout_v2", args);
  let ledger = false;
  if (flagOn) {
    const { data: mode } = await supabase.rpc("scout_send_mode" as never);
    ledger = mode === "ledger";
  }
  // 送信の結果。例外（通信切れ等）は thrown。結果が分からないときは別の方式で送り直さず、台帳方式なら同じ操作のキーで結果を照合する。
  const attempt = async (ledgerMode: boolean): Promise<{ error: SendRpcError; thrown: boolean }> => {
    try { const r = await send(ledgerMode); return { error: r.error, thrown: false }; } catch { return { error: null, thrown: true }; }
  };
  let { error, thrown } = await attempt(ledger);
  if (error && flagOn) {
    const flip = nextSendMode(error, ledger);   // DBが「何もしていない」と明示したときだけ
    if (flip !== null) { ledger = flip; ({ error, thrown } = await attempt(ledger)); }
  }
  if (isUnknownOutcome(error, thrown)) {
    if (ledger) {
      const { data: found } = await supabase.rpc("scout_send_result" as never, { p_request_id: requestId } as never);
      if (found && typeof found === "object" && (found as { found?: boolean }).found === true) { error = null; thrown = false; }
      else return { success: false, error: UNKNOWN_OUTCOME_MESSAGE };
    } else return { success: false, error: UNKNOWN_OUTCOME_MESSAGE };
  }
  if (error) {
    console.error("[sendStoreScout] RPC failed", { message: error.message, code: error.code });
    if (isRecruitingPausedError(error.message)) {
      return { success: false, error: RECRUITING_PAUSED_MESSAGE };
    }
    const cardMsg = cardGateErrorMessage(error.message);
    if (cardMsg) return { success: false, error: cardMsg };
    const ledgerMsg = ledgerSendErrorMessage(error.message);
    if (ledgerMsg) return { success: false, error: ledgerMsg };
    if (error.message.includes("monthly scout limit reached")) {
      return { success: false, error: "今月のスカウト枠を使い切りました。追加スカウト購入機能は準備中です。" };
    }
    return { success: false, error: "スカウトを送信できませんでした。" };
  }
  revalidatePath(`/salon/stores/${parsed.data.storeId}/stylists`);
  revalidatePath("/stylist/mypage");
  return { success: true };
}

const markScoutReadSchema = z.object({ scoutId: z.string().uuid() });

export async function markScoutRead(
  input: z.infer<typeof markScoutReadSchema>,
): Promise<{ success: true } | { success: false; error: string }> {
  const parsed = markScoutReadSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "不正なリクエストです。" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_scout_read", { p_scout_id: parsed.data.scoutId });
  if (error) return { success: false, error: "既読にできませんでした。" };
  revalidatePath("/stylist/mypage");
  revalidatePath("/stylist/scouts");
  return { success: true };
}

const respondScoutSchema = z
  .object({
    scoutId: z.string().uuid(),
    response: z.enum(["visit_requested", "trial_requested", "question", "considering", "declined"]),
    responseMessage: z.string().trim().max(1000).nullable(),
  })
  .refine((v) => v.response !== "question" || (v.responseMessage != null && v.responseMessage.length > 0), {
    message: "知りたい内容を入力してください。",
  });

export async function respondScout(
  input: z.infer<typeof respondScoutSchema>,
): Promise<{ success: true } | { success: false; error: string }> {
  const parsed = respondScoutSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "回答を確認してください。" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("respond_scout", {
    p_scout_id: parsed.data.scoutId,
    p_response: parsed.data.response,
    p_response_message: parsed.data.responseMessage,
  });
  if (error) return { success: false, error: "回答を保存できませんでした。" };
  revalidatePath("/stylist/mypage");
  revalidatePath("/stylist/scouts");
  revalidatePath("/salon/stylists");
  return { success: true };
}
