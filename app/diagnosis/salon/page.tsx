import { redirect } from "next/navigation";
import { DiagnosisQuiz } from "@/components/diagnosis/diagnosis-quiz";
import { createClient } from "@/lib/supabase/server";
import { hasCompletedRole } from "@/lib/auth/user-roles";

// ログイン状態をサーバー側で確認し、DiagnosisQuizへ渡す（stylist側と同じ理由。
// サロン診断はsave_core_type_result()の対象外だが、diagnosis_results自体の
// 保存漏れは同様に起こり得るため、mode非依存で同じ仕組みを適用する）。
//
// ★「1 auth user = 1 role」方針: ログイン済みかつstylist roleを既に持つ
// ユーザーは、サロン診断を受けられないようにする（多重防御。middlewareでも
// 同様のチェックを行っている）。未ログインユーザーには影響しない。
export default async function SalonDiagnosisPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user && (await hasCompletedRole(supabase, user.id, "stylist"))) {
    redirect("/stylist/mypage");
  }

  return <DiagnosisQuiz mode="salon" isLoggedIn={!!user} />;
}
