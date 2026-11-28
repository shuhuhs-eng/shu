import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const rows = readFileSync("docs/area-search/prefecture_adjacency_official88.tsv", "utf8").trim().split("\n").slice(1).map((l) => l.split("\t"));
const key = (a: string, b: string) => [a, b].sort().join("-");

test("公式の隣接は88組（重複なし・自己隣接なし・都道府県コード01〜47）", () => {
  assert.equal(rows.length, 88);
  assert.equal(new Set(rows.map((r) => key(r[0], r[1]))).size, 88);
  for (const [a, b] of rows) { assert.notEqual(a, b); for (const c of [a, b]) assert.ok(/^(0[1-9]|[1-3][0-9]|4[0-7])$/.test(c), c); }
});
test("近隣検索から外すのは 岡山–香川 と 広島–愛媛 の2組だけ。理由が必ずある。86組は対象", () => {
  const off = rows.filter((r) => r[2] === "false");
  assert.deepEqual(off.map((r) => key(r[0], r[1])).sort(), ["33-37", "34-38"]);
  for (const r of off) assert.ok((r[3] ?? "").trim().length > 0);
  assert.equal(rows.filter((r) => r[2] === "true").length, 86);
  for (const r of rows.filter((r) => r[2] === "true")) assert.equal((r[3] ?? "").trim(), "");
});
test("除外した2組も公式データとして保持している。山口–福岡は追加しない", () => {
  const keys = new Set(rows.map((r) => key(r[0], r[1])));
  assert.ok(keys.has("33-37") && keys.has("34-38"));
  assert.ok(!keys.has("35-40"));
});
