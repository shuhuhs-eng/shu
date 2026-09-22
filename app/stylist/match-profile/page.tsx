import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasCompletedRole } from "@/lib/auth/user-roles";
import { MatchProfileWizard } from "@/components/match-profile/match-profile-wizard";
import { EvidenceUploader } from "@/components/match-profile/evidence-uploader";

export default async function StylistMatchProfilePage({ searchParams }: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/stylist/match-profile");
  if (!(await hasCompletedRole(supabase, user.id, "stylist"))) redirect("/onboarding");
  const { data: profile } = await supabase.from("stylist_match_profiles").select("*").eq("stylist_user_id", user.id).maybeSingle();
  const { data: evidenceDocuments } = await supabase.from("stylist_evidence_documents").select("*").eq("stylist_user_id", user.id).order("created_at");
  const params = await searchParams;
  return <main className="mx-auto max-w-[560px] px-5 py-12">
    <div className="mb-7 flex items-center gap-2.5"><span className="eyebrow">Beauty Reach</span><hr className="h-px flex-1 border-0 bg-line" /></div>
    <p className="eyebrow mb-2">オーダーメイドマッチ</p>
    <h1 className="font-serif text-2xl font-bold text-ink">転職で変えたいことと<br />あなたの実績</h1>
    <p className="mt-3 text-[13px] leading-relaxed text-charcoal">通常マッチングは簡単入力だけ。実績による給与相談は希望する方だけ利用できます。</p>
    {params.saved === "1" && <p className="mt-6 rounded-xl border border-[#37755B]/25 bg-[#37755B]/10 px-4 py-3 text-[13px] text-[#285B45]">実績を保存しました。続けて証明資料を提出できます。</p>}
    <div className="mt-8"><MatchProfileWizard initialProfile={profile ?? null} /></div>
    {profile?.career_stage === "results_stylist" && profile.wants_performance_offer && <EvidenceUploader userId={user.id} initialDocuments={evidenceDocuments ?? []} />}
    <Link href="/stylist/mypage" className="mt-6 block text-center text-[13px] text-sub underline">マイページに戻る</Link>
  </main>;
}
