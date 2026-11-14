import { requireAdminPage } from "@/lib/admin/guard";
import { listStylists, parseArea, parsePage, parseQ } from "@/lib/admin/directory";
import { AreaFilterFields } from "@/components/admin/area-filter";
import { ErrorBox, Pager, StylistCard, STATE_LABEL } from "@/components/admin/directory-ui";

type SP = Promise<Record<string, string | string[] | undefined>>;

/** 運営: 美容師の一覧（読み取り専用）。居住地と勤務希望地は別の項目・別の絞り込み。 */
export default async function AdminStylistsPage({ searchParams }: { searchParams: SP }) {
  const { supabase } = await requireAdminPage("/admin/stylists");
  const sp = await searchParams;
  const q = parseQ(sp), page = parsePage(sp);
  const residence = parseArea(sp, "rpref", "rregion");
  const desired = parseArea(sp, "dpref", "dregion");
  const v = sp.vis; const visibility = (Array.isArray(v) ? v[0] : v) ?? "";
  const st = sp.state; const state = (Array.isArray(st) ? st[0] : st) ?? "";
  const res = await listStylists(supabase, { q, residence, desired, visibility, state, page });
  const params: Record<string, string> = {};
  if (q) params.q = q; if (residence.prefecture) params.rpref = residence.prefecture; if (residence.region) params.rregion = residence.region;
  if (desired.prefecture) params.dpref = desired.prefecture; if (desired.region) params.dregion = desired.region; if (visibility) params.vis = visibility; if (state) params.state = state;
  const sel = "min-h-[44px] w-full rounded-xl border border-line bg-surface px-3 text-[13px]";
  return (
    <main className="mx-auto max-w-[900px] px-5 py-10">
      <div className="mb-6 flex items-center gap-2.5"><span className="eyebrow">Beauty Reach Admin</span><hr className="h-px flex-1 border-0 bg-line" /></div>
      <h1 className="font-serif text-2xl font-bold text-ink">美容師</h1>
      <p className="mt-2 text-[12.5px] leading-relaxed text-sub">登録したアカウントを基準に表示します（登録途中・プロフィール未作成も含む）。名前・メールで検索できます。<b>居住地</b>と<b>勤務希望地</b>は別の項目です。勤務希望地は自由記述で、書かれた都道府県名だけを絞り込みに使います。</p>
      <form method="get" className="mt-5 grid gap-3 rounded-2xl border border-line bg-surface p-4">
        <input name="q" defaultValue={q} placeholder="名前・メール" maxLength={100} className={sel} aria-label="検索" />
        <AreaFilterFields label="居住地" prefKey="rpref" regionKey="rregion" region={residence.region} prefecture={residence.prefecture} />
        <AreaFilterFields label="勤務希望地" prefKey="dpref" regionKey="dregion" region={desired.region} prefecture={desired.prefecture} allowUnset={false} />
        <select name="vis" defaultValue={visibility} className={sel} aria-label="公開状態"><option value="">公開状態（すべて）</option><option value="PUBLIC">公開</option><option value="PRIVATE">非公開</option></select>
        <select name="state" defaultValue={state} className={sel} aria-label="登録状態"><option value="">登録状態（すべて）</option>{Object.entries(STATE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <button className="min-h-[44px] rounded-full bg-ink px-5 text-[13px] font-semibold text-white">検索する</button>
      </form>
      {!res.ok ? <ErrorBox reason={res.reason} /> : res.data.rows.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-line bg-surface p-8 text-center text-[13px] text-sub">条件に合う美容師はいません。</p>
      ) : (
        <>
          <ul className="mt-6 space-y-3">
            {res.data.rows.map((s) => <StylistCard key={s.user_id} s={s} />)}
          </ul>
          <Pager total={res.data.total} page={page} basePath="/admin/stylists" params={params} />
        </>
      )}
    </main>
  );
}
