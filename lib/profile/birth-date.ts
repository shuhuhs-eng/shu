import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/** 生年月日の登録範囲（DB関数 set_stylist_birth_date と同じ: 満15歳以上100歳以下・未来日不可）。 */
export const BIRTH_MIN_AGE = 15;
export const BIRTH_MAX_AGE = 100;

/** 日本時間の今日（YYYY-MM-DD）。 */
export function todayJst(now: Date = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

function parseYmd(s: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null; // 2/30など実在しない日付
  return { y, m: mo, d };
}

/** 満年齢。生年月日が不正・未来ならnull（年代などからの推測はしない）。 */
export function ageOn(birth: string | null | undefined, today: string): number | null {
  if (!birth) return null;
  const b = parseYmd(birth);
  const t = parseYmd(today);
  if (!b || !t) return null;
  let age = t.y - b.y;
  if (t.m < b.m || (t.m === b.m && t.d < b.d)) age -= 1;
  return age < 0 ? null : age;
}

/** 入力検証。問題が無ければnull、あれば画面に出す文言。 */
export function validateBirthDate(s: string, today: string = todayJst()): string | null {
  if (!parseYmd(s)) return "生年月日を正しい日付で入力してください";
  const age = ageOn(s, today);
  if (age == null || s > today) return "未来の日付は入力できません";
  if (age < BIRTH_MIN_AGE || age > BIRTH_MAX_AGE) return `${BIRTH_MIN_AGE}歳以上${BIRTH_MAX_AGE}歳以下の範囲で入力してください`;
  return null;
}

export type BirthDateRead =
  | { status: "ok"; birthDate: string | null }
  /** 生年月日の列が存在しない（0070が未適用）。従来の表示に切り替えてよい唯一の場合。 */
  | { status: "unsupported" }
  /** 権限・通信・その他のエラー。未対応とは扱わない（画面側でエラーとして伝える）。 */
  | { status: "error" };

/** 「列が存在しない」エラーだけを機能未対応とみなす（PostgreSQL 42703 / PostgREST PGRST204）。 */
export function isMissingBirthDateColumn(error: { code?: string | null; message?: string | null }): boolean {
  if (error.code === "42703" || error.code === "PGRST204") return true;
  return /column\b.*birth_date.*does not exist/i.test(error.message ?? "");
}

/**
 * 本人の生年月日を読む。0070（生年月日列）が未適用のDBでは列が無いため unsupported を返す。
 * 権限エラー・通信エラー・保存エラーなど、列が無いこと以外の失敗は error として返し、未対応扱いにしない。
 */
export async function readOwnBirthDate(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<BirthDateRead> {
  const { data, error } = await supabase.from("stylist_private").select("birth_date").eq("user_id", userId).maybeSingle();
  if (error) return isMissingBirthDateColumn(error) ? { status: "unsupported" } : { status: "error" };
  return { status: "ok", birthDate: data?.birth_date ?? null };
}

export type AgeDisplayMode = "exact" | "decade";
export const AGE_DISPLAY_MODES: ReadonlyArray<{ value: AgeDisplayMode; label: string; example: string }> = [
  { value: "exact", label: "実年齢で表示", example: "例: 45歳" },
  { value: "decade", label: "年代で表示", example: "例: 40代" },
];

export function isAgeDisplayMode(v: unknown): v is AgeDisplayMode {
  return v === "exact" || v === "decade";
}

/** 満年齢から年代（10の位）。 */
export function decadeOf(age: number): number {
  return Math.floor(age / 10) * 10;
}

/** サロン向けの年齢表記。実年齢が許可されていれば「45歳」、年代だけなら「40代」、どちらも無ければnull（推測しない）。 */
export function formatAgeLabel(info: { age?: number | null; age_decade?: number | null }): string | null {
  if (typeof info.age === "number") return `${info.age}歳`;
  if (typeof info.age_decade === "number") return `${info.age_decade}代`;
  return null;
}

export type AgeDisplayModeRead =
  | { status: "ok"; mode: AgeDisplayMode | null }
  | { status: "unsupported" }
  | { status: "error" };

/** 本人の表示方法を読む。列が無い（0070未適用）なら unsupported。それ以外の失敗は error。 */
export async function readOwnAgeDisplayMode(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<AgeDisplayModeRead> {
  const { data, error } = await supabase.from("stylist_private").select("age_display_mode").eq("user_id", userId).maybeSingle();
  if (error) {
    return error.code === "42703" || error.code === "PGRST204" || /column\b.*age_display_mode.*does not exist/i.test(error.message ?? "")
      ? { status: "unsupported" }
      : { status: "error" };
  }
  const m = data?.age_display_mode ?? null;
  return { status: "ok", mode: isAgeDisplayMode(m) ? m : null };
}
