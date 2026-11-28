import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasCompletedRole } from "@/lib/auth/user-roles";
import { canManageStoreHiringHint } from "@/lib/hiring/permissions";
import { areaSearchV2Enabled } from "@/lib/area/feature-flag";
import { fetchStoreRegion } from "@/lib/area/area-search";
import { fetchActiveRegionRows } from "@/lib/area/region-query";
import { isRegionValid, todayJst } from "@/lib/area/regions";
import { StoreRegionForm } from "@/components/area/store-region-form";

type Props = { params: Promise<{ storeId: string }> };
const STATUS_TEXT: Record<string, string> = { confirmed: "確定済み", unconfirmed: "未確認", stale: "住所が変更されたため再確認が必要", expired: "地域の区分が更新されたため再確認が必要" };

/** サロン: 店舗の所在地（市区・区）の確認・確定（地域検索 v2。フラグ AREA_SEARCH_V2=1 のときだけ）。権限の最終判定はDB。 */
export default async function StoreRegionPage({ params }: Props) {
  if (!areaSearchV2Enabled()) notFound();
  const { storeId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/salon/stores/${storeId}/region`);
  if (!(await hasCompletedRole(supabase, user.id, "salon"))) redirect("/onboarding/salon");
  const { data: store } = await supabase.from("salon_stores").select("*").eq("id", storeId).maybeSingle();
  if (!store) redirect("/salon/company");

  const [region, masters, canManage] = await Promise.all([fetchStoreRegion(supabase, storeId), fetchActiveRegionRows(supabase), canManageStoreHiringHint(supabase, user.id, storeId, store.organization_id)]);
  const today = todayJst();
  const rows = masters && region.ok && region.region?.pref_code ? masters.rows.filter((r) => r.pref_code === region.region!.pref_code && isRegionValid(r, today)) : [];
  const r = region.ok ? region.region : null;
  return (
    <main className="mx-auto max-w-[560px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5"><span className="eyebrow">Beauty Reach</span><hr className="h-px flex-1 border-0 bg-line" /></div>
      <Link href={`/salon/stores/${storeId}/stylists`} className="text-[13px] font-semibold text-sub underline">← 美容師を探すに戻る</Link>
      <p className="eyebrow mb-2 mt-5">店舗の所在地</p>
      <h1 className="font-serif text-2xl font-bold text-ink">{store.store_name}</h1>
      <p className="mt-3 text-[13px] leading-relaxed text-charcoal">住所から所在地（市区）を確認し、近隣の美容師を探すために使います。住所そのものは美容師に表示されません。</p>
      {!region.ok || !r ? (
        <p role="alert" className="mt-8 rounded-lg bg-surface2 px-4 py-3 text-[13px] text-charcoal">{region.ok ? "店舗のプロフィールがまだ登録されていません。" : region.message}</p>
      ) : (
        <div className="mt-8">
          <dl className="space-y-1 text-[13px] text-charcoal">
            <div className="flex gap-2"><dt className="w-20 shrink-0 text-sub">登録の住所</dt><dd>{[r.address.prefecture, r.address.city, r.address.street_address].filter(Boolean).join(" ") || "未登録"}</dd></div>
            <div className="flex gap-2"><dt className="w-20 shrink-0 text-sub">状態</dt><dd>{STATUS_TEXT[r.status] ?? r.status}{r.status === "confirmed" && (r.city_name || r.ward_name) ? `（${[r.city_name, r.ward_name].filter(Boolean).join(" ")}）` : ""}</dd></div>
          </dl>
          {!canManage ? (
            <p className="mt-6 rounded-lg bg-surface2 px-4 py-3 text-[12.5px] leading-relaxed text-charcoal">所在地の確定には、採用管理の権限が必要です。</p>
          ) : !r.pref_code || rows.length === 0 ? (
            <p role="alert" className="mt-6 rounded-lg bg-surface2 px-4 py-3 text-[12.5px] leading-relaxed text-charcoal">都道府県を判定できないため、市区を選べません。店舗プロフィールの住所（都道府県）を確認してください。</p>
          ) : (
            <div className="mt-8"><StoreRegionForm storeId={storeId} rows={rows} initialCity={r.status === "confirmed" ? r.city_code : null} initialWard={r.status === "confirmed" ? r.ward_code : null} fingerprint={r.address_fingerprint} revision={r.region_revision} /></div>
          )}
        </div>
      )}
    </main>
  );
}
