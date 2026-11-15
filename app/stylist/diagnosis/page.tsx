import { redirect } from "next/navigation";
import { DiagnosisQuiz } from "@/components/diagnosis/diagnosis-quiz";
import { createClient } from "@/lib/supabase/server";
import { hasCompletedRole } from "@/lib/auth/user-roles";
import { getDiagnosisChangeStatus } from "@/lib/diagnosis-limit/status";
import { formatJstDateTime } from "@/lib/diagnosis-limit/messages";
import Link from "next/link";
import { readOwnCareerPhase } from "@/lib/student-diagnosis/career-phase";

// ログイン状態をサーバー側で確認し、DiagnosisQuizへ渡す。ログイン済みの
// 場合は診断完了時に /api/diagnosis/guest ではなくログイン済み専用の
// Server Action（submitDiagnosisForLoggedInUser）を使うようにするため
// （不具合修正: ログイン済みユーザーの診断結果がdiagnosis_resultsへ
// 保存されなかった問題への対応）。
//
// ★「1 auth user = 1 role」方針: ログイン済みかつsalon roleを既に持つ
// ユーザーは、美容師診断を受けられないようにする（多重防御。middlewareでも
// 同様のチェックを行っている）。未ログインユーザーの診断プレビュー導線
// （現在正常）には一切影響しない。
export default async function StylistDiagnosisPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user && (await hasCompletedRole(supabase, user.id, "salon"))) {
    redirect("/salon/mypage");
  }

  // 回数制限中は、質問に答えてもらう前に案内する（答えたあとで保存できないとわかるより親切）。
  // 状態が取れないとき（0058の適用前など）は案内を出さず、これまでどおり進める。
  const limitStatus = user ? await getDiagnosisChangeStatus(supabase, "stylist") : undefined;
  if (limitStatus?.state === "locked" && limitStatus.lockedUntil) {
    return (
      <main className="mx-auto max-w-[520px] px-5 py-10">
        <h1 className="font-serif text-2xl font-bold leading-snug text-ink">いまは診断結果を変更できません</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-charcoal">
          次に変更できるのは {formatJstDateTime(limitStatus.lockedUntil)} 以降です。それまでは、いまの結果をマイページで確認できます。
        </p>
        <Link
          href="/stylist/mypage"
          className="mt-6 flex min-h-[48px] w-full items-center justify-center rounded-full bg-ink px-6 py-4 text-[15px] font-semibold text-surface"
        >
          マイページで結果を見る
        </Link>
      </main>
    );
  }

  // 新卒向け診断の入口は、0071適用済みで、本人が立場を「新卒」にしているときだけ出す（立場は本人の選択のみ・推測しない）。
  const phaseRead = user ? await readOwnCareerPhase(supabase, user.id) : null;
  const studentSupported = phaseRead?.status === "ok" && phaseRead.value.phase === "new_graduate";

  return (
    <>
      {studentSupported && (
        <div className="mx-auto max-w-[520px] px-5 pt-6">
          <p className="rounded-2xl border border-line bg-surface2 px-4 py-3 text-[13px] leading-relaxed text-charcoal">
            新卒の方は、実績を聞かない専用の診断があります。
            <Link href="/stylist/diagnosis/student" className="ml-1 font-semibold text-ink underline">新卒向けの診断へ</Link>
          </p>
        </div>
      )}
      <DiagnosisQuiz mode="stylist" isLoggedIn={!!user} limitStatus={limitStatus} />
    </>
  );
}
