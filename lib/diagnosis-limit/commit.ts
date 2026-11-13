import { mapLimitError, type LimitError } from "@/lib/diagnosis-limit/messages";
import type { ComputedDiagnosis } from "@/lib/diagnosis";

/**
 * 診断結果の確定保存。0058の commit_diagnosis_result（service_role専用）を呼ぶ。
 * 回数の判定・消費・重複検知（同じrequest_id）・排他（所有者ごとのロック）はすべてDB側で行う。アプリ側の事前確認は案内用にすぎない。
 *
 * ★0058がまだ適用されていないDB（関数が存在しない）では、従来どおりの直接INSERTに戻す。
 *   これにより「アプリ→SQL」「SQL→アプリ」どちらの順で切り替えても壊れず、SQLを巻き戻したときもアプリは動く。
 *   関数が存在するときは、このフォールバックには入らない（回数制限を迂回する経路にならない）。
 *   0059（service_roleのINSERT取り消し）の後は、関数が必ず存在するのでこの経路は使われない。
 */
export type CommitArgs = {
  userId: string;
  requestId: string;
  allowChange: boolean;
  computed: ComputedDiagnosis;
  answers: unknown;
  sourcePendingId?: string | null;
  createdAt?: string | null;
};

export type CommitOk = { ok: true; resultId: string; action: string; replay: boolean; lockedUntil: string | null; legacy: boolean };
export type CommitErr = { ok: false; error: LimitError };

/** 0058の新関数は型定義（自動生成）にまだ無いため、必要な形だけを受け取る。呼び出し側は `as unknown as CommitClient` で渡す。 */
export type CommitClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: Record<string, unknown> | null; error: { message?: string; details?: string; code?: string } | null }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any; // 0058未適用時のフォールバック（直接INSERT）専用
};

/** 関数が存在しない（0058未適用）ときのエラーかどうか。PostgREST: PGRST202 / Postgres: 42883。 */
export function isMissingFunctionError(err: { message?: string; code?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === "PGRST202" || err.code === "42883") return true;
  return /could not find the function|function .* does not exist/i.test(err.message ?? "");
}

export async function commitDiagnosisResult(client: CommitClient, a: CommitArgs): Promise<CommitOk | CommitErr> {
  const c = a.computed;
  const { data, error } = await client.rpc("commit_diagnosis_result", {
    p_user_id: a.userId,
    p_request_id: a.requestId,
    p_allow_change: a.allowChange,
    p_diagnosis_version: c.diagnosisVersion,
    p_mode: c.mode,
    p_answers: a.answers,
    p_craft: c.scores.T,
    p_sense: c.scores.S,
    p_hospitality: c.scores.H,
    p_brand: c.scores.B,
    p_drive: c.scores.A,
    p_mentor: c.scores.M,
    p_type_id: c.typeId,
    p_type_name: c.typeName,
    p_market_value: c.marketValueScore,
    p_salary_band: c.salaryBand,
    p_source_pending_id: a.sourcePendingId ?? null,
    p_created_at: a.createdAt ?? null,
  });

  if (!error && data && typeof data === "object" && data.result_id) {
    return {
      ok: true,
      resultId: String(data.result_id),
      action: String(data.action ?? ""),
      replay: data.replay === true,
      lockedUntil: typeof data.locked_until === "string" ? data.locked_until : null,
      legacy: false,
    };
  }

  if (isMissingFunctionError(error)) {
    const ins = await client
      .from("diagnosis_results")
      .insert({
        user_id: a.userId,
        diagnosis_version: c.diagnosisVersion,
        mode: c.mode,
        answers: a.answers,
        craft_score: c.scores.T,
        sense_score: c.scores.S,
        hospitality_score: c.scores.H,
        brand_score: c.scores.B,
        drive_score: c.scores.A,
        mentor_score: c.scores.M,
        type_id: c.typeId,
        type_name: c.typeName,
        market_value_score: c.marketValueScore,
        salary_band: c.salaryBand,
        ...(a.sourcePendingId ? { source_pending_id: a.sourcePendingId } : {}),
        ...(a.createdAt ? { created_at: a.createdAt } : {}),
      })
      .select("*")
      .single();
    if (ins.error || !ins.data) return { ok: false, error: mapLimitError(ins.error) };
    return { ok: true, resultId: ins.data.id, action: "legacy", replay: false, lockedUntil: null, legacy: true };
  }

  return { ok: false, error: mapLimitError(error) };
}
