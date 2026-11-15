// 本人プレビューの「いまの立場」（本人だけに表示。サロン側には表示されない旨を明示）。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CareerPhaseOwnView } from "../components/student-diagnosis/career-phase-own-view";

test("本人プレビューの「いまの立場」: 区分・卒業・就業開始希望・免許を表示し、サロン側には表示されない旨を明示。未設定は「未設定」（経験者と書かない）", () => {
  const h = (load: unknown) => renderToStaticMarkup(createElement(CareerPhaseOwnView, { load } as never)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const stu = h({ status: "ok", value: { phase: "student", graduationYm: "2027-03", graduationKind: "planned", desiredStartYm: "2027-04", licenseStatus: "exam_planned" } });
  for (const t of ["美容学生（在学中）", "2027年03月 卒業予定", "就業開始の希望: 2027年04月", "免許:", "この情報は現在サロン側には表示されません", "あなただけに表示"]) assert.ok(stu.includes(t), t);
  const none = h({ status: "ok", value: { phase: null, graduationYm: null, graduationKind: null, desiredStartYm: null, licenseStatus: null } });
  assert.ok(none.includes("未設定") && !none.includes("経験者") && none.includes("この情報は現在サロン側には表示されません"));
  const exp = h({ status: "ok", value: { phase: "experienced", graduationYm: null, graduationKind: null, desiredStartYm: null, licenseStatus: null } });
  assert.ok(exp.includes("現役の美容師（経験者）") && exp.includes("この情報は現在サロン側には表示されません"));
  const err = h({ status: "error" });
  assert.ok(err.includes("読み込めませんでした") && !err.includes("未設定") && err.includes("この情報は現在サロン側には表示されません"));
});
test("画面の構造: 区分の欄はサロン向け表示（StylistPublicView）の外・0071未適用では出さない", () => {
  const pv = readFileSync("app/stylist/profile/preview/page.tsx", "utf8");
  assert.ok(pv.indexOf("<CareerPhaseOwnView") > pv.indexOf("</StylistPublicView>") || pv.indexOf("<CareerPhaseOwnView") > pv.indexOf("<StylistPublicView"));
  assert.ok(pv.includes('careerPhase.status !== "unsupported"'));
});
