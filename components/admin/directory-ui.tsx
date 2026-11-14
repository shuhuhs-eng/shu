import Link from "next/link";
import { displayPrefecture } from "@/lib/admin/regions";
import { PAGE_SIZE, type Person, type OrgRow, type StylistRow, type RegistrationState } from "@/lib/admin/directory";

export const ROLE_LABEL: Record<string, string> = {
  company_owner: "会社オーナー", company_admin: "会社管理者", recruiting_admin: "採用管理者", area_manager: "エリア担当",
  store_manager: "店長", recruiter: "採用担当", viewer: "閲覧のみ",
};
export const VIS_LABEL: Record<string, string> = { PUBLIC: "公開", PRIVATE: "非公開" };
export const STATE_LABEL: Record<RegistrationState, string> = { completed: "登録完了", in_progress: "登録途中", no_profile: "プロフィール未作成" };
export const USAGE_LABEL: Record<string, string> = { active: "利用中", inactive: "未利用" };

export function ErrorBox({ reason }: { reason: "forbidden" | "error" | "not_found" }) {
  const msg = reason === "not_found" ? "対象が見つかりませんでした。" : reason === "forbidden" ? "この情報を見る権限がありません。" : "情報を取得できませんでした。時間をおいて再度お試しください。（0件という意味ではありません）";
  return <p className="mt-6 rounded-lg bg-[#C24545]/10 px-3 py-2 text-[12px] text-[#8A2E2E]">{msg}</p>;
}

export function Pager({ total, page, basePath, params }: { total: number; page: number; basePath: string; params: Record<string, string> }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) => `${basePath}?${new URLSearchParams({ ...params, page: String(p) }).toString()}`;
  return (
    <nav className="mt-6 flex items-center justify-between text-[12.5px]" aria-label="ページ送り">
      {page > 1 ? <Link href={href(page - 1)} className="inline-flex min-h-[44px] items-center rounded-full border border-line px-4 font-semibold">前へ</Link> : <span />}
      <span className="text-sub">{total}件中 {page} / {pages} ページ</span>
      {page < pages ? <Link href={href(page + 1)} className="inline-flex min-h-[44px] items-center rounded-full border border-line px-4 font-semibold">次へ</Link> : <span />}
    </nav>
  );
}

export function PersonLine({ p }: { p: Person }) {
  return (
    <li className="break-words text-[12.5px] text-charcoal">
      <span className="font-semibold">{p.name ?? "（名前未設定）"}</span>
      <span className="ml-1 text-sub">{ROLE_LABEL[p.role] ?? p.role}</span>
      <br /><span className="break-all text-sub">{p.email}</span>
    </li>
  );
}

/** 所在地の表示。未設定は推測せず「未設定」。 */
export function Where({ prefecture, city }: { prefecture: string | null; city?: string | null }) {
  const p = displayPrefecture(prefecture);
  return <span className={p === "未設定" ? "text-sub" : ""}>{p}{p !== "未設定" && city ? ` ${city}` : ""}</span>;
}

export function OrgCard({ o, filtered = false }: { o: OrgRow; filtered?: boolean }) {
  return (
    <li className="rounded-2xl border border-line bg-surface p-4">
      <Link href={`/admin/salons/${o.id}`} className="block min-h-[44px] break-words font-serif text-[16px] font-bold text-ink underline">{o.name}</Link>
      <p className="mt-1 text-[11.5px] text-sub">店舗 {o.store_count}／登録担当者 {o.members.length}{filtered ? `／条件に一致した店舗 ${o.matched_store_count}` : ""}</p>
      <ul className="mt-2 space-y-1">
        {o.stores.map((s) => (
          <li key={s.id} className={`break-words text-[12.5px] text-charcoal ${filtered && s.matches_filter ? "rounded-lg bg-[#2F7D5B]/10 px-2 py-1" : ""}`}>
            {filtered && s.matches_filter ? <b className="mr-1 text-[11px] text-[#1F5A40]">条件に一致</b> : null}
            {s.matches_query ? <b className="mr-1 text-[11px] text-[#1F5A40]">検索に一致</b> : null}
            {s.name}　<Where prefecture={s.prefecture} city={s.city} />
            <span className="ml-1 text-[11px] text-sub">{s.visibility ? VIS_LABEL[s.visibility] ?? s.visibility : "公開設定なし"}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 break-all text-[11.5px] text-sub">{o.members.map((m) => `${m.name ?? m.email}（${ROLE_LABEL[m.role] ?? m.role}）`).join("、")}</p>
    </li>
  );
}

export function StylistCard({ s }: { s: StylistRow }) {
  return (
    <li className="rounded-2xl border border-line bg-surface p-4">
      <Link href={`/admin/stylists/${s.user_id}`} className="block min-h-[44px] break-words font-serif text-[16px] font-bold text-ink underline">{s.public_name ?? "（公開名未設定）"}</Link>
      <p className="break-all text-[11.5px] text-sub">{s.full_name ? `${s.full_name}／` : ""}{s.email}</p>
      <p className="mt-1 text-[11.5px]"><span className={`rounded-full px-2 py-0.5 font-semibold ${s.registration_state === "completed" ? "bg-[#2F7D5B]/10 text-[#1F5A40]" : "bg-[#B7791F]/10 text-[#7A4F0F]"}`}>{STATE_LABEL[s.registration_state] ?? s.registration_state}</span>{s.registration_state !== "completed" ? <span className="ml-1 text-sub">（ステップ {s.onboarding_step}）</span> : null}</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
        <dt className="text-sub">居住地</dt><dd><Where prefecture={s.residence_prefecture} /></dd>
        <dt className="text-sub">勤務希望地</dt><dd className="break-words">{s.desired_work_location ?? <span className="text-sub">未設定</span>}</dd>
        <dt className="text-sub">診断</dt><dd>{s.diagnosis_type ?? <span className="text-sub">未診断</span>}</dd>
        <dt className="text-sub">公開</dt><dd>{VIS_LABEL[s.visibility] ?? s.visibility}</dd>
      </dl>
    </li>
  );
}
