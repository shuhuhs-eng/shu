import { z } from "zod";

/**
 * 外部から届く配列の「長さ」を、要素を検証する前に確認する。
 *
 * 背景: zod 3.25 系の `z.array(...).max(n)` は、全要素の検証を終えたあとに長さを判定する。
 * 要素がすべて不正な巨大配列を渡されると、要素ごとの不正報告が溜まり、メモリと時間を使い果たせる
 * （GHSA-mrhx-c7xc-m3w5。上限なしの配列は zod 4.6.7 でも対策されていない）。
 * ここでは、長さが上限を超えたら要素に触れず1件の不正として即座に打ち切り、上限内のときだけ
 * 従来の検証（min / max / length / refine など）をそのまま適用する。上限内の入力の結果は従来と同じ。
 *
 * 使い方: capArrayInput(上限, z.array(要素).min(1)...)  — 上限は「正規の画面が送りうる最大件数」。
 */
export function capArrayInput<S extends z.ZodTypeAny>(max: number, schema: S, message = "選択数が上限を超えています") {
  return z.custom<unknown>((v) => Array.isArray(v) && v.length <= max, { message }).pipe(schema);
}
