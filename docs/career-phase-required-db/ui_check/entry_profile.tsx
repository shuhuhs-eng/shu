window.process = { env: {} } as any; (window as any).__calls = []; (window as any).__mode = "ok";
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ProfileForm } from "/home/claude/shu/components/profile/profile-form";
import { CareerPhaseSummary } from "/home/claude/shu/components/student-diagnosis/career-phase-summary";
const E: any = { phase: null, legacyStudent: false, graduationYm: null, blankPeriod: null };
const base: any = { publicName: "さくら", fullName: "山田 花子", ageBand: "30_34", gender: "female", birthDate: "1990-04-01", birthDateSupported: true, birthDateLoadFailed: false, ageDisplayMode: "decade", prefecture: "東京都", desiredWorkLocation: "", experienceYears: "3", currentPosition: "", specialties: ["カット"], employmentType: "full_time", jobChangeIntent: "passive", snsLinks: [], bio: "自己紹介", avatarPath: null, avatarSignedUrl: null, visibility: "PUBLIC", valuePriorities: ["work_life_balance", "skill_growth", "income_stability"], careerPhaseSupported: true, careerPhaseLoadFailed: false };
// ?phase=unset|legacy|blank|... で初期値を切り替える。?reload=1 のときは直前に保存された値（window.name に保持）から開く＝再読み込み後の再表示
const q = new URLSearchParams(location.search); const saved = (() => { try { return JSON.parse(window.name || "null"); } catch { return null; } })();
const init = q.get("reload") && saved ? saved : q.get("phase") === "legacy" ? { ...E, legacyStudent: true, graduationYm: "2027-03" } : q.get("phase") === "may" ? { ...E, phase: "new_graduate", graduationYm: "2027-05" } : E;
(window as any).__persist = (obj: any) => { const y = obj.graduationYear?.[0], m = obj.graduationMonth?.[0], bv = obj.blankPeriodValue?.[0];
  window.name = JSON.stringify({ phase: obj.careerPhase?.[0] ?? null, legacyStudent: false, graduationYm: y && m ? `${y}-${String(m).padStart(2, "0")}` : null, blankPeriod: bv ? { value: Number(bv), unit: obj.blankPeriodUnit?.[0] } : null }); };
createRoot(document.getElementById("root")!).render(<main className="mx-auto max-w-[560px] px-5 py-8 space-y-8"><ProfileForm mode="edit" userId="u1" initialValues={{ ...base, careerPhase: init }} /><div id="card"><CareerPhaseSummary load={{ status: "ok", value: init }} /></div></main>);
