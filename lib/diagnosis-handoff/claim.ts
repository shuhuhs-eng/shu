import { cookies } from "next/headers";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { createTokenClient } from "@/lib/supabase/token-client";
import { computeDiagnosis, isValidAnswers, type ComputedDiagnosis } from "@/lib/diagnosis";
import { generateDiagnosisNarrative } from "@/lib/ai/generate-diagnosis-narrative";
import { CLAIM_BINDING_COOKIE, CLAIM_TOKEN_COOKIE } from "@/lib/diagnosis-handoff/constants";
import { verifySignUpBinding, type AuthUserForClaim } from "@/lib/diagnosis-handoff/new-account";
import { logError } from "@/lib/security/log";

export type ClaimResult = { claimed: boolean; diagnosisResultId: string | null };

/**
 * 未ログインで受けた診断（ゲスト診断）を、「新しく作られたアカウント」の初回結果として引き継ぐ。
 *
 * ★既存アカウントへのログインでは呼ばない（呼んではいけない）。既存会員が未ログインで別の診断を
 *   出してからログインしても、保存済みの診断結果・タイプ・マイページの表示は変えない。
 *   ログインした事実は、ゲスト診断を保存することへの同意として扱わない（lib/auth/actions.ts の signInAction は
 *   discardGuestDiagnosisCookie() だけを呼ぶ）。
 *
 * 引き継ぐのは、サーバーが署名した「新規登録の印」（verifySignUpBinding）が、このユーザーID×今のゲスト診断に
 * 対して有効なときだけ。印は signUp が「今まさに新しく作ったユーザー」を返した直後にだけサーバーが発行する
 * （lib/auth/actions.ts / isUserCreatedBySignUp）ので、既存会員や、確認待ちメールでの再登録では発行されない。
 * 利用者が書き換えられる user_metadata・URLのフラグ・localStorage の印は使わない。呼び出し元は、signUp の直後（確認不要の設定の場合）と、
 * メール確認コールバック（パスワード再設定ではない場合）だけ。
 *
 * 以降の処理は従来どおり（claim_status: PENDING → PROCESSING → COMPLETED）。
 * ★途中で失敗して PROCESSING のまま残った場合の再開は、同じ呼び出し元（新規登録の確認直後）で
 *   印の有効期間（24時間）の間だけ行える。期限を過ぎたら自動では再開しない
 *   （ログインでは再開しない。遅れて保存される経路を作らないため）。
 * 処理順序:
 *   1. Cookieのclaim_tokenを読む（無ければ何もしない）
 *   2. start_pending_diagnosis_claim() RPCで PENDING→PROCESSING（二重クレームはRPC側で防止。
 *      同一ユーザーによる再試行は同じPROCESSING行を冪等に返す）
 *   3. 返ってきた回答からサーバー側で再計算（クライアントの計算値は信用しない）
 *   4. diagnosis_results へ保存（source_pending_idのUNIQUE制約で重複INSERTを防止。
 *      再試行で既に保存済みの場合は既存行を取得する）
 *   4.5. 美容師診断の場合のみ、8タイプ（front-facing称号）を save_core_type_result()
 *        RPC経由で判定・保存する（ベストエフォート。失敗してもclaimフローは継続）。
 *        matchScore等はクライアント側で計算せず、RPCがdiagnosis_resultsの生スコア
 *        から独自に再計算する（重要データのため、クライアント入力を信用しない設計）。
 *   5. complete_pending_diagnosis_claim() を呼び、diagnosis_resultsの存在を
 *      RPC側で確認できた場合にのみ claim_status を COMPLETED にする
 *      （＝「claim済みだがdiagnosis_resultsが存在しない」状態は構造的に発生しない。
 *      手順2〜4のどこかで中断しても claim_status は PROCESSING のまま残り、
 *      次回同じユーザーが再度このフローに入れば手順2の冪等フォールバックで再開できる）
 *   6. AI解説の生成は非同期ジョブとして after() でスケジュールする
 *      （レスポンスをブロックしない。失敗してもdiagnosis_results自体は既に保存済み）。
 *      after() 内では cookies() 等のリクエストスコープAPIが使えないため、
 *      呼び出し前に取得したaccess_token（文字列）だけを渡し、コールバック内では
 *      それを使ってcookies()に依存しないクライアント（createTokenClient）を作る。
 *   7. Cookieの削除は「再試行が不要になった終端状態」に達した場合のみ行う。
 *      ・start自体が失敗した場合（無効・期限切れ・他ユーザーが処理中・既にCOMPLETED等）
 *        → このclaim_tokenで再試行しても状況は変わらないため削除する。
 *      ・complete_pending_diagnosis_claim() まで成功した場合 → 完了したので削除する。
 *      ・上記以外（start成功後、回答検証・INSERT・completeのいずれかで失敗した場合）
 *        → claim_tokenを保持したままにする。新規登録の確認直後（印が有効な間）に
 *          このフローに入れば、同じCookieを使ってPROCESSING状態から再試行できる
 *          （Cookieを消してしまうと、再試行に必要な資格情報自体が失われ、
 *          「PROCESSING状態から何度でも再実行できる」設計が機能しなくなるため）。
 */
