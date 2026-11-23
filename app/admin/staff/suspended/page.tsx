import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOperatorState } from "@/lib/admin/operator";
import { operatorHomePath } from "@/lib/admin/operator-state";
import { staffSignOutAction } from "@/app/admin/staff/actions";

/** 停止中のスタッフ専用画面。業務の画面・操作は使えない（DBが拒否する）。再開は責任者のみ。 */
export default async function StaffSuspendedPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/admin/login");
  const state = await getOperatorState(supabase);
  if (state !== "staff_suspended") redirect(operatorHomePath(state) ?? "/mypage");
  return (
    <main className="mx-auto max-w-[560px] px-5 py-12">
      <h1 className="text-[20px] font-bold text-charcoal">運営アカウントは停止されています</h1>
      <p className="mt-4 text-[14px] leading-relaxed text-charcoal">現在、運営の業務画面は利用できません。再開は責任者が行います。心当たりがない場合は、責任者へお問い合わせください。</p>
      <form action={staffSignOutAction} className="mt-6"><button type="submit" className="min-h-[44px] rounded-full border border-line px-6 text-[14px] font-semibold text-charcoal">ログアウト</button></form>
    </main>
  );
}
