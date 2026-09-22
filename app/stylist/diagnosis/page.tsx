import { redirect } from "next/navigation";
import { DiagnosisQuiz } from "@/components/diagnosis/diagnosis-quiz";
import { createClient } from "@/lib/supabase/server";
import { hasCompletedRole } from "@/lib/auth/user-roles";

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

  return <DiagnosisQuiz mode="stylist" isLoggedIn={!!user} />;
}
