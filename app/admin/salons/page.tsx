import Link from "next/link";
import { requireAdminPage } from "@/lib/admin/guard";
import { listOrganizations, parseArea, parsePage, parseQ } from "@/lib/admin/directory";
import { AreaFilterFields } from "@/components/admin/area-filter";
import { ErrorBox, Pager, OrgCard } from "@/components/admin/directory-ui";

type SP = Promise<Record<string, string | string[] | undefined>>;

/** 運営: 会社・店舗の一覧（読み取り専用）。会社の所在地は保存項目が無いため、店舗の所在地だけを店舗ごとに表示する。 */
export default async function AdminSalonsPage({ searchParams }: { searchParams: SP }) {
  const { supabase } = await requireAdminPage("/admin/salons");
  const sp = await searchParams;
  const q = parseQ(sp), area = parseArea(sp), page = parsePage(sp);
  const one = (k: string) => { const v = sp[k]; return (Array.isArray(v) ? v[0] : v) ?? ""; };
  const visibility = one("vis"), usage = one("usage");
  const res = await listOrganizations(supabase, { q, area, visibility, usage, page });
  const params: Record<string, string> = {};
  if (q) params.q = q;
  if (area.prefecture) params.pref = area.prefecture;
  if (area.region) params.region = area.region;
  if (visibility) params.vis = visibility;
  if (usage) params.usage = usage;
  const sel = "min-h-[44px] w-full rounded-xl border border-line bg-surface px-3 text-[13px]";

  return (
    <main className="mx-auto max-w-[900px] px-5 py-10">
      <div className="mb-6 flex items-center gap-2.5"><span className="eyebrow">Beauty Reach Admin</span><hr className="h-px flex-1 border-0 bg-line" /></div>
      <h1 className="font-serif text-2xl font-bold text-ink">会社・店舗</h1>
      <p className="mt-2 text-[12.5px] leading-relaxed text-sub">会社名・店舗名・担当者名・登録メールアドレスで検索できます。所在地は<b>店舗ごと</b>の値です（会社そのものの所在地は未登録のため表示しません）。</p>

      <form method="get" className="mt-5 grid gap-3 rounded-2xl border border-line bg-surface p-4">
        <input name="q" defaultValue={q} placeholder="会社・店舗・担当者・メール" maxLength={100} className={sel} aria-label="検索" />
        <AreaFilterFields label="店舗の所在地" region={area.region} prefecture={area.prefecture} />
        <div className="grid grid-cols-2 gap-2">
          <select name="vis" defaultValue={visibility} className={sel} aria-label="公開状態"><option value="">公開状態（すべて）</option><option value="PUBLIC">公開</option><option value="PRIVATE">非公開</option></select>
          <select name="usage" defaultValue={usage} className={sel} aria-label="利用状態"><option value="">利用状態（すべて）</option><option value="active">利用中</option><option value="inactive">未利用</option></select>
        </div>
        <button className="min-h-[44px] rounded-full bg-ink px-5 text-[13px] font-semibold text-white">検索する</button>
      </form>

      {!res.ok ? <ErrorBox reason={res.reason} /> : res.data.rows.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-line bg-surface p-8 text-center text-[13px] text-sub">条件に合う会社はありません。</p>
      ) : (
        <>
          <ul className="mt-6 space-y-3">
            {res.data.rows.map((o) => <OrgCard key={o.id} o={o} />)}
          </ul>
          <Pager total={res.data.total} page={page} basePath="/admin/salons" params={params} />
        </>
      )}
    </main>
  );
}
