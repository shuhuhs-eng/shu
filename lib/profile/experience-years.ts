/**
 * 経験年数の扱い（空欄=未登録(NULL)、明示的な0年=0）。
 * ・空欄・空白・null は NULL（未登録）。0へは変換しない。"0" は 0（0年）。
 * ・整数の 0〜60 だけ。小数・非数・範囲外はエラー。
 * ・既存会員の保存済みの値は変更しない（この関数は入力と表示だけ）。
 */
export const EXPERIENCE_MAX = 60;

export type ExperienceParse = { ok: true; value: number | null } | { ok: false; message: string };

export function parseExperienceYears(raw: unknown): ExperienceParse {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || !Number.isInteger(raw)) return { ok: false, message: "整数で入力してください" };
    return range(raw);
  }
  if (typeof raw !== "string") return { ok: false, message: "半角数字で入力してください" };
  const s = raw.trim();
  if (s === "") return { ok: true, value: null };
  if (!/^-?\d+(\.\d+)?$/.test(s)) return { ok: false, message: "半角数字で入力してください" };
  const n = Number(s);
  if (!Number.isInteger(n)) return { ok: false, message: "整数で入力してください" };
  return range(n);
}
function range(n: number): ExperienceParse {
  if (n < 0) return { ok: false, message: "0以上で入力してください" };
  if (n > EXPERIENCE_MAX) return { ok: false, message: "60以下で入力してください" };
  return { ok: true, value: n };
}

/** 項目の値として出す（「経験年数」の見出しの横）。NULL→「未登録」、0→「0年」。 */
export function formatExperienceValue(years: number | null | undefined): string {
  return typeof years === "number" ? `${years}年` : "未登録";
}
/** 文の中に出す。NULL→「経験年数：未登録」、数値→「経験N年」（0は「経験0年」）。 */
export function formatExperienceInline(years: number | null | undefined): string {
  return typeof years === "number" ? `経験${years}年` : "経験年数：未登録";
}
