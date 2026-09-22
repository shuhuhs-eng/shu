import type { TraitKey, TraitScores } from "./traits";
import { TRAITS } from "./traits";
import type { Question } from "./questions";
import { PAIR, fullType } from "./types";
import type { FullType } from "./types";

export type DiagnosisMeta = { exp: number; role: number; spec: number; cul: string[] };
export type ScoreResult = { traits: TraitScores; meta: DiagnosisMeta };
export type MarketValue = { score: number; band: string };

// ルールベース。回答インデックス配列 + 質問バンク → 6才能スコア(0-100)。
export function scoreTraits(answers: number[], bank: Question[]): ScoreResult {
  const earned: TraitScores = { T: 0, S: 0, H: 0, B: 0, A: 0, M: 0 };
  const possible: TraitScores = { T: 0, S: 0, H: 0, B: 0, A: 0, M: 0 };
  const meta: DiagnosisMeta = { exp: 2, role: 1, spec: 1, cul: [] };
  bank.forEach((qq, i) => {
    const maxByTrait: TraitScores = { T: 0, S: 0, H: 0, B: 0, A: 0, M: 0 };
    qq.opts.forEach((o) =>
      Object.entries(o.w).forEach(([k, v]) => {
        const key = k as TraitKey;
        if ((v as number) > maxByTrait[key]) maxByTrait[key] = v as number;
      }),
    );
    (Object.keys(possible) as TraitKey[]).forEach((k) => (possible[k] += maxByTrait[k]));
    const chosen = qq.opts[answers[i]];
    if (!chosen) return;
    Object.entries(chosen.w).forEach(([k, v]) => (earned[k as TraitKey] += v as number));
    if (chosen.m) {
      if (chosen.m.exp) meta.exp = chosen.m.exp;
      if (chosen.m.role != null) meta.role = chosen.m.role;
      if (chosen.m.spec) meta.spec = chosen.m.spec;
      if (chosen.m.cul) meta.cul.push(chosen.m.cul);
    }
  });
  const traits: TraitScores = { T: 0, S: 0, H: 0, B: 0, A: 0, M: 0 };
  (Object.keys(earned) as TraitKey[]).forEach((k) => {
    traits[k] = possible[k] ? Math.round((earned[k] / possible[k]) * 100) : 0;
  });
  return { traits, meta };
}

export function topKeys(traits: TraitScores, n = 2): TraitKey[] {
  return [...TRAITS].sort((a, b) => traits[b.key] - traits[a.key]).slice(0, n).map((t) => t.key);
}

export function decideType(traits: TraitScores): FullType {
  const [a, b] = topKeys(traits, 2);
  const id = PAIR[`${a},${b}`] ?? "cm";
  return fullType(id);
}

export function marketValue(traits: TraitScores, meta: DiagnosisMeta): MarketValue {
  let s = 26;
  s += meta.exp * 9;
  s += meta.role * 4;
  s += meta.spec * 4;
  s += traits.B * 0.14 + traits.T * 0.12 + traits.S * 0.08 + traits.A * 0.08 + traits.H * 0.05 + traits.M * 0.05;
  const score = Math.max(38, Math.min(97, Math.round(s)));
  const band =
    score < 52 ? "¥3.0M–4.0M" : score < 66 ? "¥3.8M–5.2M" :
    score < 76 ? "¥4.8M–6.5M" : score < 86 ? "¥6.0M–8.5M" : "¥7.5M–12M+";
  return { score, band };
}

export function cosine(a: TraitScores, b: TraitScores): number {
  const keys: TraitKey[] = ["T", "S", "H", "B", "A", "M"];
  let dot = 0, na = 0, nb = 0;
  keys.forEach((k) => { dot += a[k] * b[k]; na += a[k] * a[k]; nb += b[k] * b[k]; });
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

export function matchPct(stylist: TraitScores, salon: TraitScores): number {
  return Math.round(Math.min(0.99, cosine(stylist, salon) * 0.98) * 100);
}