function dropClaimCookies(store: { delete: (name: string) => unknown }) {
  store.delete(CLAIM_TOKEN_COOKIE);
  store.delete(CLAIM_BINDING_COOKIE);
}

export async function claimPendingDiagnosisForNewAccount(
  user: AuthUserForClaim,
  opts: { binding?: string | null } = {},
): Promise<ClaimResult> {
  const cookieStore = await cookies();
  const claimToken = cookieStore.get(CLAIM_TOKEN_COOKIE)?.value;

  if (!claimToken) {
    return { claimed: false, diagnosisResultId: null };
  }

  // 新規アカウントの初回結果としての引き継ぎ条件を満たさない場合は、何も保存しない。
  // Cookieもここでは消さない（まだ確認が済んでいない新規登録のためのものかもしれず、
  // 別のアカウントのログインで消えると、本当の新規登録の引き継ぎができなくなるため）。
  // トークンのハッシュが一致するアカウントにしか使えないので、残っていても他人には紐づかない。
  const binding = opts.binding ?? cookieStore.get(CLAIM_BINDING_COOKIE)?.value;
  if (!verifySignUpBinding(binding, user, claimToken)) {
    return { claimed: false, diagnosisResultId: null };
  }

  const supabase = await createClient();

  const { data: pending, error: startError } = await supabase.rpc("start_pending_diagnosis_claim", {
    p_claim_token: claimToken,
  });

  if (startError || !pending) {
    // このclaim_tokenでは今後も状況が変わらない（無効・期限切れ・他ユーザーが処理中・
    // 既にCOMPLETED等）。ログイン処理自体は継続してよいので、Cookieを削除して終了する。
    dropClaimCookies(cookieStore);
    return { claimed: false, diagnosisResultId: null };
  }

  if (!isValidAnswers(pending.mode, pending.answers)) {
    console.error("claimPendingDiagnosisIfPresent: invalid answers in pending diagnosis", pending.id);
    // 回答データ自体が壊れている場合は再試行しても回復しないため、ここでは削除する。
    dropClaimCookies(cookieStore);
    return { claimed: false, diagnosisResultId: null };
  }

  const {
    data: { user: sessionUser },
  } = await supabase.auth.getUser();
  if (!sessionUser || sessionUser.id !== user.id) {
    // セッションが取れない一時的な状態、または渡されたユーザーと現在のセッションが一致しない。
    // 別のアカウントへ紐づけないよう、何も保存しない。
    return { claimed: false, diagnosisResultId: null };
  }

  // 新規アカウントの「初回結果」としてだけ取り込む。すでにこのモードの結果がある会員（前回の取り込みの再開は除く）には
  // 追加しない。回数制限（初回＋1回の再診断）を、取り込み経由で消費・迂回させないため。
  const { data: already } = await supabase
    .from("diagnosis_results")
    .select("id, source_pending_id")
    .eq("user_id", sessionUser.id)
    .eq("mode", pending.mode)
    .limit(5);
  if ((already ?? []).some((r: { source_pending_id: string | null }) => r.source_pending_id !== pending.id)) {
    dropClaimCookies(cookieStore);
    return { claimed: false, diagnosisResultId: null };
  }

  const computed = computeDiagnosis(pending.mode, pending.answers);

  let diagnosisResultId: string | null = null;

  const insertResult = // ★0053: diagnosis_results への直接INSERTはクライアント（本人のJWT）には許可しない。
  // 認証済みの本人（上のgetUser）のuser_idと、サーバーが回答から再計算した値だけをservice roleで保存する。
  await createServiceClient()
    .from("diagnosis_results")
    .insert({
      user_id: sessionUser.id,
      diagnosis_version: computed.diagnosisVersion,
      mode: computed.mode,
      answers: pending.answers,
      craft_score: computed.scores.T,
      sense_score: computed.scores.S,
      hospitality_score: computed.scores.H,
      brand_score: computed.scores.B,
      drive_score: computed.scores.A,
      mentor_score: computed.scores.M,
      type_id: computed.typeId,
      type_name: computed.typeName,
      market_value_score: computed.marketValueScore,
      salary_band: computed.salaryBand,
      source_pending_id: pending.id,
      // 「最新の診断」は created_at で決まる。引き継ぎが後から行われても、診断を受けた時刻を使い、
      // 後から受けた別の診断（ログイン中の再診断など）を古い保留結果で巻き戻さない。
      created_at: pending.created_at,
    })
    .select("*")
    .single();

  if (insertResult.error || !insertResult.data) {
    // 再試行（PROCESSINGからの冪等な再開）で source_pending_id が既に使われている場合、
    // 前回の試行で保存自体は成功していた可能性が高いので、既存行を探して復旧する。
    const { data: existing } = await supabase
      .from("diagnosis_results")
      .select("*")
      .eq("source_pending_id", pending.id)
      .maybeSingle();

    if (!existing) {
      logError("claimDiagnosis.insert", insertResult.error);
      // claim_statusはPROCESSINGのまま残す。Cookieも保持し、次回の呼び出しで
      // start_pending_diagnosis_claim()の冪等フォールバックにより再開できるようにする。
      return { claimed: false, diagnosisResultId: null };
    }
    diagnosisResultId = existing.id;
  } else {
    diagnosisResultId = insertResult.data.id;
  }

  // 8タイプ（front-facing称号）の判定・保存。美容師診断のみ対象
  // （8タイプの名称は個人の美容師特性を指すため、サロン診断には適用しない）。
  // ベストエフォート：失敗してもdiagnosis_results自体は保存済みのため、
  // claimフロー全体は継続する。matchScore等の計算はクライアント側では行わず、
  // save_core_type_result() RPCがdiagnosis_resultsの生スコアから独自に
  // 再計算する（lib/diagnosis/core-types.ts のcalculateCoreType()はテスト・
  // 将来のプレビュー用途であり、DBへの書き込みには使わない）。
  if (pending.mode === "stylist") {
    const { error: coreTypeError } = await supabase.rpc("save_core_type_result", {
      p_diagnosis_result_id: diagnosisResultId,
    });
    if (coreTypeError) {
      logError("claimDiagnosis.coreType", coreTypeError);
    }
  }

  // diagnosis_resultsの存在をRPC側が確認できた場合にのみCOMPLETEDへ進む。
  const { error: completeError } = await supabase.rpc("complete_pending_diagnosis_claim", {
    p_pending_id: pending.id,
  });
  if (completeError) {
    logError("claimDiagnosis.complete", completeError);
    // diagnosis_results自体は保存済みなので診断結果としては利用可能。
    // claim_statusはPROCESSINGのまま、Cookieも保持し、次回の呼び出しで
    // complete_pending_diagnosis_claim()を再試行できるようにする
    // （その際はINSERTが一意制約違反となり既存行を再利用する経路を通る）。
    return { claimed: true, diagnosisResultId };
  }

  // ここまで到達＝完全に完了。再試行不要なのでCookieを削除する。
  dropClaimCookies(cookieStore);

  // AI解説の生成は非同期ジョブとして実行し、レスポンスをブロックしない。
  // ★重要: after() のコールバック内では cookies() 等のリクエストスコープ
  // APIが使えない（Next.jsの制約）。そのため、cookies()に依存する createClient()
  // （lib/supabase/server.ts）をコールバック内で呼ぶことはできない。
  // ここでリクエストコンテキストがまだ生きているうちに access_token を文字列として
  // 取得しておき、after() には「純粋な値」だけを渡す。
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token ?? null;

  if (accessToken) {
    after(() => {
      return runAiGenerationJob(diagnosisResultId!, computed, accessToken);
    });
  } else {
    // セッションのアクセストークンが取得できない場合はAI生成をスキップする
    // （ベストエフォート。診断結果自体は既に保存済みのため致命的ではない）。
    console.error("claimPendingDiagnosisIfPresent: no access token available, skipping AI generation");
  }

  return { claimed: true, diagnosisResultId };
}

