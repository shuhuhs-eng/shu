import { z } from "zod";
import { SPECIALTY_OPTIONS } from "./profile-options";
import { capArrayInput } from "./bounded-array";
import { hotpepperUrlSchema } from "./salon-profile";

export const STORE_INTRO_MAX = 3000;

/** 改行を LF に揃える（ブラウザのフォーム送信は textarea の改行を CRLF にするため、画面の数え方とずれないようにする）。 */
export function normalizeIntroNewlines(s: string): string {
  return s.replace(/\r\n?/g, "\n");
}

/**
 * 店舗紹介の文字数。画面・サーバー検証・DB（char_length）で同じ数え方にする:
 * 改行は1文字、前後の空白は除き、絵文字などのサロゲートペアは1文字（コードポイント数）。
 */
export function countIntroChars(s: string): number {
  return [...normalizeIntroNewlines(s).trim()].length;
}

// 画面で選べるのは「公開」「非公開」の2択（DB の enum と既存データは変更しない。「一部公開」は新たに保存しない）。
const visibilityEnum = z.enum(["PRIVATE", "PUBLIC"]);

/**
 * 店舗単位プロフィールフォームの入力検証（法人・複数店舗対応 Phase 3B）。
 * lib/validation/salon-profile.ts（旧・user_id単位）と対称構造。
 *
 * ★既存lib/validation/salon-profile.tsは一切変更していない（hotpepperUrlSchemaを
 * importして再利用するのみ）。avatar_path / instagram_handle は0029の
 * salon_store_profilesに含めていない列のため、ここでは検証しない
 * （avatar・写真・外部リンクは引き続きuser_id単位のまま、Phase 3Bの対象外）。
 */
export const salonStoreProfileFormSchema = z.object({
  salonName: z.string().trim().min(1, "店舗名を入力してください").max(60, "店舗名は60文字以内で入力してください"),
  prefecture: z.string().trim().min(1, "都道府県を選択してください"),
  city: z.string().trim().max(100, "100文字以内で入力してください").optional().or(z.literal("")),
  streetAddress: z.string().trim().max(200, "200文字以内で入力してください").optional().or(z.literal("")),
  employeeSizeCode: z.string().trim().max(50, "不正な値です").optional().or(z.literal("")),
  targetSpecialties: capArrayInput(
    SPECIALTY_OPTIONS.length,
    z.array(z.enum(SPECIALTY_OPTIONS)).min(1, "採用したい得意技術を1つ以上選択してください"),
  ),
  // 店舗紹介（旧「店舗のカルチャー・文化」の自由記述もここへ統合する）。上限は3,000字（DBも同じ。自動で切り詰めない）。
  bio: z
    .string()
    .transform(normalizeIntroNewlines)
    .pipe(z.string().trim().refine((v) => countIntroChars(v) <= STORE_INTRO_MAX, `${STORE_INTRO_MAX}文字以内で入力してください`))
    .optional()
    .or(z.literal("")),
  // 保存時に画面が読み込んでいた店舗紹介の版（他の画面での更新を上書きしないための照合に使う）。
  expectedRevision: z.coerce.number().int().min(1).max(2_000_000_000).nullable().optional(),
  // keep=表示を変えない／unified=「統合済み」にする（旧文化欄の公開表示を止める。文章は削除しない）／restore=表示を戻す
  introDisplay: z.enum(["keep", "unified", "restore"]).optional(),
  hotpepperUrl: hotpepperUrlSchema,
  visibility: visibilityEnum,
});

export type SalonStoreProfileFormValues = z.infer<typeof salonStoreProfileFormSchema>;
