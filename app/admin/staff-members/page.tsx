import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdminPage } from "@/lib/admin/guard";
import { parseOpenInvitations, parseStaffList } from "@/lib/admin/staff-admin";
import { StaffManager } from "@/components/admin/staff-manager";

/** スタッフ管理（責任者のみ）。スタッフは requireAdminPage で自分の画面へ戻され、各RPCもDBが責任者以外を拒否する。 */
export default async function StaffMembersPage() {
  const { supabase } = await requireAdminPage("/admin/staff-members");
  const rpc = (supabase as unknown as Pick<SupabaseClient, "rpc">).rpc.bind(supabase);
  const [l, o] = await Promise.all([rpc("admin_staff_list"), rpc("admin_staff_invitations_open")]);
  const staff = l.error ? null : parseStaffList(l.data);
  const open = o.error ? null : parseOpenInvitations(o.data);
  return (
    <main className="mx-auto max-w-[900px] px-5 py-10">
      <h1 className="text-[20px] font-bold text-charcoal">運営スタッフの管理</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-charcoal">
        招待・再招待・名前の変更・停止と再開・パスワード再設定の案内ができます。パスワードは本人が自分で設定し、ここには表示されません。
        スタッフは、請求・料金・契約・権限の設定には入れません。履歴のあるスタッフは削除せず、停止で運用します。
      </p>
      {staff === null || open === null ? (
        <p role="alert" className="mt-6 rounded-xl border border-line bg-surface2 px-4 py-3 text-[13px] text-charcoal">一覧を取得できませんでした。時間をおいて、再読み込みしてください。</p>
      ) : (
        <StaffManager staff={staff} open={open} nowIso={new Date().toISOString()} />
      )}
    </main>
  );
}
