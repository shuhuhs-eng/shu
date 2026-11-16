/**
 * 「いまの立場」（0071 の列 + 0073 の保存関数 save_stylist_profile_v3）。純粋関数とDB対応の判定。
 * ・選択肢は3つだけ: 新卒 / 現役の美容師 / ブランクあり。未選択のまま保存できない（必須）。選ぶのは本人だけ・推測しない・初期選択しない。
 * ・旧データ（未設定 NULL・美容学生 student）は、勝手に変換しない。画面では「未選択」として扱い、本人が次の保存で選び直す。
 * ・免許の取得状況は新卒のときだけ入力できる別の項目（免許の有無で区分を決めない）。
 * ・検証の最終判断はDB（save_stylist_profile_v3・制約・トリガー）。ここは画面の案内と、DBへ無駄な送信をしないための事前確認。
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const CAREER_PHASES = ["new_graduate", "experienced", "blank"] as const;
export type CareerPhase = (typeof CAREER_PHASES)[number];
export const CAREER_PHASE_LABEL: Record<CareerPhase, string> = { new_graduate: "新卒", experienced: "現役の美容師", blank: "ブランクあり" };
export const CAREER_PHASE_REQUIRED_HEADING = "いまの立場（必須）";
export const CAREER_PHASE_REQUIRED_MESSAGE = "いまの立場を選んでください。";
/** 卒業（予定）の月は3月・10月だけ（DBも同じ）。年は西暦の選択（範囲は graduationYearOptions）。 */
export const GRADUATION_MONTHS = [3, 10] as const;
/** ブランク期間の単位と上限（DB: 1以上の整数。ヶ月は120まで、年は10まで＝最長10年）。 */
export const BLANK_PERIOD_UNITS = ["months", "years"] as const;
export type BlankPeriodUnit = (typeof BLANK_PERIOD_UNITS)[number];
export const BLANK_PERIOD_UNIT_LABEL: Record<BlankPeriodUnit, string> = { months: "ヶ月", years: "年" };
export const BLANK_PERIOD_MAX: Record<BlankPeriodUnit, number> = { months: 120, years: 10 };
export type BlankPeriod = { value: number; unit: BlankPeriodUnit };
export const formatBlankPeriod = (p: BlankPeriod) => `${p.value}${BLANK_PERIOD_UNIT_LABEL[p.unit]}`;

export type CareerPhaseValue = {
  /** 3択のどれか。旧データ（未設定・美容学生）は null（未選択として扱う）。 */
  phase: CareerPhase | null;
  /** 旧データの「美容学生」だった（本人が選び直すまで残る。表示では未選択として案内する）。 */
  legacyStudent: boolean;
  /** 卒業（予定）年月 YYYY-MM（新卒のみ）。既存データの3月・10月以外は、そのまま返す（丸めない）。 */
  graduationYm: string | null;
  /** ブランク期間（ブランクありのみ・任意）。未入力は null（0ヶ月とは扱わない）。 */
  blankPeriod: BlankPeriod | null;
};
export const EMPTY_CAREER_PHASE: CareerPhaseValue = { phase: null, legacyStudent: false, graduationYm: null, blankPeriod: null };

const YM = /^(\d{4})-(0[1-9]|1[0-2])$/;
const ymIndex = (s: string) => { const m = YM.exec(s)!; return Number(m[1]) * 12 + Number(m[2]) - 1; };
export const ymToDate = (ym: string | null) => (ym ? `${ym}-01` : null);
export const dateToYm = (d: string | null | undefined) => (typeof d === "string" && /^\d{4}-\d{2}/.test(d) ? d.slice(0, 7) : null);
export function currentYmJst(now: Date = new Date()): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit" }).format(now);
  return p.slice(0, 7);
}

export type CareerPhaseErrors = Partial<Record<"phase" | "graduationYm" | "blankPeriod", string>>;

