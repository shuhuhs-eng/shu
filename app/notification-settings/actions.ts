"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { looseRpc } from "@/lib/diagnosis-limit/rpc";

const BACK = new Set(["/stylist/mypage", "/salon/mypage"]);

/** 自分の「通知メール」だけを切り替える（DB側は auth.uid() の1行だけを更新）。サイト内通知・認証メールは対象外。 */
export async function setMyEmailNotificationsAction(formData: FormData) {
  const back = String(formData.get("back") ?? "");
  const to = BACK.has(back) ? back : "/";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(to)}`);
  const v = formData.get("enabled");
  if (v !== "1" && v !== "0") redirect(`${to}?email_pref=invalid`);
  const { error } = await looseRpc(supabase).rpc("set_my_email_notifications", { p_enabled: v === "1" });
  revalidatePath(to);
  redirect(`${to}?email_pref=${error ? "failed" : "ok"}`);
}
