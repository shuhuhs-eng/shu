/* eslint-disable @typescript-eslint/no-explicit-any */
// 経験者版の判定が、丸め・同点の修正で変わる範囲を、変更前後で数え、具体例と理由を出す。使い方: npx tsx docs/core-type-tiebreak-db/impact_report.mts <dir> [出力md]
import { readFileSync, writeFileSync } from "node:fs";
import { CORE_TYPE_CODES, CORE_TYPE_WEIGHTS } from "../../lib/diagnosis/core-types.ts";
import { Q } from "../../lib/diagnosis/questions.ts";
const dir = process.argv[2], outPath = process.argv[3] ?? "docs/core-type-tiebreak-db/impact_experienced.md";
const meta = JSON.parse(readFileSync(`${dir}/meta.json`, "utf8")); const K = ["T", "S", "H", "B", "A", "M"] as const;
const rd = (p: string) => new Map(readFileSync(p, "utf8").trim().split("\n").map((l) => { const [i, t, s, g, ms] = l.split("|"); return [Number(i), { top: t, second: s, gap: Number(g), scores: JSON.parse(ms) as Record<string, number> }] as const; }));
const dbOld = rd(`${dir}/results_old.csv`), dbNew = rd(`${dir}/results_new.csv`);
let nA = 0, cA = 0, nB = 0, cB = 0, nBs = 0, nC = 0, nD = 0, nAtopOnly = 0; void cA; void cB;
const exA: any[] = [], exB: any[] = [], exB2: any[] = [];
const hund = (s: Record<string, number>, code: (typeof CORE_TYPE_CODES)[number]) => K.reduce((x, k) => x + Math.round(CORE_TYPE_WEIGHTS[code][k] * 100) * s[k], 0);
for (const [iS, m] of Object.entries<any>(meta.cases)) {
  const i = Number(iS), o = dbOld.get(i)!, n = dbNew.get(i)!;
  const dbChange = o.top !== n.top || o.second !== n.second;               // A: 今後の保存結果（DB）が変わる
  const tsChange = m.tsOld.top !== m.tsNew.top || m.tsOld.second !== m.tsNew.second; // B: 画面のプレビュー（TS）が変わる
  const tsScoreChange = CORE_TYPE_CODES.some((c) => m.tsOld.scores[c] !== m.tsNew.scores[c]);
  if (dbChange) { nA += m.n; cA++; if (o.top === n.top) nAtopOnly += m.n; if (exA.length < 4) exA.push({ i, m, o, n }); }
  if (tsChange) { nB += m.n; cB++; if (exB.length < 4) exB.push({ i, m, o, n }); }
  if (tsScoreChange) nBs += m.n;
  if (m.tsOld.top !== o.top || m.tsOld.second !== o.second) nC += m.n;      // C: 修正前の画面プレビュー ≠ 修正前の保存結果
  if (m.tsNew.top !== n.top || m.tsNew.second !== n.second) nD += m.n;      // D: 修正後の画面プレビュー ≠ 修正後の保存結果（0であるべき）
}
const N = meta.N, pct = (x: number) => ((x / N) * 100).toFixed(2) + "%";
const nm = (c: string) => c;
const L: string[] = [];
L.push("# 経験者版：丸め・同点の修正で、今後の判定が変わるケース（変更前後）", "");
L.push("経験者版の質問・配点・6軸の計算は変えていない。変わるのは、6軸の点数から8タイプの1位・2位を決める最後の段階の2点だけ。**保存済みの履歴・初回確定タイプは変更しない**（0078は関数だけを差し替え、既存の行は書き換えない。検証済み）。", "");
L.push("## 調べ方", `- 実際の経験者の質問 Q（30問）に、各問を一様に選ぶ回答を ${N.toLocaleString()} 通り作り（固定シード）、6軸の点数にした（重複を除くと ${meta.distinct.toLocaleString()} 通り）。`, "- 変更前のアプリ（コミット 56f9814 の calculateCoreType の写し）、変更後のアプリ、変更前のDB関数（0004）、変更後のDB関数（0078）を、同じ6軸の点数で比べた。DBはローカルの使い捨てDBで、本番へは接続していない。", "- 回答は一様乱数であり、実際の利用者の分布ではない。割合は「起こりやすさの目安」で、実データの割合ではない。", "");
L.push("## 結果の要約", "| 区分 | 回答数(割合) | 内容 |", "|---|---|---|");
L.push(`| A. 今後の保存結果（DB）の1位または2位が変わる | ${nA.toLocaleString()} (${pct(nA)}) | 8タイプの得点が同点のとき。変更前は同点の並びがDBの内部順で決まり、画面（定義順）と違うことがあった。変更後は定義順に統一。うち1位が変わるもの ${(nA - nAtopOnly).toLocaleString()} (${pct(nA - nAtopOnly)})、2位だけが変わるもの ${nAtopOnly.toLocaleString()} (${pct(nAtopOnly)}) |`);
L.push(`| B. 画面のプレビュー（アプリ）の1位または2位が変わる | ${nB.toLocaleString()} (${pct(nB)}) | 得点が小数第1位の丸め境界（x.x5）にあるとき。変更前は浮動小数点の誤差で、数学的な四捨五入と1つずれることがあった |`);
L.push(`| 　（参考）プレビューの8タイプ得点のどれかが0.1ずれる | ${nBs.toLocaleString()} (${pct(nBs)}) | 1位・2位が変わらなくても、画面内部の得点が0.1違うことがあった。画面は1位のタイプ名しか出さないため、見た目に出るのは B のみ |`);
L.push(`| C. 変更前：画面のプレビュー ≠ 保存結果（1位または2位） | ${nC.toLocaleString()} (${pct(nC)}) | 変更前から存在した、プレビューと保存結果の食い違い（A と B の合算に近い） |`);
L.push(`| D. 変更後：画面のプレビュー ≠ 保存結果（1位または2位） | ${nD.toLocaleString()} (${pct(nD)}) | **0 であること**（保存結果と画面が常に一致する） |`, "");
const fmt = (c: string, v: number) => `${c}=${v}`;
L.push("## 具体例A：同点で、保存される1位・2位が変わる", "同点の並びは、変更前のDBでは内部の順（jsonbのキー順）、変更後は定義順（shimei_jishaku, aisare_ace, niaiwase_master, trend_maker, iyashi_charisma, repeat_king, mirai_no_ace, brand_builder）。");
for (const e of exA) {
  const q = e.m.answers.map((a: number, k: number) => `${Q[k].id}:${a}`).join(" ");
  const top = Object.entries<number>(e.n.scores).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([c, v]) => `${c} ${v}`).join(" / ");
  L.push(`\n- 回答（添字）: \`${q}\`\n  - 6軸: ${K.map((k) => fmt(k, e.m.traits[k])).join(" ")} / 得点の上位: ${top}\n  - 変更前DB: 1位=${e.o.top} 2位=${e.o.second}（画面プレビュー: 1位=${e.m.tsOld.top} 2位=${e.m.tsOld.second}）\n  - 変更後DB: 1位=${e.n.top} 2位=${e.n.second}（画面プレビュー: 1位=${e.m.tsNew.top} 2位=${e.m.tsNew.second}）\n  - 理由: 上位が同点。定義順で先のタイプを優先する規則に統一した。`);
}
L.push("", "## 具体例B：丸め境界で、画面のプレビューの1位または2位が変わる");
for (const e of exB) {
  const q = e.m.answers.map((a: number, k: number) => `${Q[k].id}:${a}`).join(" ");
  const diffs = CORE_TYPE_CODES.filter((c) => e.m.tsOld.scores[c] !== e.m.tsNew.scores[c]).map((c) => { const h = hund(e.m.traits, c); return `${c}: 重み付き合計=${h / 100}（${h}/100）→ 変更前 ${e.m.tsOld.scores[c]} / 変更後 ${e.m.tsNew.scores[c]}（DBの保存値 ${e.n.scores[c]}）`; });
  L.push(`\n- 回答（添字）: \`${q}\`\n  - 6軸: ${K.map((k) => fmt(k, e.m.traits[k])).join(" ")}\n  - ${diffs.join("\n  - ")}\n  - 変更前プレビュー: 1位=${e.m.tsOld.top} 2位=${e.m.tsOld.second} / 変更後プレビュー・DB: 1位=${e.m.tsNew.top} 2位=${e.m.tsNew.second}\n  - 理由: 重み付き合計の小数第2位がちょうど5（例 x.x5）。数学的には切り上げだが、変更前のアプリは浮動小数点で x.x4999… となり切り下げていた。DBは10進数で計算するので切り上げる。変更後のアプリは整数（1/100単位）で計算し、DBと同じ結果になる。`);
}
L.push("", "## 影響の整理", "- 画面（登録前のプレビュー）と、登録後に保存される結果は、変更前は A・B の分だけ食い違うことがあった。変更後は一致する（D=0）。", "- 回答が変わらないのに結果が変わりうるのは、**今後の保存**と**画面のプレビュー**だけ。過去に保存した履歴・初回確定タイプ・変更回数・ロックには触れない。", "- 同点・丸め境界での1位・2位は、もともと「僅差」であり、どちらが上かは確信度を持たない。順序の規則（定義順）を揃えただけで、優劣の根拠を足したものではない。");
writeFileSync(outPath, L.join("\n") + "\n"); console.log(L.slice(0, 14).join("\n"));
