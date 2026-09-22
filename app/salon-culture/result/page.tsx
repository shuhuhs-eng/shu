import { redirect } from "next/navigation";

// 旧URL。役割別ルーティング分離により /salon/culture/result へ移動した。
export default function SalonCultureResultRedirect() {
  redirect("/salon/culture/result");
}
