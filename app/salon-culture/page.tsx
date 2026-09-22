import { redirect } from "next/navigation";

// 旧URL。役割別ルーティング分離により /salon/culture へ移動した。
// ?edit=1 等のクエリはそのまま引き継ぐ。
export default async function SalonCultureRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") qs.set(key, value);
  }
  const suffix = qs.toString();
  redirect(suffix ? `/salon/culture?${suffix}` : "/salon/culture");
}