/**
 * AI解説を生成し、diagnosis_ai_outputsへ保存する非同期ジョブ。
 * after() 経由で呼ばれるため、この関数の失敗はレスポンスに影響しない。
 * ai_status を PENDING→GENERATING→READY/FAILED と遷移させる。
 *
 * ★重要: この関数は after() のコールバックとして実行される時点で
 * リクエストコンテキストが失われているため、cookies()/headers() に依存する
 * createClient()（lib/supabase/server.ts）は絶対に使わない。代わりに、
 * 呼び出し元が事前に取得した accessToken（文字列）だけを使う
 * createTokenClient()（lib/supabase/token-client.ts）を使う。
 *
 * ★export化について: 元々はclaim.ts内の非公開関数だったが、
 * lib/diagnosis-handoff/submit-logged-in.ts（ログイン済み診断専用の
 * 保存経路）からも同じAI解説生成処理を再利用するためexportした。
 * 関数の中身・ロジック・RPC呼び出し順序は一切変更していない。
 *
 * ★診断用ログ: 実行経路が実際にどこまで到達しているかを追跡するため、
 * 失敗は logError で安全に記録する
 * （原因特定後は削除してよい一時的な計測ログ）。
 */
export async function runAiGenerationJob(
  diagnosisResultId: string,
  computed: ComputedDiagnosis,
  accessToken: string,
): Promise<void> {

  const supabase = createTokenClient(accessToken);

  const statusResult = await supabase.rpc("set_diagnosis_ai_status", {
    p_diagnosis_result_id: diagnosisResultId,
    p_status: "GENERATING",
  });
  if (statusResult.error) {
    logError("aiJob.status", statusResult.error);
  } else {
  }

  const result = await generateDiagnosisNarrative({
    typeName: computed.typeName,
    scores: computed.scores,
    marketValueScore: computed.marketValueScore,
    salaryBand: computed.salaryBand,
  });

  if (!result) {
    await supabase.rpc("set_diagnosis_ai_status", {
      p_diagnosis_result_id: diagnosisResultId,
      p_status: "FAILED",
    });
    return;
  }

  const { narrative, model, promptVersion } = result;
  const entries: Array<{
    type: "essence" | "explanation" | "advice" | "growth";
    response: string | string[];
  }> = [
    { type: "essence", response: narrative.essence },
    { type: "explanation", response: narrative.explanation },
    { type: "advice", response: narrative.advice },
    { type: "growth", response: narrative.growth },
  ];

  let allOk = true;
  for (const entry of entries) {
    const { data: created, error: createError } = await supabase.rpc("create_ai_output", {
      p_diagnosis_result_id: diagnosisResultId,
      p_output_type: entry.type,
      p_provider: "anthropic",
      p_model: model,
      p_prompt_version: promptVersion,
      p_response: entry.response,
    });

    if (createError || !created) {
      logError(`aiJob.create.${entry.type}`, createError);
      allOk = false;
      continue;
    }

    const { error: activateError } = await supabase.rpc("activate_ai_output", {
      p_ai_output_id: created.id,
    });
    if (activateError) {
      logError(`aiJob.activate.${entry.type}`, activateError);
      allOk = false;
    } else {
    }
  }

  await supabase.rpc("set_diagnosis_ai_status", {
    p_diagnosis_result_id: diagnosisResultId,
    p_status: allOk ? "READY" : "FAILED",
  });
}

/**
 * 既存アカウントへのログイン時に、このブラウザに残っているゲスト診断の保留Cookieを破棄する。
 * ゲスト診断は保存せず、後日の再ログイン・メール確認・別アカウントへの切り替えで遅れて取り込まれる
 * 余地も残さないための後始末（DBの保留行は期限で自動的に失効する。ここでは何も保存しない）。
 */
export async function discardGuestDiagnosisCookie(): Promise<void> {
  const cookieStore = await cookies();
  dropClaimCookies(cookieStore);
}
