import { redirect } from "next/navigation";

// 旧URL。役割別ルーティング分離により /stylist/diagnosis へ移動した。
export default function StylistDiagnosisRedirect() {
  redirect("/stylist/diagnosis");
}
