/**
 * 「現在の診断」（0071: stylist_diagnosis_current）と、画面に何を出すかの判定。
 * ・現在の診断が学生・新卒なら、過去の経験者診断（才能グラフ・経験分析・AI解説）を現在の結果として出さない。
 * ・0071が未適用（表が無い）なら従来の表示（経験者）のまま。
 * ・読み込みに失敗したときは、どちらの結果も「現在の結果」として出さない（古い結果を現在と誤認させない）。
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type DiagnosisBank = "experienced" | "student";
export type CurrentDiagnosis = { bank: DiagnosisBank; resultId: string; seq: number };
export type CurrentDiagnosisRead =
  | { status: "ok"; current: CurrentDiagnosis | null }
  | { status: "unsupported" }
  | { status: "error" };

/** 本人の「現在の診断」を読む（本人のRLS）。表が無い（0071未適用）なら unsupported。それ以外の失敗は error。 */
export async function readCurrentDiagnosis(supabase: SupabaseClient, userId: string): Promise<CurrentDiagnosisRead> {
  let res: { data: { bank?: unknown; result_id?: unknown; seq?: unknown } | null; error: { code?: string; message?: string } | null };
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    res = await (supabase as any).from("stylist_diagnosis_current").select("bank, result_id, seq").eq("user_id", userId).maybeSingle();
  } catch {
    return { status: "error" }; // 通信の例外など。0071未適用とは確認できないので error（従来表示にしない）
  }
  const { data, error } = res;
  if (error) {
    // 「表が無い」と確認できるときだけ unsupported。権限（42501）・JWT・通信などは error。
    const msg = error.message ?? "";
    const tableMissing = (error.code === "42P01" || error.code === "PGRST205") && /stylist_diagnosis_current/i.test(msg)
      || (/stylist_diagnosis_current/i.test(msg) && /does not exist|could not find/i.test(msg));
    return tableMissing ? { status: "unsupported" } : { status: "error" };
  }
  if (!data) return { status: "ok", current: null };
  if ((data.bank !== "experienced" && data.bank !== "student") || typeof data.result_id !== "string") return { status: "error" };
  return { status: "ok", current: { bank: data.bank, resultId: data.result_id, seq: Number(data.seq) } };
}

/** マイページの診断表示。experienced=従来の表示／student=学生・新卒の結果／unknown=現在の診断を読み込めない／inconsistent=現在の診断の行が無いのに履歴だけある（または指す結果が無い）。 */
export type DiagnosisView = "experienced" | "student" | "unknown" | "inconsistent";

/** 現在の診断の読み取り結果だけで決まる大枠（学生用の結果を取りに行くかの判断に使う）。最終的な表示は decideMypageView。 */
export function decideDiagnosisView(read: CurrentDiagnosisRead): DiagnosisView {
  if (read.status === "unsupported") return "experienced";
  if (read.status === "error") return "unknown";
  return read.current?.bank === "student" ? "student" : "experienced";
}

export type MypageContext = {
  /** 経験者の結果の取得（現在の診断が経験者のときは result_id 指定の取得）で得た行のID。無ければ null */
  experiencedRowId: string | null;
  experiencedFetchError: boolean;
  /** 経験者・学生のどちらかの診断履歴が1件でもあるか */
  anyHistory: boolean;
};

/**
 * マイページの最終的な表示。基準は現在の診断（bank と result_id）。日時順の先頭では代用しない。
 * ・0071未適用（unsupported）だけが従来表示（日時順の最新）。
 * ・読み取り失敗は unknown（どの結果も出さない）。
 * ・現在の診断の行が無く、履歴だけがある場合は inconsistent（古い結果を現在として出さない）。履歴も無ければ従来の「診断を受ける」表示。
 * ・現在が経験者なら、result_id で取得できた結果だけを表示。取得できなければ（行なしは inconsistent、失敗は unknown）。
 */
export function decideMypageView(read: CurrentDiagnosisRead, ctx: MypageContext): DiagnosisView {
  if (read.status === "unsupported") return "experienced";
  if (read.status === "error") return "unknown";
  if (!read.current) return ctx.anyHistory ? "inconsistent" : "experienced";
  if (read.current.bank === "student") return "student";
  if (ctx.experiencedFetchError) return "unknown";
  return ctx.experiencedRowId === read.current.resultId ? "experienced" : "inconsistent";
}

/** 画面の部品の出し分け（マイページ）。「いまの立場」は診断の種類に左右されず常に出す。 */
export function mypageSections(view: DiagnosisView) {
  return { showExperienced: view === "experienced", showStudent: view === "student", showUnknownNotice: view === "unknown", showInconsistentNotice: view === "inconsistent" };
}
