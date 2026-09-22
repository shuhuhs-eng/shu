import { redirect } from "next/navigation";

// 旧URL。役割別ルーティング分離により /salon/profile へ移動した。
export default function SalonProfileEditRedirect() {
  redirect("/salon/profile");
}
