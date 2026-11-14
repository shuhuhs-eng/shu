import { JOB_CHANGE_INTENT_LABELS } from "@/lib/validation/profile-options";
import type { JobChangeIntent } from "@/types/database";

export type StylistPublicViewData = {
  publicName: string | null;
  prefecture: string | null;
  currentPosition: string | null;
  experienceYears: number | null;
  desiredWorkLocation: string | null;
  jobChangeIntent: JobChangeIntent | null;
  specialties: string[];
  bio: string | null;
  /** 年齢（満年齢）。DB側で生年月日から計算して返す設計のときだけ渡す。生年月日そのものは表示しない。値が無ければ行ごと出さない（推測しない）。 */
  age?: number | null;
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-1.5 text-[13px]">
      <dt className="w-24 shrink-0 text-sub">{label}</dt>
      <dd className="min-w-0 flex-1 text-charcoal">{children}</dd>
    </div>
  );
}

/**
 * サロン側に表示される美容師プロフィール（スカウト対象一覧の get_public_stylists_for_scout が返す項目だけ）。
 * サロン画面のカードと、本人の「サロン向けプレビュー」で同じ部品を使い、見え方を一致させる。
 * 基本情報・経験・希望する働き方・自己紹介に整理し、長文を読まなくても人物像が分かるようにしている。
 */
export function StylistPublicView({ data }: { data: StylistPublicViewData }) {
  const bio = data.bio?.trim() ?? "";
  const lead = [data.prefecture, data.currentPosition].filter(Boolean).join(" / ");
  return (
    <div>
      <h3 className="font-serif text-[18px] font-bold text-ink">{data.publicName?.trim() || "美容師"}</h3>
      <p className="mt-0.5 text-[12.5px] text-sub">{lead || "プロフィール情報未設定"}</p>

      {data.specialties.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="得意技術">
          {data.specialties.map((s) => (
            <li key={s} className="rounded-full border border-line bg-surface2 px-2.5 py-1 text-[11.5px] text-charcoal">{s}</li>
          ))}
        </ul>
      )}

      <div className="mt-3 divide-y divide-line rounded-xl border border-line bg-surface px-4">
        <section aria-label="基本情報" className="py-2">
          <p className="mb-0.5 text-[11px] font-bold tracking-wide text-sub">基本情報</p>
          <dl>
            <Row label="都道府県">{data.prefecture || "未設定"}</Row>
            {data.age != null && <Row label="年齢">{data.age}歳</Row>}
          </dl>
        </section>
        <section aria-label="経験" className="py-2">
          <p className="mb-0.5 text-[11px] font-bold tracking-wide text-sub">経験</p>
          <dl>
            <Row label="経験年数">{data.experienceYears != null ? `${data.experienceYears}年` : "未設定"}</Row>
            <Row label="現在の役職">{data.currentPosition || "未設定"}</Row>
          </dl>
        </section>
        <section aria-label="希望する働き方" className="py-2">
          <p className="mb-0.5 text-[11px] font-bold tracking-wide text-sub">希望する働き方</p>
          <dl>
            <Row label="希望勤務地">{data.desiredWorkLocation || "未設定"}</Row>
            <Row label="転職への意欲">{data.jobChangeIntent ? JOB_CHANGE_INTENT_LABELS[data.jobChangeIntent] : "未設定"}</Row>
          </dl>
        </section>
      </div>

      {bio && (
        <section aria-label="自己紹介" className="mt-3">
          <p className="mb-1 text-[11px] font-bold tracking-wide text-sub">自己紹介</p>
          {bio.length > 120 ? (
            <details>
              <summary className="cursor-pointer text-[12.5px] leading-relaxed text-charcoal">{bio.slice(0, 110)}…<span className="ml-1 inline-flex min-h-[44px] items-center text-sub underline">全文を読む</span></summary>
              <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-charcoal">{bio}</p>
            </details>
          ) : (
            <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-charcoal">{bio}</p>
          )}
        </section>
      )}
    </div>
  );
}
