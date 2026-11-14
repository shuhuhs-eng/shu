import Link from "next/link";
import { requireAdminPage } from "@/lib/admin/guard";
import { listSalonRegistrants, parsePage } from "@/lib/admin/directory";
import { ErrorBox, Pager } from "@/components/admin/directory-ui";

type SP = Promise<Record<string, string | string[] | undefined>>;

/** 運営: 会社がまだ作られていないサロン登録者（登録途中を含む）。読み取り専用。 */
export default async function AdminSalonRegistrantsPage({ searchParams }: { searchParams: SP }) {
  const { supabase } = await requireAdminPage("/admin/salons/unassigned");
  const page = parsePage(await searchParams);
  const res = await listSalonRegistrants(supabase, page);
  const fmt = (s: string) => new Date(s).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  return (
    <main className="mx-auto max-w-[900px] px-5 py-10">
      <Link href="/admin/salons" className="text-[13px] font-semibold text-sub underline">← 会社・店舗</Link>
      <h1 className="mt-4 font-serif text-2xl font-bold text-ink">会社未作成の登録者</h1>
      <p className="mt-2 text-[12.5px] leading-relaxed text-sub">サロンとして登録したが、会社・店舗の所属がまだ無いアカウントです（登録途中を含む）。会社が作られると「会社・店舗」の一覧に移ります。</p>
      <p className="mt-2 rounded-xl bg-surface2 p-3 text-[11.5px] leading-relaxed text-sub">見えない範囲: アカウントの役割が未設定のまま登録途中のものは、役割で区別できないため美容師側の一覧に出ることがあります。</p>
      {!res.ok ? <ErrorBox reason={res.reason} /> : res.data.rows.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-line bg-surface p-8 text-center text-[13px] text-sub">該当するアカウントはありません。</p>
      ) : (
        <>
          <ul className="mt-6 space-y-3">
            {res.data.rows.map((r) => (
              <li key={r.user_id} className="rounded-2xl border border-line bg-surface p-4 text-[12.5px]">
                <p className="break-words font-semibold text-ink">{r.name ?? "（名前未設定）"}</p>
                <p className="break-all text-sub">{r.email}</p>
                <p className="mt-1 text-sub">メール確認: {r.email_confirmed ? "済み" : "未確認"}／ステップ {r.onboarding_step}／サロンプロフィール: {r.has_salon_profile ? "あり" : "なし"}／登録 {fmt(r.created_at)}</p>
              </li>
            ))}
          </ul>
          <Pager total={res.data.total} page={page} basePath="/admin/salons/unassigned" params={{}} />
        </>
      )}
    </main>
  );
}