const monthIndex = (y: number, m: number) => y * 12 + m - 1;
/** 選べる卒業年（西暦）。既存の許容範囲（現在の3年前〜5年後の月）の中に、3月か10月が1つでも入る年。 */
export function graduationYearOptions(now: Date = new Date()): number[] {
  const cur = ymIndex(currentYmJst(now));
  const y0 = Math.floor((cur - 36) / 12), y1 = Math.floor((cur + 60) / 12);
  const out: number[] = [];
  for (let y = y0; y <= y1; y++) if (GRADUATION_MONTHS.some((m) => { const i = monthIndex(y, m); return i >= cur - 36 && i <= cur + 60; })) out.push(y);
  return out;
}
/** 卒業年月（YYYY-MM）が、3月・10月で、許容範囲内か。 */
export function isAllowedGraduationYm(ym: string | null | undefined, now: Date = new Date()): boolean {
  if (!ym || !YM.test(ym)) return false;
  const m = Number(ym.slice(5, 7));
  if (!(GRADUATION_MONTHS as readonly number[]).includes(m)) return false;
  const cur = ymIndex(currentYmJst(now)), g = ymIndex(ym);
  return g >= cur - 36 && g <= cur + 60;
}

/**
 * FormData相当の入力を、DB関数（save_stylist_profile_v4）と同じ規則で検査して正規化する。空文字は未入力（null）。
 * ・立場は必須: 未選択・旧値（student）・不明な値は保存しない。
 * ・新卒: 卒業の年と月（3月/10月）が必須。ブランク期間は受け付けない。
 * ・ブランクあり: ブランク期間は任意。数値は正の整数（空欄=未入力は可。0・負数・小数・不正値は不可。ヶ月は120まで・年は10まで）。数値を入れたら単位が必須。
 *     数値が空のときは単位は無視する（未入力。0ヶ月とは扱わない）。
 * ・現役: 卒業年月・ブランク期間は受け付けない。
 * 卒業の区分・就業開始・免許は受け付けない（項目自体を廃止。補完もしない）。
 */
export function parseCareerPhaseInput(
  raw: { phase?: unknown; graduationYear?: unknown; graduationMonth?: unknown; blankPeriodValue?: unknown; blankPeriodUnit?: unknown },
  now: Date = new Date(),
): { ok: true; value: CareerPhaseValue & { phase: CareerPhase } } | { ok: false; errors: CareerPhaseErrors } {
  const s = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
  const phase = s(raw.phase), gy = s(raw.graduationYear), gm = s(raw.graduationMonth), bv = s(raw.blankPeriodValue), bu = s(raw.blankPeriodUnit);
  if (phase === null) return { ok: false, errors: { phase: CAREER_PHASE_REQUIRED_MESSAGE } };
  if (!(CAREER_PHASES as readonly string[]).includes(phase)) return { ok: false, errors: { phase: "いまの立場を、3つの選択肢から選び直してください。" } };

  if (phase === "experienced") {
    if (gy || gm || bv) return { ok: false, errors: { phase: "この立場では、卒業年月・ブランク期間は入力できません。" } };
    return { ok: true, value: { ...EMPTY_CAREER_PHASE, phase: "experienced" } };
  }
  if (phase === "blank") {
    if (gy || gm) return { ok: false, errors: { phase: "この立場では、卒業年月は入力できません。" } };
    if (bv === null) return { ok: true, value: { ...EMPTY_CAREER_PHASE, phase: "blank" } };
    if (!/^[1-9]\d*$/.test(bv)) return { ok: false, errors: { blankPeriod: "ブランク期間は、1以上の整数で入力してください。" } };
    if (!bu || !(BLANK_PERIOD_UNITS as readonly string[]).includes(bu)) return { ok: false, errors: { blankPeriod: "ブランク期間の単位（ヶ月・年）を選んでください。" } };
    const n = Number(bv), unit = bu as BlankPeriodUnit;
    if (n > BLANK_PERIOD_MAX[unit]) return { ok: false, errors: { blankPeriod: `ブランク期間は、${BLANK_PERIOD_MAX[unit]}${BLANK_PERIOD_UNIT_LABEL[unit]}以下で入力してください。` } };
    return { ok: true, value: { ...EMPTY_CAREER_PHASE, phase: "blank", blankPeriod: { value: n, unit } } };
  }
  // 新卒
  if (bv) return { ok: false, errors: { phase: "この立場では、ブランク期間は入力できません。" } };
  if (!gy || !gm) return { ok: false, errors: { graduationYm: "卒業（予定）の年と月を選んでください。" } };
  if (!/^\d{4}$/.test(gy) || !/^\d{1,2}$/.test(gm)) return { ok: false, errors: { graduationYm: "卒業（予定）の年と月を選び直してください。" } };
  if (!(GRADUATION_MONTHS as readonly number[]).includes(Number(gm))) return { ok: false, errors: { graduationYm: "卒業（予定）の月は、3月か10月から選んでください。" } };
  const ym = `${gy}-${String(Number(gm)).padStart(2, "0")}`;
  if (!isAllowedGraduationYm(ym, now)) return { ok: false, errors: { graduationYm: "卒業（予定）の年が範囲外です（3年前〜5年後の間で選んでください）。" } };
  return { ok: true, value: { phase: "new_graduate", legacyStudent: false, graduationYm: ym, blankPeriod: null } };
}

