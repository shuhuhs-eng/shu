window.process = { env: {} } as any; (window as any).__calls = []; (window as any).__mode = "ok";
import React from "react";
import { createRoot } from "react-dom/client";
import { StylistOnboardingWizard } from "/home/claude/shu/components/profile/stylist-onboarding-wizard";
const iv: any = { publicName: "", fullName: "", ageBand: "", gender: "", birthDate: "", birthDateSupported: true, birthDateLoadFailed: false, ageDisplayMode: "", prefecture: "", desiredWorkLocation: "", experienceYears: "", currentPosition: "", specialties: [], employmentType: "", jobChangeIntent: "passive", snsLinks: [], bio: "", avatarPath: null, avatarSignedUrl: null, visibility: "PUBLIC", valuePriorities: [],
  careerPhaseSupported: true, careerPhaseLoadFailed: false, careerPhase: { phase: null, legacyStudent: false, graduationYm: null, blankPeriod: null } };
createRoot(document.getElementById("root")!).render(<main className="mx-auto max-w-[560px] px-5 py-8"><StylistOnboardingWizard userId="u1" initialValues={iv} /></main>);
