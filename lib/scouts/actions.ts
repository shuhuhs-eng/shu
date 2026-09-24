"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const sendScoutSchema = z.object({
  stylistUserId: z.string().uuid(),
  message: z.string().trim().min(1).max(1000),
  templateType: z.enum(["casual", "concrete"]).nullable(),
});

export async function sendScout(
  input: z.infer<typeof sendScoutSchema>,
): Promise<{ success: true } | { success: false; error: string }> {
  const parsed = sendScoutSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "スカウト内容を確認してください。" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("send_scout", {
    p_stylist_user_id: parsed.data.stylistUserId,
    p_message: parsed.data.message,
    p_template_type: parsed.data.templateType,
  });
  if (error) {
    console.error("[sendScout] RPC failed", { message: error.message, code: error.code });
    if (error.message.includes("monthly scout limit reached")) {
      return { success: false, error: "今月のスカウト枠を使い切りました。追加スカウト購入機能は準備中です。" };
    }
    return { success: false, error: "スカウトを送信できませんでした。" };
  }
  revalidatePath("/salon/stylists");
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
  return { success: true };
}

const respondScoutSchema = z
  .object({
    scoutId: z.string().uuid(),
    response: z.enum(["interested", "question", "considering", "declined"]),
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
  revalidatePath("/salon/stylists");
  return { success: true };
}
