import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StylistPublicView } from "@/components/profile/stylist-public-view";
import { StatusPanel } from "@/components/error-panel";
import { initialVisibility } from "@/lib/profile/get-initial-values";
import { ageOn, readOwnBirthDate, todayJst } from "@/lib/profile/birth-date";
import { getAvatarSignedUrl } from "@/lib/storage/avatar";
import type { SnsLink } from "@/types/database";

/**
 * サロン向けプレビュー。本人が保存した内容を、サロン側の一覧と同じ部品（StylistPublicView）で表示する。
 * 読むのは本人の行だけ（本人のRLSの範囲）。氏名・性別・年代・生年月日・希望年収帯は表示しない。
 * 画像・雇用形態・Instagram・大切にしたいこと・年齢は、DBが0070（草案・未適用）に対応しているときだけ
 * サロン側にも出るため、プレビューも同じ条件（生年月日列を読めるか）で出し分け、実際のサロン表示と揃える。
 * 公開／非公開の状態を明示し、非公開のときは「サロンには表示されない」ことを示す。
 */
export default async function StylistProfilePreviewPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/stylist/profile/preview");

  const [{ data: pub, error }, { data: profile }, birth] = await Promise.all([
    supabase.from("stylist_profiles").select("*").eq("user_id", user.id).maybeSingle(),
    supabase.from("profiles").select("avatar_path").eq("id", user.id).maybeSingle(),
    readOwnBirthDate(supabase, user.id),
  ]);
  const extended = birth.supported;
  const avatarUrl = extended ? await getAvatarSignedUrl(supabase, profile?.avatar_path ?? null) : null;
  const instagramHandle = ((pub?.sns_links ?? []) as SnsLink[]).find((l) => l.platform === "instagram")?.handle || null;

  const back = (
    <Link href="/stylist/profile" className="text-[12px] font-semibold text-sub underline shrink-0">
      プロフィール編集へ戻る
    </Link>
  );

  if (error) {
    return (
      <StatusPanel
        title="プレビューを表示できませんでした"
        action={
          <Link href="/stylist/profile/preview" className="flex w-full items-center justify-center rounded-full bg-ink px-6 py-4 text-[15px] font-semibold text-surface">
            もう一度試す
          </Link>
        }
      >
        <p>プロフィールを読み込めませんでした。通信状況を確認して、もう一度お試しください。</p>
      </StatusPanel>
    );
  }

  const visibility = pub ? initialVisibility(pub) : null;

  return (
    <main className="mx-auto max-w-[560px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5">
        <span className="eyebrow">Beauty Reach</span>
        <hr className="h-px flex-1 border-0 bg-line" />
        {back}
      </div>
      <h1 className="font-serif text-2xl font-bold text-ink">サロン向けプレビュー</h1>
      <p className="mt-3 text-[13.5px] leading-relaxed text-charcoal">保存済みの内容が、サロンにはこのように表示されます。</p>

      {!pub ? (
        <p className="mt-6 rounded-xl border border-line bg-surface2 px-4 py-3 text-[13px] text-charcoal">プロフィールがまだ保存されていません。プロフィールを保存すると、ここに表示されます。</p>
      ) : (
        <>
          <p
            role="status"
            className={`mt-5 rounded-xl border px-4 py-3 text-[13px] leading-relaxed ${visibility === "PUBLIC" ? "border-[#2E8B7F]/40 bg-[#2E8B7F]/[0.08] text-[#1F6B61]" : "border-line bg-surface2 text-charcoal"}`}
          >
            <span className="font-bold">{visibility === "PUBLIC" ? "【公開中】" : "【非公開】"}</span>
            {visibility === "PUBLIC" ? "サロンの一覧に表示され、スカウトを受け取れます。" : "サロンの一覧・検索には表示されません。下は、公開した場合の表示です。"}
          </p>

          <div className="mt-5 rounded-2xl border border-line bg-surface p-5">
            <StylistPublicView
              data={{
                publicName: pub.public_name,
                prefecture: pub.prefecture,
                currentPosition: pub.current_position,
                experienceYears: pub.experience_years,
                desiredWorkLocation: pub.desired_work_location,
                jobChangeIntent: pub.job_change_intent,
                specialties: pub.specialties,
                bio: pub.bio,
                extended,
                avatarUrl,
                employmentType: pub.employment_type,
                instagramHandle,
                valuePriorities: pub.value_priorities,
                age: ageOn(birth.birthDate, todayJst()),
              }}
            />
          </div>

          <p className="mt-4 text-[12px] leading-relaxed text-sub">
            氏名・性別・年代・生年月日・希望年収帯は、サロンには表示されません（保存済みの内容は削除されません）。
            {extended
              ? "年齢は満年齢だけが表示され、生年月日が未入力の場合は「未登録」と表示されます。"
              : "プロフィール画像・雇用形態・Instagram・大切にしたいこと・年齢は、サービスの更新後にサロンへ表示されます（更新前はこのプレビューにも出ません）。"}
          </p>
        </>
      )}

      <Link href="/stylist/profile" className="mt-6 flex min-h-[48px] w-full items-center justify-center rounded-full border border-line bg-surface px-6 py-3.5 text-[14px] font-semibold text-ink">
        プロフィールを編集する
      </Link>
    </main>
  );
}
