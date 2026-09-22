import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { EvidenceReviewCard } from "@/components/admin/evidence-review-card";

export default async function AdminEvidencePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/evidence");
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (!isAdmin) redirect("/mypage");
  const { data: queue, error } = await supabase.rpc("get_admin_evidence_queue");
  if (error) throw new Error("資料一覧を取得できませんでした。");
  const items = await Promise.all((queue ?? []).map(async (item) => {
    const { data } = await supabase.storage.from("stylist-evidence").createSignedUrl(item.storage_path, 15 * 60);
    return { ...item, signed_url: data?.signedUrl ?? null, is_pdf: item.storage_path.endsWith(".pdf") };
  }));
  return <main className="mx-auto max-w-[760px] px-5 py-12">
    <div className="mb-7 flex items-center gap-2.5"><span className="eyebrow">Beauty Reach Admin</span><hr className="h-px flex-1 border-0 bg-line" /></div>
    <h1 className="font-serif text-2xl font-bold text-ink">実績資料の確認</h1>
    <p className="mt-2 text-[12.5px] leading-relaxed text-sub">資料と申告数字の一致を確認します。原本の真正性を保証する判定ではありません。表示URLは15分で失効します。</p>
    <div className="mt-8 space-y-5">{items.length > 0 ? items.map((item) => <EvidenceReviewCard key={item.id} item={item} />) : <p className="rounded-2xl border border-line bg-surface p-8 text-center text-[13px] text-sub">提出資料はありません。</p>}</div>
    <Link href="/mypage" className="mt-7 block text-center text-[13px] text-sub underline">マイページへ戻る</Link>
  </main>;
}

