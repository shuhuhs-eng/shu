/**
 * 「現在の診断」（stylist_diagnosis_current の bank と result_id）を基準に、表示する結果を取得する。
 * ・日時順の先頭では代用しない（同一日時・保存順と日時順が違う場合でも、指定されたIDの結果を取る）。
 * ・日時順で取るのは、(a) 0071未適用の従来表示、(b) 現在が経験者のときに「過去の学生結果」を見せる場合、だけ。
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { CurrentDiagnosisRead } from "@/lib/student-diagnosis/current";

export type DiagnosisResultRow = Database["public"]["Tables"]["diagnosis_results"]["Row"];
export type StudentResultRow = { id: string; answers: unknown; version: string | null; created_at: string };
type One<T> = { row: T | null; error: boolean };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function one<T>(q: any): Promise<One<T>> {
  try {
    const { data, error } = await q.maybeSingle();
    return error ? { row: null, error: true } : { row: (data ?? null) as T | null, error: false };
  } catch {
    return { row: null, error: true };
  }
}

/** マイページの経験者の結果。unsupported=従来（日時順の最新）／現在が経験者=result_id 指定／それ以外=表示せず、履歴の有無だけ確認。 */
export async function fetchExperiencedForMypage(
  supabase: SupabaseClient,
  userId: string,
  read: CurrentDiagnosisRead,
): Promise<{ row: DiagnosisResultRow | null; error: boolean; historyExists: boolean }> {
  if (read.status === "error") return { row: null, error: false, historyExists: false };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const base = () => (supabase as any).from("diagnosis_results").select("*").eq("user_id", userId).eq("mode", "stylist");
  if (read.status === "ok" && read.current?.bank === "experienced") {
    const r = await one<DiagnosisResultRow>(base().eq("id", read.current.resultId).limit(1));
    return { row: r.row, error: r.error, historyExists: !!r.row };
  }
  const r = await one<DiagnosisResultRow>(base().order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1));
  if (read.status === "unsupported") return { row: r.row, error: r.error, historyExists: !!r.row }; // 従来表示（日時順の最新）
  return { row: null, error: r.error, historyExists: !!r.row }; // 現在が学生／行なし: 結果は表示しない（履歴の有無だけ使う）
}

/** 学生の結果を result_id で取得（現在の診断が学生のとき）。 */
export async function fetchStudentById(supabase: SupabaseClient, userId: string, id: string): Promise<One<StudentResultRow>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return one<StudentResultRow>((supabase as any).from("student_diagnosis_results").select("id, answers, version, created_at").eq("user_id", userId).eq("id", id).limit(1));
}
/** 学生の過去結果（現在が経験者のときだけ使う）。日時の新しい順・同日時はID順で先頭1件。 */
export async function fetchLatestStudent(supabase: SupabaseClient, userId: string): Promise<One<StudentResultRow>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return one<StudentResultRow>((supabase as any).from("student_diagnosis_results").select("id, answers, version, created_at").eq("user_id", userId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1));
}

/** 学生結果ページが出す結果。current=現在の結果／past=過去の結果（現在は経験者）／inconsistent=現在の診断の行が無いのに履歴だけある／none=結果なし／error=読み込み失敗／unavailable=0071未適用 */
export type StudentPageLoad =
  | { kind: "current"; row: StudentResultRow }
  | { kind: "past"; row: StudentResultRow }
  | { kind: "inconsistent" }
  | { kind: "none" }
  | { kind: "error" }
  | { kind: "unavailable" };

export async function loadStudentResultForPage(supabase: SupabaseClient, userId: string, read: CurrentDiagnosisRead): Promise<StudentPageLoad> {
  if (read.status === "error") return { kind: "error" };
  if (read.status === "unsupported") return { kind: "unavailable" };
  if (!read.current) {
    const h = await fetchLatestStudent(supabase, userId);
    return h.error ? { kind: "error" } : h.row ? { kind: "inconsistent" } : { kind: "none" };
  }
  if (read.current.bank === "student") {
    const r = await fetchStudentById(supabase, userId, read.current.resultId);
    return r.error ? { kind: "error" } : r.row ? { kind: "current", row: r.row } : { kind: "inconsistent" };
  }
  const r = await fetchLatestStudent(supabase, userId);
  return r.error ? { kind: "error" } : r.row ? { kind: "past", row: r.row } : { kind: "none" };
}
