import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOperatorState } from "@/lib/admin/operator";
import { operatorHomePath } from "@/lib/admin/operator-state";
import { PasswordForm } from "./password-form";

/** リンク確認後のパスワード設定。招待中（承諾も同時）か、有効なスタッフ（再設定）だけが使える。 */
export default async function StaffPasswordPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/staff-invite");
  const state = await getOperatorState(supabase);
  if (state !== "staff_invited" && state !== "staff_active") redirect(operatorHomePath(state) ?? "/");
  const accepting = state === "staff_invited";
  return (
    <main className="mx-auto max-w-[560px] px-5 py-12">
      <h1 className="text-[20px] font-bold text-charcoal">{accepting ? "運営スタッフ：パスワードを決めて招待を承諾" : "パスワードの再設定"}</h1>
      <p className="mt-4 text-[14px] leading-relaxed text-charcoal">
        パスワードはあなた自身が決めます（責任者には表示されません）。
        {accepting ? "設定すると招待を承諾し、運営スタッフ画面へ進みます。承諾できるのは招待から14日以内です。" : "設定後、そのまま運営スタッフ画面へ進みます。"}
      </p>
      <PasswordForm accepting={accepting} />
    </main>
  );
}
