"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { buildSaveParams, readStoredProfileForSave, validateValuePriorities } from "@/lib/profile/apply-diagnosis-values";

export type ApplyValuesState =
  | { status: "idle" }
  | { status: "saved"; values: string[] }
  | { status: "error"; message: string };

/**
 * 診断結果の「大切にしたい働き方」をプロフィールへ反映する。本人が確認して押したときだけ呼ばれる（自動保存しない）。
 * 既存の保存経路（save_stylist_profile / _v2）を使い、value_priorities 以外の保存済み項目は変えない。診断の計算・回数制限には触れない。
 */
export async function applyValuePrioritiesAction(_prev: ApplyValuesState, formData: FormData): Promise<ApplyValuesState> {
  const v = validateValuePriorities(formData.getAll("valuePriorities"));
  if (!v.ok) return { status: "error", message: v.message };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { status: "error", message: "セッションが切れています。再度ログインしてください。" };

  const read = await readStoredProfileForSave(supabase, user.id);
  if (read.status === "error") return { status: "error", message: "プロフィールを読み込めませんでした。しばらくしてから、もう一度お試しください。" };
  if (read.status === "no_profile") return { status: "error", message: "プロフィールがまだ保存されていません。先にプロフィールを保存してください。" };
  if (read.status === "incomplete") return { status: "error", message: read.message };

  const { fn, params } = buildSaveParams(read.stored, v.values);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc(fn, params);
  if (error) return { status: "error", message: "保存に失敗しました。入力は残してあります。しばらくしてから、もう一度お試しください。" };

  revalidatePath("/stylist/profile");
  revalidatePath("/stylist/profile/preview");
  revalidatePath("/stylist/mypage");
  revalidatePath("/stylist/diagnosis/student/result");
  return { status: "saved", values: v.values };
}
