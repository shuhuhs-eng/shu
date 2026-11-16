"use server";

import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isNewgradEntryEnabled, verifySubmission, type Declared, type DiagnosisMode } from "@/lib/diagnosis";
import { runAiGenerationJob } from "@/lib/diagnosis-handoff/claim";
import { logError } from "@/lib/security/log";
import { commitDiagnosisResult, type CommitClient } from "@/lib/diagnosis-limit/commit";
import type { LimitErrorCode } from "@/lib/diagnosis-limit/messages";

export type SubmitLoggedInResult =
  | { success: true; diagnosisResultId: string; action: string; lockedUntil: string | null }
  | { success: false; error: string; code?: LimitErrorCode; message?: string; lockedUntil?: string | null };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ログイン済みユーザーが30問（または14問）診断を完了した際に、
 * pending_diagnoses/claim_tokenを経由せず、その場で直接
 * diagnosis_results へ確定保存する。
 *
 * 背景（不具合の原因）: 従来はログイン状態に関わらず常に
 * /api/diagnosis/guest → pending_diagnoses → claimPendingDiagnosisIfPresent()
 * という経路のみが存在した。claimPendingDiagnosisIfPresent() は
 * ログイン処理（signInAction・auth/callback）の中でしか呼ばれないため、
 * 既にログイン済みのユーザーが診断（初回・再診断とも）を受けても、
 * 再度ログインするイベントが発生せず、diagnosis_results が
 * 永久に作成されないままになっていた。この関数はその欠落経路を埋める。
 *
 * ★未ログイン時の既存フロー（/api/diagnosis/guest・pending_diagnoses・
 * claim_token・claimPendingDiagnosisIfPresent()）には一切触れていない。
 * この関数はログイン済みの場合にのみ呼ばれる、完全に独立した経路。
 *
 * 計算ロジックの再利用: フロント側の計算結果は信用せず、
 * lib/diagnosis-handoff/claim.ts の claimPendingDiagnosisIfPresent() と
 * 全く同じ手順で、サーバー側の computeDiagnosis() により回答から
 * 再計算する（診断計算ロジック自体は一切変更していない）。
 *
 * 8タイプ判定: modeが"stylist"の場合のみ、INSERTされた
 * diagnosis_results.id を使って既存の save_core_type_result() RPC
 * （SECURITY DEFINER、生スコアから独自に再計算する唯一の正規経路）を
 * 呼ぶ。claim.ts と同様にベストエフォート（失敗してもdiagnosis_results
 * 自体は保存済みのため致命的ではない）。
 *
 * 再診断: source_pending_id を使わない（pending_diagnoses経由ではない
 * ため）ため一意制約の対象外であり、呼び出すたびに新しい
 * diagnosis_results 行が追加される。マイページは created_at 降順で
 * 最新1件を取得する既存仕様のため、再診断のたびに最新結果として
 * 反映される（既存仕様を壊さない）。
 *
 * AI解説生成: diagnosis_results保存・save_core_type_result()の後、
 * claim.ts の claimPendingDiagnosisIfPresent() と全く同じ
 * runAiGenerationJob()（exportされた既存関数、ロジックは無変更）を
 * after() 経由で呼ぶ。新しいAI生成ロジックは作っていない。
 * AI生成の成否はdiagnosis_results保存・8タイプ判定の成否とは独立して
 * おり、AI生成に失敗してもこの関数はsuccess:trueを返す
 * （診断本体の保存をAI生成失敗で巻き込まない、claim.tsと同じ方針）。
 */
export async function submitDiagnosisForLoggedInUser(
  mode: DiagnosisMode,
  answers: unknown,
  requestId: string,
  declared?: Declared,
): Promise<SubmitLoggedInResult> {
  // 保存する診断バージョンはサーバーが1問目の回答から決める。申告（版・質問ID）は並びの照合にだけ使う。
  const verified = verifySubmission(mode, answers, declared, { newgradEnabled: isNewgradEntryEnabled() });
  if (!verified.ok) {
    return { success: false, error: verified.error };
  }
  // 確認画面で1回だけ作られ、再送でも同じ値が送られる保存の識別子。これが無い・形が違う送信は受け付けない。
  if (typeof requestId !== "string" || !UUID_RE.test(requestId)) {
    return { success: false, error: "invalid_request_id" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // ログイン済み専用の経路のため、未ログインならここでは処理しない。
    // 呼び出し元（diagnosis-quiz.tsx）は事前にログイン状態を確認した上で
    // この関数を呼ぶ設計だが、セッション切れ等の防御として明示的にエラーを返す。
    return { success: false, error: "not_authenticated" };
  }

  // サーバー側で回答から再計算する（クライアントの計算結果は信用しない）。
  // lib/diagnosis-handoff/claim.ts と全く同じ関数・同じ手順。
  const computed = verified.computed;

  // ★0058: 回数制限つきの確定保存（commit_diagnosis_result。service_role専用）。認証済みの本人（上のgetUser）の
  // user_idと、サーバーが回答から再計算した値だけを渡す。判定・消費・排他・重複検知はDB側。
  // 失敗しても回数は消費されない（DBは保存と同じトランザクションで消費する）。同じrequestIdの再送は、再保存せず前回の結果を返す。
  const committed = await commitDiagnosisResult(createServiceClient() as unknown as CommitClient, {
    userId: user.id,
    requestId,
    allowChange: true,
    computed,
    answers,
  });

  if (!committed.ok) {
    logError("submitDiagnosis.commit", { code: committed.error.code });
    return {
      success: false,
      error: committed.error.code === "unknown" ? "save_failed" : committed.error.code,
      code: committed.error.code,
      message: committed.error.message,
      lockedUntil: committed.error.lockedUntil,
    };
  }

  const diagnosisResultId: string = committed.resultId;

  // 8タイプ（front-facing称号）の判定・保存。美容師診断のみ対象。
  // ベストエフォート：失敗してもdiagnosis_results自体は保存済みのため、
  // 呼び出し元へは success を返す（claim.tsと同じ方針）。
  if (mode === "stylist") {
    const { error: coreTypeError } = await supabase.rpc("save_core_type_result", {
      p_diagnosis_result_id: diagnosisResultId,
    });
    if (coreTypeError) {
      logError("submitDiagnosis.coreType", coreTypeError);
    }
  }

  // AI解説の生成は非同期ジョブとして実行し、レスポンスをブロックしない。
  // claim.ts の claimPendingDiagnosisIfPresent() と全く同じ手順・同じ
  // runAiGenerationJob()を再利用する（新しいAI生成ロジックは作らない）。
  // ★重要: after() のコールバック内では cookies() 等の
  // リクエストスコープAPIが使えないため、ここでリクエストコンテキストが
  // まだ生きているうちに access_token を文字列として取得しておく。
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token ?? null;

  if (accessToken) {
    after(() => runAiGenerationJob(diagnosisResultId, computed, accessToken));
  } else {
    // セッションのアクセストークンが取得できない場合はAI生成をスキップする
    // （ベストエフォート。診断結果自体は既に保存済みのため致命的ではない。
    // claim.tsと同じ方針）。
    console.error("submitDiagnosisForLoggedInUser: no access token available, skipping AI generation");
  }

  return { success: true, diagnosisResultId, action: committed.action, lockedUntil: committed.lockedUntil };
}
