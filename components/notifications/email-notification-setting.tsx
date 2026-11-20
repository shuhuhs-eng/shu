import { createClient } from "@/lib/supabase/server";
import { looseRpc } from "@/lib/diagnosis-limit/rpc";
import { setMyEmailNotificationsAction } from "@/app/notification-settings/actions";

/** 通知メールの受け取り設定（既定はオン）。オフにしてもサイト内の通知とログイン関連のメールは変わらない。自分の分だけ。 */
export async function EmailNotificationSetting({ back, result }: { back: "/stylist/mypage" | "/salon/mypage"; result?: string }) {
  const supabase = await createClient();
  const { data, error } = await looseRpc(supabase).rpc("get_my_email_notifications", {});
  const known = !error && typeof data === "boolean";
  const enabled = known ? (data as boolean) : true;
  return (
    <section data-testid="email-setting" className="mt-8 rounded-2xl border border-line bg-surface p-4">
      <h2 className="font-serif text-[15px] font-bold text-ink">通知メール</h2>
      <p className="mt-1 text-[12px] text-charcoal">新しい通知があったときに、登録のメールアドレスへお知らせします。オフにしても、サイト内の通知とログイン・パスワード再設定のメールは変わりません。</p>
      {result === "ok" && <p role="status" className="mt-2 text-[12px] text-charcoal">設定を変更しました。</p>}
      {(result === "failed" || result === "invalid") && <p role="alert" className="mt-2 text-[12px] text-[#8A2E2E]">設定を変更できませんでした。時間をおいてもう一度お試しください。</p>}
      {!known ? <p className="mt-2 text-[12px] text-sub">現在の設定を取得できませんでした。</p> : (
        <form action={setMyEmailNotificationsAction} className="mt-3 flex flex-wrap items-center gap-3">
          <input type="hidden" name="back" value={back} />
          <input type="hidden" name="enabled" value={enabled ? "0" : "1"} />
          <span data-testid="email-setting-state" className="text-[12.5px] font-semibold text-ink">{enabled ? "メールで受け取る（現在）" : "メールでは受け取らない（現在）"}</span>
          <button className="min-h-[40px] rounded-full border border-line bg-surface px-4 text-[12px] font-semibold text-ink">{enabled ? "メールでの通知をオフにする" : "メールでの通知をオンにする"}</button>
        </form>
      )}
    </section>
  );
}
