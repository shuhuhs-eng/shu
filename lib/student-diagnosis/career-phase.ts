/**
 * 美容師の区分（0071: career_phase 等）。純粋関数とDB対応の判定。
 * ・NULL＝未設定。経験者とは扱わない・推測しない。区分を選ぶのは本人だけ。
 * ・学生区分と免許取得状況は別々の項目（免許の有無で区分を決めない）。
 * ・検証はDB（set_stylist_career_phase と整合制約）が最終判断。ここは画面の案内と、DBへ無駄な送信をしないための事前確認。
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const CAREER_PHASES = ["student", "new_graduate", "experienced"] as const;
export type CareerPhase = (typeof CAREER_PHASES)[number];
export const GRADUATION_KINDS = ["planned", "completed"] as const;
export type GraduationKind = (typeof GRADUATION_KINDS)[number];
export const LICENSE_STATUSES = ["studying", "exam_planned", "passed_waiting", "obtained"] as const;
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];

export const CAREER_PHASE_LABEL: Record<CareerPhase, string> = { student: "美容学生（在学中）", new_graduate: "新卒", experienced: "現役の美容師（経験者）" };
export const GRADUATION_KIND_LABEL: Record<GraduationKind, string> = { planned: "卒業予定", completed: "卒業済み" };
export const LICENSE_STATUS_LABEL: Record<LicenseStatus, string> = {
  studying: "取得に向けて在学中", exam_planned: "受験予定", passed_waiting: "合格・登録待ち", obtained: "取得済み",
};

export type CareerPhaseValue = {
  phase: CareerPhase | null;
  graduationYm: string | null; // YYYY-MM
  graduationKind: GraduationKind | null;
  desiredStartYm: string | null; // YYYY-MM
  licenseStatus: LicenseStatus | null;
};
export const EMPTY_CAREER_PHASE: CareerPhaseValue = { phase: null, graduationYm: null, graduationKind: null, desiredStartYm: null, licenseStatus: null };

const YM = /^(\d{4})-(0[1-9]|1[0-2])$/;
const ymIndex = (s: string) => { const m = YM.exec(s)!; return Number(m[1]) * 12 + Number(m[2]) - 1; };
export const ymToDate = (ym: string | null) => (ym ? `${ym}-01` : null);
export const dateToYm = (d: string | null | undefined) => (typeof d === "string" && /^\d{4}-\d{2}/.test(d) ? d.slice(0, 7) : null);
export function currentYmJst(now: Date = new Date()): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit" }).format(now);
  return p.slice(0, 7);
}

export type CareerPhaseErrors = Partial<Record<"phase" | "graduationYm" | "graduationKind" | "desiredStartYm" | "licenseStatus", string>>;

/** FormData相当の入力を、DB関数と同じ規則で検査して正規化する。空文字は未入力（null）。 */
export function parseCareerPhaseInput(
  raw: { phase?: unknown; graduationYm?: unknown; graduationKind?: unknown; desiredStartYm?: unknown; licenseStatus?: unknown },
  now: Date = new Date(),
): { ok: true; value: CareerPhaseValue } | { ok: false; errors: CareerPhaseErrors } {
  const s = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
  const phase = s(raw.phase), grad = s(raw.graduationYm), kind = s(raw.graduationKind), start = s(raw.desiredStartYm), lic = s(raw.licenseStatus);
  const errors: CareerPhaseErrors = {};
  if (phase !== null && !(CAREER_PHASES as readonly string[]).includes(phase)) errors.phase = "区分を選び直してください。";
  if (lic !== null && !(LICENSE_STATUSES as readonly string[]).includes(lic)) errors.licenseStatus = "免許の取得状況を選び直してください。";
  if (kind !== null && !(GRADUATION_KINDS as readonly string[]).includes(kind)) errors.graduationKind = "卒業の区分を選び直してください。";
  if (Object.keys(errors).length) return { ok: false, errors };

  if (phase === null || phase === "experienced") {
    // 未設定・経験者のときは、卒業・就業開始・免許は空（DBも同じ規則）。画面側で入力欄を出さないが、送られても受け付けない。
    if (grad || kind || start || lic) return { ok: false, errors: { phase: "この区分では、卒業・就業開始・免許の項目は入力できません。" } };
    return { ok: true, value: { ...EMPTY_CAREER_PHASE, phase: phase as CareerPhase | null } };
  }
  if (!grad || !YM.test(grad)) errors.graduationYm = "卒業（予定）の年月を選んでください。";
  if (!kind) errors.graduationKind = "卒業予定か卒業済みかを選んでください。";
  else if (phase === "student" && kind !== "planned") errors.graduationKind = "在学中の区分では、卒業予定を選んでください。";
  if (start && !YM.test(start)) errors.desiredStartYm = "就業開始の希望時期を年月で選んでください。";
  if (Object.keys(errors).length) return { ok: false, errors };

  const cur = ymIndex(currentYmJst(now));
  const g = ymIndex(grad!);
  if (g < cur - 36 || g > cur + 60) errors.graduationYm = "卒業の年月が範囲外です（3年前〜5年後）。";
  if (kind === "completed" && g > cur) errors.graduationKind = "卒業済みは、未来の年月にできません。";
  if (start) {
    const st = ymIndex(start);
    if (st < cur - 12 || st > cur + 72 || st < g) errors.desiredStartYm = "就業開始の希望時期は、卒業の年月以降で、範囲内（1年前〜6年後）で選んでください。";
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: { phase: phase as CareerPhase, graduationYm: grad, graduationKind: kind as GraduationKind, desiredStartYm: start, licenseStatus: lic as LicenseStatus | null },
  };
}

