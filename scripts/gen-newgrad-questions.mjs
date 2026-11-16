// 新卒版30問の質問・選択肢・配点を、レビュー済みの設計JSON（正本）から TypeScript に書き出す。
// 使い方: node scripts/gen-newgrad-questions.mjs  → lib/diagnosis/newgrad-questions.ts
// JSONの値は一切変えない（質問文・選択肢文・配点はそのまま）。IDだけ、経験者版と区別するため p1 以外に "ng:" を付ける。
import fs from "node:fs";
const src = JSON.parse(fs.readFileSync("docs/student-newgrad-30/source/newgrad30_scoring_design.json", "utf8"));
const sec = (id) => (id.startsWith("p") ? "profile" : "t");
const out = src.questions.map((q) => ({
  id: q.id === "p1" ? "p1" : `ng:${q.id}`,
  sec: sec(q.id),
  q: q.question,
  opts: q.options.map((o) => ({ t: o.text, w: o.weights })),
}));
const body = `// 自動生成: scripts/gen-newgrad-questions.mjs（正本: docs/student-newgrad-30/source/newgrad30_scoring_design.json）。手で編集しない。
import type { Question } from "./questions";

export const Q_NEWGRAD: Question[] = ${JSON.stringify(out, null, 2)};
`;
fs.writeFileSync("lib/diagnosis/newgrad-questions.ts", body);
console.log("questions:", out.length);
