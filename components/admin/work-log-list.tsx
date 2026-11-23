import type { WorkLogRow } from "@/lib/admin/work-log";
import { fmtJst } from "@/components/admin/operations-ui";

/** 対応の記録の一覧（運営のみ）。実対応者・入力者・その時点の担当・代理付記の理由を名前で表示する。取得失敗は空とは別に表示。 */
export function WorkLogList({ log, loaded }: { log: WorkLogRow[]; loaded: boolean }) {
  return (
    <section className="mt-8" aria-label="対応の記録">
      <h2 className="text-[13px] font-bold text-ink">対応の記録（運営のみ）</h2>
      <p className="mt-1 text-[11.5px] leading-relaxed text-sub">「実対応者」は実際に対応した人、「入力者」は画面に入力した人です。別の人が代理で入力した場合は、その理由を表示します。停止したスタッフの過去の記録もそのまま残ります。</p>
      {!loaded ? <p role="alert" className="mt-2 rounded-lg bg-[#F5E9E9] px-3 py-2 text-[12px] text-[#8A2E2E]">対応の記録を取得できませんでした。時間をおいて開き直してください。</p>
        : log.length === 0 ? <p className="mt-2 text-[12px] text-sub">記録はまだありません。</p>
        : <ul className="mt-2 space-y-2 text-[12px] text-sub">{log.map((e) => (
            <li key={e.key} data-testid="work-log-row" className="rounded-xl border border-line bg-surface px-3 py-2">
              <div className="text-charcoal"><b>{e.actionLabel}</b> <span className="text-sub">（{fmtJst(e.occurredAt)}）</span></div>
              <div>実対応者: <span className="text-charcoal">{e.performedName}</span> / 入力者: <span className="text-charcoal">{e.enteredName}</span>{e.assigneeName && <> / その時点の担当: <span className="text-charcoal">{e.assigneeName}</span></>}</div>
              {e.proxyReason && <div>代理で入力した理由: <span className="text-charcoal">{e.proxyReason}</span></div>}
            </li>))}</ul>}
    </section>
  );
}
