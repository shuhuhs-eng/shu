import Link from "next/link";
import { requireAdminPage } from "@/lib/admin/guard";
import { getStylist } from "@/lib/admin/directory";
import { ErrorBox, Where, VIS_LABEL, STATE_LABEL } from "@/components/admin/directory-ui";

/** 運営: 美容師詳細（読み取り専用）。診断は「タイプ名と日時」のみ。回答・結果の編集機能は無い。 */
export default async function AdminStylistDetailPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const { supabase } = await requireAdminPage(`/admin/stylists/${userId}`);
  const res = await getStylist(supabase, userId);
  const fmt = (s: string) => new Date(s).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  return (
    <main className="mx-auto max-w-[900px] px-5 py-10">
      <Link href="/admin/stylists" className="text-[13px] font-semibold text-sub underline">← 美容師</Link>
      {!res.ok ? <ErrorBox reason={res.reason} /> : (() => {
        const d = res.data;
        const row = (k: string, v: React.ReactNode) => (<><dt className="text-sub">{k}</dt><dd className="break-words">{v}</dd></>);
        return (
          <>
            <h1 className="mt-4 break-words font-serif text-2xl font-bold text-ink">{d.public_name ?? "（公開名未設定）"}</h1>
            <p className="mt-3"><Link href={`/admin/messages/new?audience=stylist&recipient=${d.user_id}`} className="inline-flex min-h-[44px] items-center rounded-full bg-ink px-4 text-[12.5px] font-semibold text-white">この美容師に連絡する</Link></p>
            <p className="break-all text-[12px] text-sub">{d.full_name ? `${d.full_name}／` : ""}{d.email}</p>
            <h2 className="mt-6 font-serif text-lg font-bold text-ink">エリア</h2>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-2xl border border-line bg-surface p-4 text-[12.5px]">
              {row("居住地", <Where prefecture={d.residence_prefecture} />)}
              {row("勤務希望地", d.desired_work_location ?? <span className="text-sub">未設定</span>)}
            </dl>
            <h2 className="mt-6 font-serif text-lg font-bold text-ink">プロフィール</h2>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-2xl border border-line bg-surface p-4 text-[12.5px]">
              {row("登録状態", `${STATE_LABEL[d.registration_state] ?? d.registration_state}（ステップ ${d.onboarding_step}）`)}
              {row("公開状態", d.visibility ? VIS_LABEL[d.visibility] ?? d.visibility : "未設定")}
              {row("経験年数", d.experience_years ?? "未設定")}
              {row("現在の役職", d.current_position ?? "未設定")}
              {row("得意分野", d.specialties?.length ? d.specialties?.join("、") : "未設定")}
              {row("転職意向", d.job_change_intent ?? "未設定")}
              {row("登録日", fmt(d.created_at))}
            </dl>
            <h2 className="mt-6 font-serif text-lg font-bold text-ink">診断・資料</h2>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-2xl border border-line bg-surface p-4 text-[12.5px]">
              {row("診断タイプ", d.diagnosis ? `${d.diagnosis.type_name}（${fmt(d.diagnosis.diagnosed_at)}）` : "未診断")}
              {row("希望条件の回答", d.preference_status ?? "未回答")}
              {row("実績資料", Object.keys(d.evidence).length ? Object.entries(d.evidence).map(([k, n]) => `${k}: ${n}`).join("、") : "なし")}
            </dl>
            <p className="mt-2 text-[11.5px] text-sub">診断の回答・結果は、この画面では編集できません。実績資料の確認は <Link href="/admin/evidence" className="underline">実績資料</Link> から。</p>
            <h2 className="mt-6 font-serif text-lg font-bold text-ink">採用の進行</h2>
            <ul className="mt-2 space-y-2">
              {d.hiring_processes.length === 0 ? <li className="rounded-2xl border border-line bg-surface p-4 text-[12.5px] text-sub">ありません。</li> : d.hiring_processes.map((h) => (
                <li key={h.id} className="rounded-2xl border border-line bg-surface p-4 text-[12.5px]"><span className="break-words font-semibold">{h.organization_name}／{h.store_name}</span><br /><span className="text-sub">{h.status}・{h.source}・{fmt(h.updated_at)}</span></li>
              ))}
            </ul>
            <p className="mt-8 rounded-xl bg-surface2 p-3 text-[11.5px] leading-relaxed text-sub">サロンへの公開可否とは別に、運営が業務に必要な範囲で確認する画面です。この内容をサロン側へ転送・表示する機能はありません。</p>
          </>
        );
      })()}
    </main>
  );
}
