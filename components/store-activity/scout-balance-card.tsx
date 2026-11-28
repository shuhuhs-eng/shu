export type ScoutBalance = { balance: number; free_balance: number; paid_balance: number; initial_grant_pending: number; registration_set?: boolean; next_expiry?: { expires_on: string; quantity: number } | null };

/** 台帳方式（SCOUT_LEDGER_ENABLED=1）のスカウト残数。送信可否と同じ台帳の値。購入分には購入日から1年の有効期限がある（初回付与分に期限はない）。内部の仕組みは出さない。 */
const jpDay = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return `${y}年${m}月${d}日`; };
export function ScoutBalanceCard({ balance }: { balance: ScoutBalance | null }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <p className="eyebrow mb-1">スカウトの残り</p>
      {!balance ? (
        <p className="text-[12.5px] text-sub">スカウトの残数を確認できませんでした。</p>
      ) : (
        <>
          <p className="font-serif text-[22px] font-bold text-ink">{balance.balance}件</p>
          <p className="mt-1 text-[13px] font-semibold" style={{ color: balance.balance > 0 ? "#2E8B7F" : "#8A2E2E" }}>
            {balance.balance > 0 ? "送信できます" : "送れるスカウトはありません"}
          </p>
          {balance.next_expiry && <p className="mt-2 text-[12px] font-semibold text-ink">購入分のうち {balance.next_expiry.quantity}件は {jpDay(balance.next_expiry.expires_on)} までに使い切ってください（期限を過ぎると失効します）。</p>}
          {balance.registration_set === false && <p className="mt-2 text-[11.5px] leading-relaxed text-sub">初回のスカウトは、運営が登録区分を設定すると付与されます。</p>}
          <p className="mt-2 text-[11px] leading-relaxed text-sub">系列のすべての店舗で共通の残数です。初回付与分に有効期限はありません。購入分は購入日から1年間有効で、無料分から先に使われ、購入分は期限の早いものから使われます。</p>
        </>
      )}
    </div>
  );
}
