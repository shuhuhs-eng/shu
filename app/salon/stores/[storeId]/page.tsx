import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getStoreScoutQuota } from "@/lib/store-activity/actions";
import { ScoutQuotaCard } from "@/components/store-activity/scout-quota-card";

type Props = {
  params: Promise<{ storeId: string }>;
};

/**
 * 店舗ワークスペース overview（法人・複数店舗対応 Phase 2）。
 *
 * ★このページ自体にもlayout.tsxと同じアクセス権チェック（salon_storesの
 * SELECTがRLSで絞り込まれることを利用）を重ねて行っている。Next.js App
 * Routerでは/salon/stores/[storeId]/配下のどのページも必ずlayout.tsxを
 * 経由するため構造的には冗長だが、既存コードベースの「multiple defense
 * layers」方針（middleware＋各ページ側の両方でrole guardを行う等）に
 * 合わせ、ここでも同じ判定を独立して行っている。
 *
 * ★Phase 3Bで店舗プロフィール・店舗カルチャーへの導線2つを追加した。
 * Phase 5で「美容師を探す」（/salon/stores/[storeId]/stylists、
 * send_scout_v2・calculate_store_stylist_match使用）への導線を追加した。
 * Phase 6で「話を聞きたい美容師」(interests)・「スカウト履歴」(scouts)・
 * 「オファー履歴」(offers)への導線と、今月のスカウト残数
 * (get_store_scout_quota)を追加した。いずれもURLのparams.storeIdを正とし、
 * 0036の店舗単位RPCで取得する。
 */
export default async function StoreWorkspacePage({ params }: Props) {
  const { storeId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=/salon/stores/${storeId}`);
  }

  const { data: store, error } = await supabase
    .from("salon_stores")
    .select("*")
    .eq("id", storeId)
    .maybeSingle();

  if (error || !store) {
    redirect("/salon/company");
  }

  const quota = await getStoreScoutQuota(storeId);

  return (
    <main className="mx-auto max-w-[560px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5">
        <span className="eyebrow">Beauty Reach</span>
        <hr className="h-px flex-1 border-0 bg-line" />
      </div>

      <p className="eyebrow mb-2">店舗ワークスペース</p>
      <h1 className="font-serif text-2xl font-bold text-ink">{store.store_name}</h1>
      <p className="mt-2 text-[13px] text-sub">
        {store.usage_status === "active" ? "Beauty Reach利用中" : "未利用"}
      </p>

      <div className="mt-6">
        <ScoutQuotaCard quota={quota} />
      </div>

      <div className="mt-6 space-y-3">
        <Link
          href={`/salon/stores/${storeId}/stylists`}
          className="flex items-center justify-between rounded-2xl border border-line bg-surface p-5"
        >
          <span className="font-serif text-[15px] font-bold text-ink">美容師を探す</span>
          <span className="text-[12px] text-sub">スカウトを送る ›</span>
        </Link>
        <Link
          href={`/salon/stores/${storeId}/interests`}
          className="flex items-center justify-between rounded-2xl border border-line bg-surface p-5"
        >
          <span className="font-serif text-[15px] font-bold text-ink">話を聞きたい美容師</span>
          <span className="text-[12px] text-sub">確認・条件を提示 ›</span>
        </Link>
        <Link
          href={`/salon/stores/${storeId}/candidates`}
          className="flex items-center justify-between rounded-2xl border border-line bg-surface p-5"
        >
          <span className="font-serif text-[15px] font-bold text-ink">採用進捗</span>
          <span className="text-[12px] text-sub">面談・選考を管理 ›</span>
        </Link>
        <Link
          href={`/salon/stores/${storeId}/scouts`}
          className="flex items-center justify-between rounded-2xl border border-line bg-surface p-5"
        >
          <span className="font-serif text-[15px] font-bold text-ink">スカウト履歴</span>
          <span className="text-[12px] text-sub">見る ›</span>
        </Link>
        <Link
          href={`/salon/stores/${storeId}/offers`}
          className="flex items-center justify-between rounded-2xl border border-line bg-surface p-5"
        >
          <span className="font-serif text-[15px] font-bold text-ink">オファー履歴</span>
          <span className="text-[12px] text-sub">見る ›</span>
        </Link>
        <Link
          href={`/salon/stores/${storeId}/profile`}
          className="flex items-center justify-between rounded-2xl border border-line bg-surface p-5"
        >
          <span className="font-serif text-[15px] font-bold text-ink">店舗プロフィール</span>
          <span className="text-[12px] text-sub">編集する ›</span>
        </Link>
        <Link
          href={`/salon/stores/${storeId}/culture`}
          className="flex items-center justify-between rounded-2xl border border-line bg-surface p-5"
        >
          <span className="font-serif text-[15px] font-bold text-ink">サロンらしさ診断</span>
          <span className="text-[12px] text-sub">編集する ›</span>
        </Link>
      </div>

      <Link
        href="/salon/mypage"
        className="mt-6 flex w-full items-center justify-center rounded-full bg-ink px-6 py-4 text-[15px] font-semibold text-surface"
      >
        既存のマイページへ戻る
      </Link>

      <Link href="/salon/company" className="mt-4 block text-center text-[13px] text-sub underline">
        会社ダッシュボードに戻る
      </Link>
    </main>
  );
}
