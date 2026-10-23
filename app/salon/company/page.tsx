import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasCompletedRole } from "@/lib/auth/user-roles";
import { hasCompanyLevelRole } from "@/lib/hiring/permissions";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { getNotificationsForBell } from "@/lib/notifications/get-notifications";
import { activeCount, countByStatus, getCompanyHiringScope, loadCompanyHiring } from "@/lib/hiring/company";
import { canViewCompanyBilling } from "@/lib/billing/permissions";
import { getCompanySuccessFees } from "@/lib/billing/actions";
import { summarizeFees } from "@/lib/billing/summary";

/**
 * 会社ダッシュボード（法人・複数店舗対応 Phase 1）。
 *
 * ★role guard: 既存の/salon/mypage等と同じ多重防御パターン
 * （middlewareには今回追加していないが、ページ自体でsalon roleの完了を
 * 確認する。lib/supabase/middleware.tsは今回変更していない）。
 *
 * ★店舗一覧の取得方法（重要）: ここでは権限ロジックを一切複製していない。
 * salon_stores・salon_organizationsのSELECTは、0026で定義済みのRLS
 * （salon_stores_select_accessible・salon_organizations_select_member、
 * いずれもis_store_accessible()/is_organization_member()を内部で使う）が
 * 「このユーザーがアクセスできる行だけ」を自動的に絞り込むため、素直に
 * SELECTするだけでよい。company_owner/company_admin/recruiting_adminは
 * 所属会社の全店舗、area_manager/store_manager/recruiter/viewerは
 * store_membersで割り当てられた店舗のみが、この時点で既に正しく
 * 絞り込まれた状態で返ってくる。
 *
 * ★既存機能への影響: scouts/salary_offers/stylist_salon_interests/
 * salon_scout_quotas/matching RPC/salon_profiles/salon_culture_profiles/
 * notificationsはいずれも参照していない。salon_organizations/salon_stores
 * は既存のどの機能からも参照されていない独立したテーブルのため、
 * このページの追加が既存動作に影響することはない。
 *
 * ★検索機能について: 今回は実装しないが、storeListは単純な配列のため、
 * 将来クライアント側フィルタ（店舗名でのインクリメンタル検索等）や
 * サーバー側検索パラメータを追加する際も、この配列をそのまま絞り込む
 * だけで拡張できる構造にしてある。
 */
