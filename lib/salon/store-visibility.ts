/**
 * 店舗プロフィールの公開範囲。画面で選べるのは「公開」「非公開（現在募集はしていません）」の2択。
 * DB の enum（PRIVATE / LIMITED / PUBLIC）と既存データは変更しない。
 * 既存の「一部公開（LIMITED）」の店舗は、画面では「非公開」として表示する（LIMITED はサロン一覧・検索・スカウトの
 * どこでも PUBLIC 扱いされていない＝今も美容師には見えていないため、見え方は変わらない。自動で公開へは変換しない）。
 */
export type SalonVisibilityChoice = "PUBLIC" | "PRIVATE";

export const SALON_VISIBILITY_OPTIONS: ReadonlyArray<{ value: SalonVisibilityChoice; label: string }> = [
  { value: "PUBLIC", label: "公開" },
  { value: "PRIVATE", label: "非公開（現在募集はしていません）" },
];

/** DB の値を画面の2択へ。PUBLIC だけが公開。それ以外（PRIVATE・LIMITED・不明）は非公開として表示する。 */
export function toSalonVisibilityChoice(value: string | null | undefined): SalonVisibilityChoice {
  return value === "PUBLIC" ? "PUBLIC" : "PRIVATE";
}

/** 新規入力（店舗プロフィールがまだ無い）の初期選択。 */
export const SALON_VISIBILITY_NEW_DEFAULT: SalonVisibilityChoice = "PUBLIC";
