import { redirect } from "next/navigation";

// 旧URL。役割別ルーティング分離により /stylist/profile へ移動した。
export default function ProfileEditRedirect() {
  redirect("/stylist/profile");
}
