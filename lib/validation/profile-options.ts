import type {
  AgeBand,
  EmploymentType,
  GenderType,
  JobChangeIntent,
  ProfileVisibility,
  SalaryBand,
} from "@/types/database";

export const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県",
  "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県",
  "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県",
  "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
] as const;

export const SPECIALTY_OPTIONS = [
  "カット", "カラー", "パーマ・縮毛矯正", "トリートメント・ケア",
  "セット・アップスタイル", "着付け", "まつげ・ネイル", "メンズ",
  "ブライダル", "キッズ",
] as const;

export const AGE_BAND_LABELS: Record<AgeBand, string> = {
  under_20: "10代",
  "20_24": "20〜24歳",
  "25_29": "25〜29歳",
  "30_34": "30〜34歳",
  "35_39": "35〜39歳",
  "40_44": "40〜44歳",
  "45_plus": "45歳以上",
  prefer_not_to_say: "回答しない",
};

export const GENDER_LABELS: Record<GenderType, string> = {
  male: "男性",
  female: "女性",
  other: "その他",
  prefer_not_to_say: "回答しない",
};

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: "正社員",
  part_time: "パート・アルバイト",
  contract: "契約社員",
  freelance: "フリーランス・業務委託",
  owner: "オーナー・経営者",
  other: "その他",
};

export const JOB_CHANGE_INTENT_LABELS: Record<JobChangeIntent, string> = {
  active: "積極的に転職活動中",
  passive: "良い出会いがあれば検討したい",
  not_looking: "転職は考えていない",
};

export const SALARY_BAND_LABELS: Record<SalaryBand, string> = {
  lt_350: "350万円未満",
  "350_450": "350万〜450万円",
  "450_600": "450万〜600万円",
  "600_800": "600万〜800万円",
  gt_800: "800万円以上",
  flexible: "応相談",
};

export const VISIBILITY_LABELS: Record<ProfileVisibility, string> = {
  PRIVATE: "非公開（自分のみ閲覧可）",
  LIMITED: "一部公開（将来のスカウト機能等で一部のサロンに公開）",
  PUBLIC: "公開",
};

/**
 * 働き方・価値観の候補（約12項目）。この中から重要な3つを優先順位付きで選択する
 * （requirements-v1.0.md 3.1節・phase1-stylist-onboarding.md 3節）。
 * codeはDB(stylist_profiles.value_priorities)に保存する安定した識別子。
 * labelは表示用で、将来変更してもcodeが変わらない限りデータ互換性を保てる。
 */
export const VALUE_PRIORITY_OPTIONS: { code: string; label: string }[] = [
  { code: "work_life_balance", label: "ワークライフバランス重視" },
  { code: "skill_growth", label: "技術力・スキル向上重視" },
  { code: "teamwork", label: "チームワーク・仲間との関係重視" },
  { code: "independence", label: "独立・将来のキャリア形成重視" },
  { code: "income_stability", label: "安定した収入・待遇重視" },
  { code: "customer_relationship", label: "お客様との関係・接客重視" },
  { code: "education_support", label: "教育制度・研修の充実" },
  { code: "brand_customer_base", label: "顧客層・ブランドイメージ" },
  { code: "work_flexibility", label: "自由な働き方・裁量の大きさ" },
  { code: "evaluation_fairness", label: "評価制度の明確さ" },
  { code: "location_convenience", label: "通いやすさ・立地" },
  { code: "culture_fit", label: "経営者・店長との価値観の一致" },
];

/**
 * サロン側の価値観候補（「サロンらしさ」入力用）。美容師側のVALUE_PRIORITY_OPTIONSと
 * 同じcodeを使い、表現だけをサロンの立場に合わせて言い換えている。将来、美容師の
 * value_prioritiesとサロンのこの候補との重なりを「一致相性」として比較できるように
 * する狙い（docs/salon-personality-design.md 4節）。
 */
export const SALON_VALUE_PRIORITY_OPTIONS: { code: string; label: string }[] = [
  { code: "work_life_balance", label: "スタッフのワークライフバランスを大切にする" },
  { code: "skill_growth", label: "技術力の向上を大切にする" },
  { code: "teamwork", label: "チームワーク・仲間との関係を大切にする" },
  { code: "independence", label: "スタッフの独立・将来のキャリア形成を後押しする" },
  { code: "income_stability", label: "安定した収入・待遇を大切にする" },
  { code: "customer_relationship", label: "お客様との関係・接客を大切にする" },
  { code: "education_support", label: "教育制度・研修の充実を大切にする" },
  { code: "brand_customer_base", label: "顧客層・ブランドイメージを大切にする" },
  { code: "work_flexibility", label: "自由な働き方・裁量を大切にする" },
  { code: "evaluation_fairness", label: "評価制度の明確さを大切にする" },
  { code: "location_convenience", label: "通いやすさ・立地の良さを大切にする" },
  { code: "culture_fit", label: "経営者・店長とスタッフの価値観の一致を大切にする" },
];

/**
 * SNSリンクのプラットフォーム設定。将来増やす場合はここに追加するだけでよい
 * （DBはjsonb配列のため、プラットフォーム追加にマイグレーションは不要）。
 * 現時点ではInstagramのみをUIに表示する（phase1-stylist-onboarding.md確定事項）。
 */
export const SNS_PLATFORMS: { code: string; label: string; placeholder: string }[] = [
  { code: "instagram", label: "Instagram", placeholder: "ユーザー名（@なし）" },
];
