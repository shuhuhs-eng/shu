import { redirect } from "next/navigation";

/**
 * 美容師エリアの入口。現時点では単純に /stylist/mypage へ誘導するだけの
 * ハブページ。将来、1アカウントが複数roleを持てるようになった際に、
 * ここへ「美容師として利用」を選んだ後の追加コンテキスト（役割切り替え等）を
 * 置く余地として、あえて /stylist/mypage への直接リンクにせず専用ルートにしている。
 */
export default function StylistHubPage() {
  redirect("/stylist/mypage");
}