/** 画面（編集・マイページ・自己プレビュー）で同じ文言を出すための共通関数。未設定は null（何も出さない・経験者とは書かない）。 */
export function describeCareerPhase(v: CareerPhaseValue): string[] | null {
  if (!v.phase) return null;
  const lines = [CAREER_PHASE_LABEL[v.phase]];
  if (v.phase === "student" || v.phase === "new_graduate") {
    if (v.graduationYm) lines.push(`${v.graduationYm.replace("-", "年")}月 ${v.graduationKind ? GRADUATION_KIND_LABEL[v.graduationKind] : ""}`.trim());
    if (v.desiredStartYm) lines.push(`就業開始の希望: ${v.desiredStartYm.replace("-", "年")}月`);
    if (v.licenseStatus) lines.push(`免許: ${LICENSE_STATUS_LABEL[v.licenseStatus]}`);
  }
  return lines;
}

export type CareerPhaseRead = { status: "ok"; value: CareerPhaseValue } | { status: "unsupported" } | { status: "error" };

/** 本人の区分を読む。列が無い（0071未適用）なら unsupported。それ以外の失敗は error（未設定とは扱わない）。 */
export async function readOwnCareerPhase(supabase: SupabaseClient, userId: string): Promise<CareerPhaseRead> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("stylist_profiles").select("career_phase, graduation_ym, graduation_kind, desired_start_ym, license_status").eq("user_id", userId).maybeSingle();
  if (error) {
    return error.code === "42703" || error.code === "PGRST204" || /column\b.*(career_phase|graduation_ym).*does not exist/i.test(error.message ?? "")
      ? { status: "unsupported" }
      : { status: "error" };
  }
  if (!data) return { status: "ok", value: EMPTY_CAREER_PHASE };
  const ph = (CAREER_PHASES as readonly string[]).includes(data.career_phase) ? (data.career_phase as CareerPhase) : null;
  return {
    status: "ok",
    value: {
      phase: ph,
      graduationYm: dateToYm(data.graduation_ym),
      graduationKind: (GRADUATION_KINDS as readonly string[]).includes(data.graduation_kind) ? (data.graduation_kind as GraduationKind) : null,
      desiredStartYm: dateToYm(data.desired_start_ym),
      licenseStatus: (LICENSE_STATUSES as readonly string[]).includes(data.license_status) ? (data.license_status as LicenseStatus) : null,
    },
  };
}
