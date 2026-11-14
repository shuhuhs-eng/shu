import Link from "next/link";
import { requireAdminPage } from "@/lib/admin/guard";
import { getOrganization, getStylist } from "@/lib/admin/directory";
import { isUuid, requestIdFrom } from "@/lib/messages/shared";
import { createThreadAction } from "@/lib/messages/actions";
import { MessageForm } from "@/components/messages/message-form";

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** 運営: 新しい連絡の作成。宛先は会社・店舗／美容師の詳細から渡される（IDだけを受け取り、名前はDBから取り直して確認表示する）。 */
export default async function NewThreadPage({ searchParams }: { searchParams: SP }) {
  const { supabase } = await requireAdminPage("/admin/messages");
  const sp = await searchParams;
  const audience = one(sp.audience) === "stylist" ? "stylist" : "salon";
  const org = one(sp.org), store = one(sp.store), rcp = one(sp.recipient);
  let target = "";
  if (audience === "salon" && isUuid(org)) {
    const r = await getOrganization(supabase, org);
    if (r.ok) { const st = isUuid(store) ? r.data.stores.find((x) => x.id === store) : undefined; target = `${r.data.organization.name}${st ? ` / ${st.name}` : "（会社全体）"}`; }
  }
  if (audience === "stylist" && isUuid(rcp)) {
    const r = await getStylist(supabase, rcp);
    if (r.ok) target = r.data.public_name || r.data.full_name || r.data.email;
  }
  const rid = requestIdFrom(undefined);
  return (
    <main className="mx-auto max-w-[900px] px-5 py-10">
      <Link href="/admin/messages" className="text-[13px] font-semibold text-sub underline">← 連絡</Link>
      <h1 className="mt-3 font-serif text-xl font-bold text-ink">新しい連絡</h1>
      {!target ? (
        <p className="mt-6 rounded-lg bg-[#C24545]/10 px-3 py-2 text-[12.5px] text-[#8A2E2E]">宛先を確認できませんでした。<Link href="/admin/salons" className="underline">会社・店舗</Link>または<Link href="/admin/stylists" className="underline">美容師</Link>の詳細から、もう一度開いてください。</p>
      ) : (
        <>
          <p className="mt-2 text-[13px] text-charcoal">宛先: <b>{target}</b>（{audience === "salon" ? "サロン" : "美容師"}宛）</p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-sub">サロン宛は、その会社（店舗を選んだ場合はその店舗）の連絡を見られる担当者に届きます。閲覧できるのは、会社のオーナー・管理者・採用管理者、または店舗の店長・採用担当です。閲覧のみの担当者は見られません。</p>
          <MessageForm action={createThreadAction} initialRequestId={rid} withSubject submitLabel="連絡を作成する" placeholder="本文"
            hidden={{ audience, ...(audience === "salon" ? { organization_id: org, ...(isUuid(store) ? { store_id: store } : {}) } : { recipient_user_id: rcp }) }}
            goToThread={(id) => `/admin/messages/${id}`} note="二重に押しても、同じ内容は1件だけ作成されます。通知メールは送信されません。" />
        </>
      )}
    </main>
  );
}
