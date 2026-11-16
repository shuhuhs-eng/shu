"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { validateValuePriorities } from "@/lib/profile/apply-diagnosis-values";

export type ApplyValuesResult = { ok: true } | { ok: false; message: string };

/**
 * 診断結果の「大切にしたい働き方」を、本人の操作でプロフィールの「サロン選びで大切にしたいこと」へ反映する。
 * ・保存は専用関数 set_stylist_value_priorities（0072）だけを呼ぶ。この関数は value_priorities の1列だけを本人の行に書く。
 *   save_stylist_profile 系（プロフィール全項目を受け取る関数）は使わない。ほかのプロフィール項目は更新しない。
 * ・検証: ちょうど3つ・一覧にある項目・重複なし（DB側でも同じ検証。最終判断はDB）。3つに満たない診断は補わず、ここでは保存しない。
 * ・関数が無い（0072未適用）・通信エラーは保存せず、その旨を返す（成功とは扱わない）。
 */
export async function applyValuePrioritiesAction(values: string[]): Promise<ApplyValuesResult> {
  const v = validateValuePriorities(Array.isArray(values) ? values : []);
  if (!v.ok) return { ok: false, message: v.message };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "ログインし直してください。" };
  const { error } = await supabase.rpc("set_stylist_value_priorities", { p_value_priorities: v.values });
  if (error) {
    console.error("[applyValuePrioritiesAction] RPC failed", { message: error.message, code: error.code });
    if (error.code === "P0002" || /profile_not_found/.test(error.message)) return { ok: false, message: "先にプロフィールを保存してください。" };
    if (error.code === "22023") return { ok: false, message: "選べない項目が含まれています。プロフィール編集で選び直してください。" };
    if (error.code === "PGRST202" || error.code === "42883") return { ok: false, message: "この機能は現在ご利用いただけません。プロフィール編集で選び直してください。" };
    return { ok: false, message: "反映に失敗しました。通信状況を確認して、もう一度お試しください。" };
  }
  for (const path of ["/stylist/diagnosis/student/result", "/stylist/profile", "/stylist/profile/preview", "/stylist/mypage"]) revalidatePath(path);
  return { ok: true };
}
