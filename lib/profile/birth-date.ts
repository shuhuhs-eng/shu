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

/**
 * 本人の生年月日を読む。0070（生年月日列）が未適用のDBでは列が無くエラーになるため、
 * その場合は supported:false を返す（入力欄を出さない・年齢を出さない。既存画面は壊さない）。
 */
export async function readOwnBirthDate(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<{ supported: boolean; birthDate: string | null }> {
  const { data, error } = await supabase.from("stylist_private").select("birth_date").eq("user_id", userId).maybeSingle();
  if (error) return { supported: false, birthDate: null };
  return { supported: true, birthDate: data?.birth_date ?? null };
}
