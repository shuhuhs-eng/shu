import { redirect } from "next/navigation";

/**
 * 旧「新卒向け15問」の入口。新しい入口は共通の30問（/stylist/diagnosis）に統一したため、ここからは新規に受けられない。
 * 過去に保存した15問の結果は /stylist/diagnosis/student/result で引き続き見られる（保存済みの結果・変更回数・ロックは変えない）。
 * 既存のブックマークや開いたままの画面から来た人は、共通の30問へ案内する。
 */
export default function StudentDiagnosisPage() {
  redirect("/stylist/diagnosis");
}
