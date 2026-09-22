import { redirect } from "next/navigation";

/**
 * サロンエリアの入口。現時点では単純に /salon/mypage へ誘導するだけの
 * ハブページ。将来、1アカウントが複数roleを持てるようになった際に、
 * ここへ「サロンとして利用」を選んだ後の追加コンテキスト（役割切り替え等）を
 * 置く余地として、あえて /salon/mypage への直接リンクにせず専用ルートにしている。
 */
export default function SalonHubPage() {
  redirect("/salon/mypage");
}
