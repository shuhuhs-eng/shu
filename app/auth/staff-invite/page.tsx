import { createClient } from "@/lib/supabase/server";
import { parseStaffLinkParams, staffLinkReturnPath } from "@/lib/admin/staff-link";
import { linkSignOutAction } from "./actions";
import { LinkForm } from "./link-form";

/** 招待・パスワード再設定リンクの確認ページ。開いただけでは何も消費しない（ボタンで初めて進む）。 */
export default async function StaffInviteLinkPage({ searchParams }: { searchParams: Promise<{ token_hash?: string | string[]; type?: string | string[] }> }) {
  const p = parseStaffLinkParams(await searchParams);
  if (!p.ok) {
    return (
      <main className="mx-auto max-w-[560px] px-5 py-12">
        <h1 className="text-[20px] font-bold text-charcoal">リンクが正しくありません</h1>
        <p className="mt-4 text-[14px] leading-relaxed text-charcoal">招待メールのリンクを、そのまま開いてください。解決しない場合は、責任者に再招待を依頼してください。</p>
      </main>
    );
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <main className="mx-auto max-w-[560px] px-5 py-12">
      <h1 className="text-[20px] font-bold text-charcoal">運営スタッフ：パスワードの設定</h1>
      <p className="mt-4 text-[14px] leading-relaxed text-charcoal">続けるボタンを押すと、本人確認が完了し、パスワードを設定する画面へ進みます。リンクは一度だけ使えます。</p>
      {user && (
        <div className="mt-4 rounded-xl border border-line bg-surface2 px-4 py-3 text-[13px] leading-relaxed text-charcoal" data-testid="other-login-notice">
          いま <strong>{user.email}</strong> でログインしています。続けると、このアカウントはログアウトされ、リンクの本人として進みます。
          別の人のリンクの場合は、このまま閉じてください。
        </div>
      )}
      <LinkForm tokenHash={p.tokenHash} type={p.type} label="続ける" />
      {user && (
        <form action={linkSignOutAction} className="mt-3">
          <input type="hidden" name="back" value={staffLinkReturnPath(p)} />
          <button type="submit" className="min-h-[44px] text-[13px] text-charcoal underline">先にログアウトする</button>
        </form>
      )}
    </main>
  );
}
