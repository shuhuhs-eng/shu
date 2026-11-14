import { Q } from "./questions";
import { isValidAnswers } from "./index";
import { TRAITS, type TraitScores, type TraitKey } from "./traits";
import { TRAIT_INFO } from "./trait-descriptions";

/**
 * 「経験・実績の特徴」と「これから伸ばせる点」を、保存済みの回答と6才能スコアから読み出す（表示専用）。
 *
 * ★診断の配点・計算式・市場価値の算出（marketValue）は一切変更しない。市場価値の点数・想定年収帯は
 *   点数や金額・「上位○%」に置き換えず、ここでは使わない（DBの既存値はそのまま保持される）。
 * ★読み出すのは、本人が実際に選んだ回答（経験・役割・得意分野・理想の働き方）と、6才能スコアの高い項目／
 *   伸びしろのある項目だけ。回答が読めない場合（旧データなど）は null を返し、画面は出さない。
 */
export type ExperienceProfile = {
  /** 本人が選んだ回答（質問に対する選択肢の文言）。 */
  answers: { experience: string | null; role: string | null; specialties: string[]; workStyles: string[] };
  /** 6才能のうち得点が高い上位2項目（同点は TRAITS の並び順）。 */
  strengths: { key: TraitKey; name: string; description: string }[];
  /** 6才能のうち、いまは得点が低めで、伸ばせる余地のある下位2項目。 */
  growth: { key: TraitKey; name: string; description: string }[];
};

export function buildExperienceProfile(answers: unknown, scores: TraitScores): ExperienceProfile | null {
  if (!isValidAnswers("stylist", answers)) return null;
  const out: ExperienceProfile["answers"] = { experience: null, role: null, specialties: [], workStyles: [] };
  Q.forEach((q, i) => {
    const chosen = q.opts[answers[i]];
    const m = chosen?.m;
    if (!m) return;
    if (m.exp != null && out.experience == null) out.experience = chosen.t;
    if (m.role != null && out.role == null) out.role = chosen.t;
    if (m.spec != null && !out.specialties.includes(chosen.t)) out.specialties.push(chosen.t);
    if (m.cul != null && !out.workStyles.includes(chosen.t)) out.workStyles.push(chosen.t);
  });
  const order = TRAITS.map((t) => t.key);
  const ranked = [...order].sort((a, b) => scores[b] - scores[a] || order.indexOf(a) - order.indexOf(b));
  const pick = (keys: TraitKey[]) => keys.map((key) => ({ key, name: TRAIT_INFO[key].name, description: TRAIT_INFO[key].description }));
  return { answers: out, strengths: pick(ranked.slice(0, 2)), growth: pick(ranked.slice(-2).reverse()) };
}
