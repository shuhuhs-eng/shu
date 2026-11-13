import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Q, computeDiagnosis, scoreTraits } from "../lib/diagnosis";

// HEAD(6e20b71) 時点の配点・メタ・ID・順序のスナップショット。
// 文言だけを変える変更では、これが1つも変わってはいけない。
type Snap = { id: string; sec: string; opts: { w: unknown; m: unknown }[] }[];
const snap: Snap = JSON.parse(
  readFileSync(new URL("./fixtures/stylist-question-weights.json", import.meta.url), "utf8"),
);

test("美容師30問: 質問ID・順序・選択肢数・配点・メタが文言変更前と完全一致", () => {
  assert.equal(Q.length, 30);
  assert.equal(Q.length, snap.length);
  Q.forEach((q, i) => {
    assert.equal(q.id, snap[i].id);
    assert.equal(q.sec, snap[i].sec);
    assert.equal(q.opts.length, 4);
    assert.deepEqual(
      q.opts.map((o) => ({ w: o.w, m: o.m ?? null })),
      snap[i].opts,
      `${q.id} の配点/メタが変わっています`,
    );
  });
});

test("美容師30問: 同じ回答IDなら、旧配点で計算した結果と新しい文言版の結果が同一", () => {
  const oldBank = snap.map((q) => ({
    id: q.id,
    sec: q.sec,
    q: "",
    opts: q.opts.map((o, i) => ({ t: String(i), w: o.w as Record<string, number>, ...(o.m ? { m: o.m as object } : {}) })),
  })) as unknown as typeof Q;
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let n = 0; n < 500; n++) {
    const a = Q.map(() => Math.floor(rnd() * 4));
    assert.deepEqual(scoreTraits(a, Q), scoreTraits(a, oldBank));
    const r = computeDiagnosis("stylist", a);
    assert.deepEqual(r.scores, scoreTraits(a, oldBank).traits);
  }
});

test("美容師30問: 説明が必要な言葉・専門語が質問文と選択肢に残っていない", () => {
  const banned = ["作品性", "ブレーン", "インスピ", "カット理論", "定義", "体系的", "対価", "最大化", "推進力", "唯一無二", "ブランディング", "マネジメント", "世界観"];
  for (const q of Q) {
    const texts = [q.q, ...q.opts.map((o) => o.t)];
    for (const t of texts) for (const b of banned) assert.ok(!t.includes(b), `${q.id}「${t}」に「${b}」`);
  }
});

test("美容師30問: 選択肢の長さが極端に偏らない（最長が最短の4倍以内。ただし最短が6文字未満は除く）", () => {
  for (const q of Q) {
    const lens = q.opts.map((o) => o.t.length);
    const min = Math.max(Math.min(...lens), 6);
    assert.ok(Math.max(...lens) <= min * 4, `${q.id}: ${lens.join(",")}`);
  }
});

test("美容師30問: 質問文が空でなく、選択肢の文言が重複しない", () => {
  for (const q of Q) {
    assert.ok(q.q.length > 0);
    assert.equal(new Set(q.opts.map((o) => o.t)).size, 4, q.id);
  }
});
