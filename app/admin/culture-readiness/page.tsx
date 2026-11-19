import Link from "next/link";
import { requireAdminPage } from "@/lib/admin/guard";
import { CULTURE_STATES, listCultureReadiness, parseCultureState, parseCultureVisibility, parseOpsPage, type AxisProblems, type CultureState } from "@/lib/admin/operations";
import { fmtJst, linkCls, OpsEmpty, OpsError, OpsPager, PageHead, contactSalonHref } from "@/components/admin/operations-ui";

type SP = Promise<Record<string, string | string[] | undefined>>;

export const CULTURE_STATE_LABEL: Record<CultureState, string> = {
  no_culture_row: "診断の記録なし",
  not_completed: "診断が未確定",
  completed_match_unready: "確定済み・相性に必要な8項目が使えない",
  completed_type_unready: "確定済み・タイプに必要な12項目の一部が使えない",
  ready: "そろっている",
};
const KEY_LABEL: Record<string, string> = {
  education_support: "教育への支援", challenge_openness: "挑戦への前向きさ", personal_brand_support: "個人ブランドへの支援", team_collaboration: "チームでの協力",
  individual_autonomy: "個人の裁量", work_flexibility: "働き方の柔軟さ", technical_specialization: "技術の専門性", premium_value: "高付加価値志向",
  trend_orientation: "トレンド志向", creative_output: "創作・表現", relationship_distance: "人との距離感", hierarchy_flatness: "上下関係のフラットさ",
};
const AXES_STATE_LABEL: Record<AxisProblems["axes_state"], string> = { sql_null: "データなし（空）", json_null: "データなし（null）", not_object: "形式が不正", object: "" };
const labels = (keys: string[]) => keys.map((k) => KEY_LABEL[k] ?? k).join("、");

function Problems({ title, p }: { title: string; p: AxisProblems }) {
  if (p.unusable_keys.length === 0) return <p className="text-[12px] text-sub">{title}: 問題なし</p>;
  const lines: string[] = [];
  if (p.axes_state !== "object") lines.push(`診断結果の入れ物: ${AXES_STATE_LABEL[p.axes_state]}`);
  if (p.absent_keys.length) lines.push(`項目なし: ${labels(p.absent_keys)}`);
  if (p.json_null_keys.length) lines.push(`値が空（null）: ${labels(p.json_null_keys)}`);
  if (p.wrong_type_keys.length) lines.push(`数値でない値: ${labels(p.wrong_type_keys)}`);
  if (p.out_of_range_keys.length) lines.push(`0〜100の範囲外: ${labels(p.out_of_range_keys)}`);
  return (
    <div className="text-[12px] text-charcoal">
      <p className="font-semibold">{title}: 使えない項目 {p.unusable_keys.length}件</p>
      <ul className="mt-0.5 list-disc pl-5 text-sub">{lines.map((l) => <li key={l}>{l}</li>)}</ul>
    </div>
  );
}

/**
 * 運営: 公開店舗の「サロンらしさ」診断の不足（読み取り専用）。0085 の admin_list_store_culture_readiness を使う。
 * ★相性（8項目）と店舗タイプ（12項目）は別々に判定する。診断の数値そのものは表示しない。
 */
export default async function AdminCultureReadinessPage({ searchParams }: { searchParams: SP }) {
  const { supabase } = await requireAdminPage("/admin/culture-readiness");
  const sp = await searchParams;
  const state = parseCultureState(sp), vis = parseCultureVisibility(sp), page = parseOpsPage(sp);
  const res = await listCultureReadiness(supabase, { state, visibility: vis, page });
  const params: Record<string, string> = { vis };
  if (state) params.state = state;
  const sel = "min-h-[44px] w-full rounded-xl border border-line bg-surface px-3 text-[13px]";
  return (
    <main className="mx-auto max-w-[900px] px-5 py-10">
      <PageHead
        title="サロンらしさ診断の状況"
        lead={<>店舗の「サロンらしさ」診断が、相性とタイプの表示に使える状態かを確認します。<b>相性は8項目、店舗タイプは12項目</b>でそれぞれ判定します。診断の数値は表示しません。</>}
      />
      <form method="get" className="mt-5 grid gap-3 rounded-2xl border border-line bg-surface p-4">
        <select name="state" defaultValue={state} className={sel} aria-label="状態">
          <option value="">状態（すべて）</option>
          {CULTURE_STATES.map((s) => <option key={s} value={s}>{CULTURE_STATE_LABEL[s]}</option>)}
        </select>
        <select name="vis" defaultValue={vis} className={sel} aria-label="公開状態">
          <option value="PUBLIC">公開店舗のみ</option><option value="PRIVATE">非公開店舗のみ</option><option value="ALL">公開・非公開すべて</option>
        </select>
        <button className="min-h-[44px] rounded-full bg-ink px-5 text-[13px] font-semibold text-white">絞り込む</button>
      </form>
      {!res.ok ? <OpsError reason={res.reason} /> : (
        <>
          <section className="mt-5 rounded-2xl border border-line bg-surface p-4" aria-label="状態ごとの店舗数">
            <p className="text-[11.5px] text-sub">対象の店舗 {res.data.summary.stores}店（状態は互いに重ならず、合計と一致します）</p>
            <ul className="mt-2 grid grid-cols-1 gap-1 text-[12.5px] text-charcoal sm:grid-cols-2">
              {CULTURE_STATES.map((s) => <li key={s}>{CULTURE_STATE_LABEL[s]}: <b>{res.data.summary[s]}</b>店</li>)}
            </ul>
          </section>
          {res.data.rows.length === 0 ? <OpsEmpty>条件に合う店舗はありません。</OpsEmpty> : (
            <>
              <p className="mt-6 text-[11.5px] text-sub">{res.data.total}店（基準時刻 {fmtJst(res.data.as_of)}）</p>
              <ul className="mt-2 space-y-3">
                {res.data.rows.map((r) => (
                  <li key={r.store_id} className="rounded-2xl border border-line bg-surface p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-serif text-[15px] font-bold text-ink">{r.store_name}</span>
                      <span className="rounded-full bg-surface2 px-2 py-0.5 text-[11px] text-charcoal">{r.visibility === "PUBLIC" ? "公開" : "非公開"}</span>
                      <span className={r.state === "ready" ? "rounded-full bg-surface2 px-2 py-0.5 text-[11px] text-charcoal" : "rounded-full bg-[#C24545]/10 px-2 py-0.5 text-[11px] font-semibold text-[#8A2E2E]"}>{CULTURE_STATE_LABEL[r.state]}</span>
                    </div>
                    <p className="mt-1 text-[12.5px] text-charcoal">{r.organization_name}</p>
                    <p className="mt-1 text-[11.5px] text-sub">最終更新 {fmtJst(r.culture_updated_at)}</p>
                    {(r.state === "completed_match_unready" || r.state === "completed_type_unready") && (
                      <div className="mt-2 space-y-2">
                        <Problems title="相性（8項目）" p={r.match_axes} />
                        <Problems title="店舗タイプ（12項目）" p={r.type_axes} />
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link href={`/admin/salons/${r.organization_id}`} className={linkCls}>会社・店舗の詳細</Link>
                      <Link href={contactSalonHref(r.organization_id, r.store_id)} className={linkCls}>サロンへ連絡（既存の連絡機能）</Link>
                    </div>
                  </li>
                ))}
              </ul>
              <OpsPager total={res.data.total} page={page} basePath="/admin/culture-readiness" params={params} />
            </>
          )}
        </>
      )}
    </main>
  );
}
