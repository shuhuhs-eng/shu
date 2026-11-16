// 本人プレビューの「いまの立場」（本人だけに表示。サロン側には表示されない旨を明示）。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CareerPhaseOwnView } from "../components/student-diagnosis/career-phase-own-view";

test("本人プレビューの「いまの立場」: 立場・卒業・就業開始希望・免許を表示し、サロン側には表示されない旨を明示。未選択（旧データ含む）は「未選択」と案内（経験者と書かない・美容学生と出さない）", () => {
  const h = (load: unknown) => renderToStaticMarkup(createElement(CareerPhaseOwnView, { load } as never)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const base = { legacyStudent: false, graduationYm: null, blankPeriod: null };
  const ng = h({ status: "ok", value: { ...base, phase: "new_graduate", graduationYm: "2027-03" } });
  for (const t of ["新卒", "卒業（予定）: 2027年3月", "この情報は現在サロン側には表示されません", "あなただけに表示"]) assert.ok(ng.includes(t), t);
  for (const v of [{ ...base, phase: null }, { ...base, phase: null, legacyStudent: true, graduationYm: "2027-03" }]) {
    const none = h({ status: "ok", value: v });
    assert.ok(none.includes("未選択") && none.includes("選んでください") && !none.includes("経験者") && !none.includes("美容学生") && none.includes("この情報は現在サロン側には表示されません"));
  }
  const exp = h({ status: "ok", value: { ...base, phase: "experienced" } });
  assert.ok(exp.includes("現役の美容師") && exp.includes("この情報は現在サロン側には表示されません"));
  assert.ok(h({ status: "ok", value: { ...base, phase: "blank" } }).includes("ブランクあり"));
  const bl = h({ status: "ok", value: { ...base, phase: "blank", blankPeriod: { value: 6, unit: "months" } } });
  assert.ok(bl.includes("ブランク期間: 6ヶ月") && h({ status: "ok", value: { ...base, phase: "blank", blankPeriod: { value: 2, unit: "years" } } }).includes("ブランク期間: 2年"));
  assert.ok(!h({ status: "ok", value: { ...base, phase: "blank" } }).includes("ブランク期間"), "未入力は表示しない");
  const err = h({ status: "error" });
  assert.ok(err.includes("読み込めませんでした") && !err.includes("未選択") && err.includes("この情報は現在サロン側には表示されません"));
});
test("画面の構造: 区分の欄はサロン向け表示（StylistPublicView）の外・0071未適用では出さない", () => {
  const pv = readFileSync("app/stylist/profile/preview/page.tsx", "utf8");
  assert.ok(pv.indexOf("<CareerPhaseOwnView") > pv.indexOf("</StylistPublicView>") || pv.indexOf("<CareerPhaseOwnView") > pv.indexOf("<StylistPublicView"));
  assert.ok(pv.includes('careerPhase.status !== "unsupported"'));
});
