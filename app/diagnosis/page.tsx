import { redirect } from "next/navigation";

/**
 * 旧ルート。診断は role ごとに /diagnosis/stylist と /diagnosis/salon に
 * 分離したため、ここへ直接来た場合は美容師向けへリダイレクトする
 * （過去のリンク・ブックマーク互換のための保険）。
 */
export default function DiagnosisRedirectPage() {
  redirect("/stylist/diagnosis");
}
