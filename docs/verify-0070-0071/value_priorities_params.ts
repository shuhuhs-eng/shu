// 検証用: DBから取り出した保存済みの行（JSON）から、アプリ（lib/profile/apply-diagnosis-values.ts）が実際に作る保存パラメータを、
// psql で実行できる named-argument の SQL にして出力する。使い方: tsx value_priorities_params.ts <tables.json> <code1,code2,code3>
import { readFileSync } from "node:fs";
import { readStoredProfileForSave, buildSaveParams } from "../../lib/profile/apply-diagnosis-values";

const t = JSON.parse(readFileSync(process.argv[2], "utf8")) as Record<string, Record<string, unknown> | null>;
const codes = process.argv[3].split(",");
const fake = { from: (name: string) => ({ select: (cols: string) => ({ eq: () => ({ maybeSingle: async () => {
  const row = t[name]; if (!row) return { data: null, error: null };
  return { data: cols === "*" ? row : Object.fromEntries(cols.split(",").map((c) => [c.trim(), row[c.trim()] ?? null])), error: null };
} }) }) }) } as never;
const lit = (v: unknown): string => {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return `'{${v.map((x) => `"${x.replace(/(["\\])/g, "\\$1")}"`).join(",")}}'`;
  if (typeof v === "object" || Array.isArray(v)) return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
};
(async () => {
  const r = await readStoredProfileForSave(fake, "u");
  if (r.status !== "ok") { console.error("read:", r.status); process.exit(2); }
  const { fn, params } = buildSaveParams(r.stored, codes);
  console.log(`select public.${fn}(${Object.entries(params).map(([k, v]) => `${k} => ${lit(v)}`).join(", ")});`);
})();
