// 診断結果の「プロフィールへの反映」の確認用（モックデータ・保存先はモック。実Supabaseではない）。
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ApplyValuesToProfile } from "/home/claude/shu/components/student-diagnosis/apply-values-to-profile";

(window as any).__values = ["work_life_balance", "skill_growth", "income_stability"];
const q = new URLSearchParams(location.search);
const diag = (q.get("diag") ?? "teamwork,independence,culture_fit").split(",").filter(Boolean);
function App() {
  const [, set] = useState(0);
  (window as any).__refresh = () => set((n) => n + 1);
  return <div style={{ maxWidth: 520, margin: "0 auto", padding: 16 }}><ApplyValuesToProfile diagnosisValues={diag} current={(window as any).__values} hasProfile={true} /></div>;
}
createRoot(document.getElementById("root")!).render(<App />);