/**
 * 新卒向け診断を「受ける・始める・受け直す」入口を出してよいか。立場が「新卒」のときだけ（現役・ブランクあり・未選択（旧データ含む）・読み込み失敗は出さない）。
 * 保存済みの結果を「見る」リンクは、この判定とは無関係に残す。診断の計算・回数制限は変えない。
 */
export function canStartStudentDiagnosis(read: CareerPhaseRead | null | undefined): boolean {
  return read?.status === "ok" && read.value.phase === "new_graduate";
}

/** 画面（編集・マイページ・自己プレビュー）で同じ文言を出すための共通関数。未選択（旧データ含む）は null（何も出さない・経験者とは書かない）。 */
export const CAREER_PHASE_UNSET_TEXT = "未選択";
export const CAREER_PHASE_RESELECT_NOTE = "いまの立場が未選択です。プロフィールを保存するときに、新卒・現役の美容師・ブランクありから選んでください。";
export function describeCareerPhase(v: CareerPhaseValue): string[] | null {
  if (!v.phase) return null;
  const lines = [CAREER_PHASE_LABEL[v.phase]];
  if (v.phase === "new_graduate" && v.graduationYm) lines.push(`卒業（予定）: ${v.graduationYm.slice(0, 4)}年${Number(v.graduationYm.slice(5, 7))}月`);
  if (v.phase === "blank" && v.blankPeriod) lines.push(`ブランク期間: ${formatBlankPeriod(v.blankPeriod)}`);
  return lines;
}

export type CareerPhaseRead = { status: "ok"; value: CareerPhaseValue } | { status: "unsupported" } | { status: "error" };

/** 本人の区分を読む。列が無い（0071未適用）なら unsupported。それ以外の失敗は error（未設定とは扱わない）。 */
export async function readOwnCareerPhase(supabase: SupabaseClient, userId: string): Promise<CareerPhaseRead> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("stylist_profiles").select("career_phase, graduation_ym, blank_period_value, blank_period_unit").eq("user_id", userId).maybeSingle();
  if (error) {
    // 立場の列そのものが無い（0071未適用）ときだけ「未対応」。ブランク期間の列が無い（0076未適用）などは、旧い保存経路へ切り替えないようエラーにする。
    return /career_phase/i.test(error.message ?? "") && (error.code === "42703" || error.code === "PGRST204" || /does not exist/i.test(error.message ?? ""))
      ? { status: "unsupported" }
      : { status: "error" };
  }
  if (!data) return { status: "ok", value: EMPTY_CAREER_PHASE };
  // 旧データ（未設定・美容学生）は変換しない。3択に当てはまらないものは「未選択」として返し、本人が選び直す。
  const ph = (CAREER_PHASES as readonly string[]).includes(data.career_phase) ? (data.career_phase as CareerPhase) : null;
  return {
    status: "ok",
    value: {
      phase: ph,
      legacyStudent: data.career_phase === "student",
      graduationYm: dateToYm(data.graduation_ym),
      // 数値と単位がそろって正しいときだけ（片方だけ・範囲外は未入力として扱い、補わない）
      blankPeriod: (BLANK_PERIOD_UNITS as readonly string[]).includes(data.blank_period_unit) && Number.isInteger(data.blank_period_value) && data.blank_period_value >= 1
        ? { value: data.blank_period_value as number, unit: data.blank_period_unit as BlankPeriodUnit } : null,
    },
  };
}
