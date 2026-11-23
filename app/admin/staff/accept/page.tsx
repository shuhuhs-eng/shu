import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOperatorState } from "@/lib/admin/operator";
import { operatorHomePath } from "@/lib/admin/operator-state";
import { staffSignOutAction } from "@/app/admin/staff/actions";
import { AcceptForm } from "./accept-form";

/** 承諾前（招待中）のスタッフ専用画面。承諾するまで運営の業務画面・操作は使えない（DBが拒否する）。 */
export default async function StaffAcceptPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/admin/login");
  const state = await getOperatorState(supabase);
  if (state !== "staff_invited" && state !== "staff_invited_expired") redirect(operatorHomePath(state) ?? "/mypage");
  const expired = state === "staff_invited_expired";
  return (
    <main className="mx-auto max-w-[560px] px-5 py-12">
      <h1 className="text-[20px] font-bold text-charcoal">運営スタッフへの招待</h1>
      {expired ? (
        <p className="mt-4 text-[14px] leading-relaxed text-charcoal">招待の有効期限が切れています。責任者に再招待を依頼してください。</p>
      ) : (
        <p className="mt-4 text-[14px] leading-relaxed text-charcoal">招待を承諾すると、見学・体験入店の受付、担当の変更、日程の調整、双方への確認、連絡などの運営業務を行えるようになります。請求・料金・契約・権限の設定は責任者のみが行います。</p>
      )}
      <AcceptForm disabled={expired} />
      <form action={staffSignOutAction} className="mt-4"><button type="submit" className="min-h-[44px] text-[13px] text-charcoal underline">ログアウト</button></form>
    </main>
  );
}
