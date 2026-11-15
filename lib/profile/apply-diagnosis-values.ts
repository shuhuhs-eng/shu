/**
 * 診断結果の「大切にしたい働き方」を、本人の操作でプロフィールの「サロン選びで大切にしたいこと」へ反映するための部品。
 * ・自動では保存しない。診断の選択肢コードとプロフィールの項目コードは同じ一覧（VALUE_PRIORITY_OPTIONS）。
 *   一覧に無いコードや、3つに足りない分は推測で補わず、本人に選んでもらう。
 * ・保存は既存の保存経路（save_stylist_profile / _v2）を使う。権限は増やさない。
 *   他の保存済み項目は、読み取った値をそのまま渡して変えない（value_priorities だけを差し替える）。
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { VALUE_PRIORITY_OPTIONS } from "@/lib/validation/profile-options";
import { readOwnAgeDisplayMode, readOwnBirthDate } from "@/lib/profile/birth-date";

export const VALUE_PRIORITY_COUNT = 3;
const CODES: ReadonlySet<string> = new Set(VALUE_PRIORITY_OPTIONS.map((o) => o.code));
export const valueLabel = (code: string) => VALUE_PRIORITY_OPTIONS.find((o) => o.code === code)?.label ?? code;

/** 診断の選択（選んだ順）から、プロフィールへの変更案を作る。一覧に無いコード・重複は除く（変換しない）。 */
export function proposeValuePriorities(diagnosisValues: readonly string[]): { proposed: string[]; missing: number; dropped: number } {
  const proposed: string[] = [];
  for (const c of diagnosisValues) if (CODES.has(c) && !proposed.includes(c)) proposed.push(c);
  const top = proposed.slice(0, VALUE_PRIORITY_COUNT);
  return { proposed: top, missing: VALUE_PRIORITY_COUNT - top.length, dropped: diagnosisValues.length - top.length };
}

/** プロフィールの既存ルール（ちょうど3つ・一覧にあるもの・重複禁止）で検証する。 */
export function validateValuePriorities(raw: readonly unknown[]): { ok: true; values: string[] } | { ok: false; message: string } {
  const values = raw.filter((v): v is string => typeof v === "string");
  if (values.length !== raw.length || values.some((v) => !CODES.has(v))) return { ok: false, message: "選べない項目が含まれています。選び直してください。" };
  if (new Set(values).size !== values.length) return { ok: false, message: "同じ項目を重複して選択できません。" };
  if (values.length !== VALUE_PRIORITY_COUNT) return { ok: false, message: "重要な項目を3つ選択してください。" };
  return { ok: true, values };
}

export type StoredProfile = {
  pub: {
    public_name: string; prefecture: string; desired_work_location: string | null; experience_years: number | null; current_position: string | null;
    specialties: string[]; employment_type: string | null; job_change_intent: string; desired_salary_range: string | null; sns_links: unknown;
    bio: string | null; visibility: string; value_priorities: string[] | null;
  };
  priv: { full_name: string | null; age_band: string | null; gender: string | null };
  avatarPath: string | null;
  scoutEnabled: boolean;
  age: { kind: "v2"; birthDate: string; mode: string } | { kind: "v1" };
};

/** 保存済みのプロフィールを読む。読めない・未完成のときは保存へ進まない。 */
export async function readStoredProfileForSave(
  supabase: SupabaseClient, userId: string,
): Promise<{ status: "ok"; stored: StoredProfile } | { status: "no_profile" } | { status: "incomplete"; message: string } | { status: "error" }> {
  const [pubR, privR, profR, setR, birth, mode] = await Promise.all([
    supabase.from("stylist_profiles").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("stylist_private").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("profiles").select("avatar_path").eq("id", userId).maybeSingle(),
    supabase.from("user_settings").select("scout_enabled").eq("user_id", userId).maybeSingle(),
    readOwnBirthDate(supabase, userId),
    readOwnAgeDisplayMode(supabase, userId),
  ]);
  if (pubR.error || privR.error || profR.error || setR.error || birth.status === "error" || mode.status === "error") return { status: "error" };
  if (!pubR.data || !privR.data) return { status: "no_profile" };
  let age: StoredProfile["age"] = { kind: "v1" };
  if (birth.status === "ok" && mode.status === "ok") {
    if (!birth.birthDate || !mode.mode) return { status: "incomplete", message: "生年月日と年齢の表示方法を登録してから、反映してください（プロフィール編集）。" };
    age = { kind: "v2", birthDate: birth.birthDate, mode: mode.mode };
  }
  const p = pubR.data as Record<string, unknown>;
  return {
    status: "ok",
    stored: {
      pub: {
        public_name: p.public_name as string, prefecture: p.prefecture as string, desired_work_location: (p.desired_work_location as string | null) ?? null,
        experience_years: (p.experience_years as number | null) ?? null, current_position: (p.current_position as string | null) ?? null,
        specialties: (p.specialties as string[]) ?? [], employment_type: (p.employment_type as string | null) ?? null, job_change_intent: p.job_change_intent as string,
        desired_salary_range: (p.desired_salary_range as string | null) ?? null, sns_links: p.sns_links ?? [], bio: (p.bio as string | null) ?? null,
        visibility: p.visibility as string, value_priorities: (p.value_priorities as string[] | null) ?? null,
      },
      priv: { full_name: privR.data.full_name ?? null, age_band: privR.data.age_band ?? null, gender: privR.data.gender ?? null },
      avatarPath: profR.data?.avatar_path ?? null,
      scoutEnabled: setR.data?.scout_enabled ?? true,
      age,
    },
  };
}

/** 保存のパラメータ。value_priorities 以外は、保存済みの値をそのまま渡す（変更しない）。公開範囲も保存済みの値のまま（一部公開を非公開に変えない）。 */
export function buildSaveParams(s: StoredProfile, valuePriorities: string[]) {
  const common = {
    p_public_name: s.pub.public_name, p_full_name: s.priv.full_name, p_age_band: s.priv.age_band, p_gender: s.priv.gender,
    p_prefecture: s.pub.prefecture, p_desired_work_location: s.pub.desired_work_location, p_experience_years: s.pub.experience_years,
    p_current_position: s.pub.current_position, p_specialties: s.pub.specialties, p_employment_type: s.pub.employment_type,
    p_job_change_intent: s.pub.job_change_intent, p_desired_salary_range: s.pub.desired_salary_range, p_sns_links: s.pub.sns_links,
    p_bio: s.pub.bio, p_visibility: s.pub.visibility, p_scout_enabled: s.scoutEnabled, p_avatar_path: s.avatarPath, p_value_priorities: valuePriorities,
  };
  return s.age.kind === "v2"
    ? { fn: "save_stylist_profile_v2" as const, params: { ...common, p_birth_date: s.age.birthDate, p_age_display_mode: s.age.mode } }
    : { fn: "save_stylist_profile" as const, params: common };
}
