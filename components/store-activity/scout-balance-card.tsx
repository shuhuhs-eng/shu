export type ScoutBalance = { balance: number; free_balance: number; paid_balance: number; initial_grant_pending: number };

/** 台帳方式（SCOUT_LEDGER_ENABLED=1）のスカウト残数。送信可否と同じ台帳の値。期限はない。内部の仕組みは出さない。 */
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
          <p className="mt-2 text-[11px] leading-relaxed text-sub">系列のすべての店舗で共通の残数です。有効期限はありません。無料分から先に使われます。</p>
        </>
      )}
    </div>
  );
}
