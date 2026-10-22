import type { StoreScoutQuota } from "@/lib/store-activity/types";

type Props = {
  quota: StoreScoutQuota | null;
};

/**
 * 今月送れるスカウトの残数表示。内部の仕組み（会社単位の枠など）は
 * ユーザー向けには出さず、「今月のスカウト 3 / 10件・残り7件」の形で見せる。
 * 追加枠がある場合は合計に含め、内訳を補足として添える。
 */
export function ScoutQuotaCard({ quota }: Props) {
  if (!quota) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-5">
        <p className="eyebrow mb-1">今月のスカウト</p>
        <p className="text-[12.5px] text-sub">スカウトの残数を確認できませんでした。</p>
      </div>
    );
  }

  const total = quota.monthly_free_limit + quota.additional_credits;

  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <p className="eyebrow mb-1">今月のスカウト</p>
      <p className="font-serif text-[22px] font-bold text-ink">
        {quota.used_this_month} / {total}件
      </p>
      <p className="mt-1 text-[13px] font-semibold" style={{ color: quota.remaining > 0 ? "#2E8B7F" : "#8A2E2E" }}>
        {quota.remaining > 0 ? `残り${quota.remaining}件` : "今月送れるスカウトはありません"}
      </p>
      {quota.additional_credits > 0 && (
        <p className="mt-1 text-[11px] text-sub">
          毎月の枠 {quota.monthly_free_limit}件 + 追加枠 {quota.additional_credits}件
        </p>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-sub">
        系列のすべての店舗で送ったスカウトの合計です。
      </p>
    </div>
  );
}
