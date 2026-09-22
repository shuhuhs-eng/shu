export const CAREER_GOALS = [
  { code: "fair_evaluation", label: "売上や実績を正当に評価してほしい" },
  { code: "keep_clients", label: "今のお客様を継続して担当したい" },
  { code: "increase_clients", label: "もっと入客したい" },
  { code: "higher_unit_price", label: "高単価な仕事へ移りたい" },
  { code: "income_growth", label: "収入を上げたい" },
  { code: "more_days_off", label: "休日を増やしたい" },
  { code: "flexible_hours", label: "勤務時間を柔軟にしたい" },
  { code: "education_growth", label: "技術を学び成長したい" },
  { code: "management_career", label: "店長・幹部を目指したい" },
  { code: "independence", label: "独立へ向けて経験を積みたい" },
  { code: "personal_brand", label: "SNS・個人ブランドを伸ばしたい" },
  { code: "better_relationships", label: "人間関係や職場環境を変えたい" },
] as const;

export type CareerGoalCode = (typeof CAREER_GOALS)[number]["code"];
export const CAREER_GOAL_LABELS = Object.fromEntries(
  CAREER_GOALS.map((goal) => [goal.code, goal.label]),
) as Record<CareerGoalCode, string>;

export const CAREER_STAGES = [
  { code: "results_stylist", label: "売上・顧客実績があるスタイリスト", note: "実績を登録し、サロンからの実績オファーにつなげます" },
  { code: "growing_stylist", label: "これから売上を伸ばしたいスタイリスト", note: "希望する成長環境との相性を重視します" },
  { code: "assistant_newcomer", label: "アシスタント・新卒", note: "教育とデビュー環境との相性を重視します" },
] as const;

export type CareerStageCode = (typeof CAREER_STAGES)[number]["code"];
