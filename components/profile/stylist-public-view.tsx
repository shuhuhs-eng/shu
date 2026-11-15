import { EMPLOYMENT_TYPE_LABELS, JOB_CHANGE_INTENT_LABELS, VALUE_PRIORITY_OPTIONS } from "@/lib/validation/profile-options";
import { formatExperienceValue } from "@/lib/profile/experience-years";
import type { EmploymentType, JobChangeIntent } from "@/types/database";

export type StylistPublicViewData = {
  publicName: string | null;
  prefecture: string | null;
  currentPosition: string | null;
  experienceYears: number | null;
  desiredWorkLocation: string | null;
  jobChangeIntent: JobChangeIntent | null;
  specialties: string[];
  bio: string | null;
  /**
   * 0070（画像・雇用形態・Instagram・大切にしたいこと・年齢）に対応したデータか。
   * falseのとき（DB未対応）は、従来の項目だけを表示する。サロン画面とプレビューで同じ値の決め方をする。
   */
  extended?: boolean;
  /** 画像の表示用URL（署名付き）。画像が無い／取得できないときはnull。 */
  avatarUrl?: string | null;
  employmentType?: EmploymentType | null;
  /** Instagramのアカウント名（@なし）。 */
  instagramHandle?: string | null;
  /** サロン選びで大切にしたいこと（コード。配列の順が優先順位）。 */
  valuePriorities?: string[] | null;
  /** 満年齢。未登録はnull（年代などから推測しない）。生年月日そのものは扱わない。 */
  /** 年齢の表記（例: 「45歳」「40代」）。nullは未登録（サロン向けには出ない状態。推測しない）。 */
  ageLabel?: string | null;
};

const VALUE_LABEL = new Map(VALUE_PRIORITY_OPTIONS.map((o) => [o.code, o.label]));

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
  const ext = data.extended === true;
  const bio = data.bio?.trim() ?? "";
  const values = (data.valuePriorities ?? []).filter((c) => VALUE_LABEL.has(c));
  const lead = [data.prefecture, data.currentPosition].filter(Boolean).join(" / ");
  return (
    <div>
      <div className="flex items-center gap-3">
        {ext && (
          data.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.avatarUrl} alt={`${data.publicName?.trim() || "美容師"}のプロフィール画像`} className="h-14 w-14 shrink-0 rounded-full border border-line object-cover" />
          ) : (
            <span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-line bg-surface2 font-serif text-[20px] font-bold text-sub">
              {(data.publicName?.trim() || "美")[0]}
            </span>
          )
        )}
        <div className="min-w-0">
          <h3 className="font-serif text-[18px] font-bold text-ink">{data.publicName?.trim() || "美容師"}</h3>
          <p className="mt-0.5 text-[12.5px] text-sub">{lead || "プロフィール情報未設定"}</p>
        </div>
      </div>

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
            {ext && <Row label="年齢">{data.ageLabel ?? "未登録"}</Row>}
            {ext && data.instagramHandle && (
              <Row label="Instagram">
                <a href={`https://www.instagram.com/${encodeURIComponent(data.instagramHandle)}/`} target="_blank" rel="noopener noreferrer" className="break-all underline">
                  @{data.instagramHandle}
                </a>
              </Row>
            )}
          </dl>
        </section>
        <section aria-label="経験" className="py-2">
          <p className="mb-0.5 text-[11px] font-bold tracking-wide text-sub">経験</p>
          <dl>
            <Row label="経験年数">{formatExperienceValue(data.experienceYears)}</Row>
            <Row label="現在の役職">{data.currentPosition || "未設定"}</Row>
            {ext && <Row label="雇用形態">{data.employmentType ? EMPLOYMENT_TYPE_LABELS[data.employmentType] : "未設定"}</Row>}
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

      {ext && values.length > 0 && (
        <section aria-label="サロン選びで大切にしたいこと" className="mt-3">
          <p className="mb-1 text-[11px] font-bold tracking-wide text-sub">サロン選びで大切にしたいこと</p>
          <ol className="flex flex-wrap gap-1.5">
            {values.map((c, i) => (
              <li key={c} className="rounded-full border border-line bg-surface2 px-2.5 py-1 text-[11.5px] text-charcoal">
                <span className="mr-1 font-bold text-ink">{i + 1}</span>{VALUE_LABEL.get(c)}
              </li>
            ))}
          </ol>
        </section>
      )}

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