export default async function SalonCompanyPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/salon/company");
  }

  if (!(await hasCompletedRole(supabase, user.id, "salon"))) {
    redirect("/onboarding/salon");
  }

  const { data: stores } = await supabase
    .from("salon_stores")
    .select("*")
    .order("store_name", { ascending: true });
  const storeList = stores ?? [];

  // 会社横断の採用ダッシュボードへの導線は、会社レベルの役割がある人にだけ出す。
  // 通知（採用進捗の辞退など）もここから確認できるようにする。
  const [showHiringDashboard, { notifications, unreadCount }] = await Promise.all([
    hasCompanyLevelRole(supabase, user.id),
    getNotificationsForBell(supabase, user.id),
  ]);

  // 採用KPI（会社レベルの役割のみ）と請求KPI（company_owner / company_admin のみ）。
  // 取得できなかった場合は数字を出さず、リンクだけ残す（0件と誤表示しない）。
  const showBilling = showHiringDashboard ? await canViewCompanyBilling(supabase, user.id) : false;
  const [hiringKpis, billingKpis] = await Promise.all([
    showHiringDashboard
      ? (async () => {
          const scope = await getCompanyHiringScope(supabase, user.id);
          if (!scope || scope.length === 0) return null;
          const { rows, failedStores } = await loadCompanyHiring(scope);
          if (failedStores.length > 0) return null;
          const counts = countByStatus(rows);
          return [
            { label: "選考中", value: activeCount(counts) },
            { label: "面談予定", value: counts.interview_scheduled ?? 0 },
            { label: "内定", value: counts.offered ?? 0 },
            { label: "採用", value: counts.hired ?? 0 },
          ];
        })()
      : Promise.resolve(null),
    showBilling
      ? (async () => {
          const fees = await getCompanySuccessFees();
          if (!fees) return null;
          const summary = summarizeFees(fees);
          return [
            { label: "請求確認中", value: summary.counts.pending_confirmation },
            { label: "請求額確定", value: summary.counts.confirmed },
            { label: "請求済み", value: summary.counts.invoiced },
            { label: "入金済み", value: summary.counts.paid },
          ];
        })()
      : Promise.resolve(null),
  ]);

  const orgIds = [...new Set(storeList.map((s) => s.organization_id))];
  const { data: orgs } = orgIds.length > 0
    ? await supabase.from("salon_organizations").select("*").in("id", orgIds)
    : { data: [] };
  const orgNameById = new Map((orgs ?? []).map((o) => [o.id, o.name]));

  return (
    <main className="mx-auto max-w-[560px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5">
        <span className="eyebrow">Beauty Reach</span>
        <hr className="h-px flex-1 border-0 bg-line" />
        <NotificationBell notifications={notifications} unreadCount={unreadCount} role="salon" />
      </div>

      <p className="eyebrow mb-2">会社・店舗管理</p>
      <h1 className="font-serif text-2xl font-bold text-ink">会社ダッシュボード</h1>
      <p className="mt-3 text-[13px] leading-relaxed text-charcoal">
        アクセスできる店舗の一覧です。店舗を選ぶとその店舗のワークスペースへ移動します。
      </p>

      {showHiringDashboard && (
        <Link
          href="/salon/company/hiring"
          className="mt-6 flex items-center justify-between rounded-2xl border border-line bg-surface p-5"
        >
          <span className="font-serif text-[15px] font-bold text-ink">採用ダッシュボード</span>
          <span className="text-[12px] text-sub">会社全体の採用状況 ›</span>
        </Link>
      )}

      {showHiringDashboard && (
        <Link
          href="/salon/company/analytics"
          className="mt-3 flex items-center justify-between rounded-2xl border border-line bg-surface p-5"
        >
          <span className="font-serif text-[15px] font-bold text-ink">採用分析</span>
          <span className="text-[12px] text-sub">入口別・店舗別の進み具合 ›</span>
        </Link>
      )}

      {hiringKpis && (
        <section className="mt-4">
          <p className="mb-2 text-[11px] font-semibold text-sub">採用</p>
          <div className="grid grid-cols-4 gap-2">
            {hiringKpis.map((k) => (
              <div key={k.label} className="rounded-xl border border-line bg-surface p-3 text-center">
                <p className="text-[10.5px] text-sub">{k.label}</p>
                <p className="mt-0.5 font-serif text-[20px] font-bold text-ink">{k.value}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {showBilling && (
        <>
          <Link
            href="/salon/company/billing"
            className="mt-4 flex items-center justify-between rounded-2xl border border-line bg-surface p-5"
          >
            <span className="font-serif text-[15px] font-bold text-ink">請求・成功報酬</span>
            <span className="text-[12px] text-sub">採用に伴う請求の状況 ›</span>
          </Link>
          <Link
            href="/salon/company/contract"
            className="mt-3 flex items-center justify-between rounded-2xl border border-line bg-surface p-5"
          >
            <span className="font-serif text-[15px] font-bold text-ink">契約内容</span>
            <span className="text-[12px] text-sub">契約状態・成功報酬の基準額 ›</span>
          </Link>
          {billingKpis && (
            <section className="mt-3">
              <p className="mb-2 text-[11px] font-semibold text-sub">請求</p>
              <div className="grid grid-cols-4 gap-2">
                {billingKpis.map((k) => (
                  <div key={k.label} className="rounded-xl border border-line bg-surface p-3 text-center">
                    <p className="text-[10.5px] text-sub">{k.label}</p>
                    <p className="mt-0.5 font-serif text-[20px] font-bold text-ink">{k.value}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {storeList.length === 0 ? (
        <p className="mt-8 text-center text-[13px] text-sub">アクセスできる店舗がありません。</p>
      ) : (
        <div className="mt-8 space-y-3">
          {storeList.map((store) => (
            <Link
              key={store.id}
              href={`/salon/stores/${store.id}`}
              className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-5"
            >
              <div className="min-w-0">
                <p className="text-[11px] text-sub">{orgNameById.get(store.organization_id) ?? "会社情報なし"}</p>
                <h2 className="mt-1 truncate font-serif text-[16px] font-bold text-ink">{store.store_name}</h2>
              </div>
              <span
                className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-bold ${
                  store.usage_status === "active" ? "bg-[#EAF3EC] text-[#2E8B7F]" : "bg-surface2 text-sub"
                }`}
              >
                {store.usage_status === "active" ? "利用中" : "未利用"}
              </span>
            </Link>
          ))}
        </div>
      )}

      <Link href="/salon/mypage" className="mt-8 block text-center text-[13px] text-sub underline">
        マイページに戻る
      </Link>
    </main>
  );
}
