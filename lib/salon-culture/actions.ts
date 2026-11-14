"use server";

// ★本人のサロンらしさの保存（下書き・確定）は lib/salon-culture/draft-actions.ts（0058: 回数制限つき）へ移した。
// ここには、確定済みの結果に対するAI紹介文の作り直しだけが残っている。
import { createClient } from "@/lib/supabase/server";
import { runSalonCultureAiGenerationJob } from "@/lib/salon-culture/run-culture-ai-job";
import { runSalonAiRetry, type SalonAiRetryResult } from "@/lib/salon-culture/ai-retry";
import { checkSharedRateLimit } from "@/lib/rate-limit/shared-rate-limiter";

/**
 * 回答済み（completed）なのにAI紹介文が無いサロンが、画面のボタンから紹介文を作り直す。
 * 認証・本人のサロンらしさ・RPC内のsalon権限確認（create_salon_culture_ai_output）は、保存時と同じ経路。
 * 重複実行・費用の上限は runSalonAiRetry を参照。
 */
export async function generateSalonCultureAiAction(): Promise<SalonAiRetryResult | { status: "unauthenticated" }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "unauthenticated" };

  const { data: culture } = await supabase
    .from("salon_culture_profiles")
    .select("*")
    .eq("salon_user_id", user.id)
    .maybeSingle();
  if (!culture) return { status: "not_completed" };

  const { data: outputs } = await supabase
    .from("salon_culture_ai_outputs")
    .select("output_type")
    .eq("salon_culture_profile_id", culture.id)
    .eq("prompt_version", "salon-culture-v1")
    .eq("is_current", true);

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token ?? null;
  if (!accessToken) return { status: "unauthenticated" };

  return runSalonAiRetry({
    completed: culture.status === "completed",
    existingCurrentTypes: (outputs ?? []).map((o: { output_type: string }) => o.output_type),
    limiter: (key, limit, windowMs) => checkSharedRateLimit(key, limit, windowMs),
    userId: user.id,
    runJob: () => runSalonCultureAiGenerationJob(culture, accessToken),
  });
}
