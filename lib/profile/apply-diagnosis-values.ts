/**
 * 診断結果の「大切にしたい働き方」を、本人の操作でプロフィールの「サロン選びで大切にしたいこと」へ反映するための部品。
 * ・自動では保存しない。診断の選択肢コードとプロフィールの項目コードは同じ一覧（VALUE_PRIORITY_OPTIONS）。
 *   一覧に無いコードや、3つに足りない分は推測で補わず、本人に選んでもらう。
 * ・★保存は一時停止中。既存の保存関数（save_stylist_profile / _v2）はプロフィール全項目を受け取るため、別画面の編集と重なると
 *   他の項目を上書きしうる。value_priorities だけを更新する専用の保存関数（0072の草案・未適用）がDBに入るまで、この画面からは保存しない。
 */
import { VALUE_PRIORITY_OPTIONS } from "@/lib/validation/profile-options";

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
