import Link from "next/link";

export type LegalView = {
  title: string;
  version: string;
  /** 施行日（YYYY-MM-DD）。未定なら null（「準備中」と表示）。 */
  effectiveDate: string | null;
  operator: { name: string | null; address: string | null; contact: string | null };
  lead: string;
  sections: Array<{ heading: string; paragraphs: string[]; items?: string[] }>;
};

function jpDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${y}年${m}月${d}日`;
}

/** 規約・プライバシーポリシー共通の表示。公開済みの版はDBの保存本文、未公開の間は草案を表示する。 */
export function LegalPage({ view, other }: { view: LegalView; other: { href: string; label: string } }) {
  return (
    <main className="mx-auto max-w-[720px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5"><span className="eyebrow">Beauty Reach</span><hr className="h-px flex-1 border-0 bg-line" /></div>
      <Link href="/" className="text-[13px] font-semibold text-sub underline">← トップへ戻る</Link>
      <h1 className="mt-4 font-serif text-2xl font-bold text-ink">{view.title}</h1>
      <p className="mt-2 text-[12px] text-sub">
        施行日：{view.effectiveDate ? jpDate(view.effectiveDate) : "準備中"}　／　版：{view.version}
      </p>
      <p className="mt-5 text-[13.5px] leading-[1.9] text-charcoal">{view.lead}</p>

      <div className="mt-8 space-y-7">
        {view.sections.map((s) => (
          <section key={s.heading}>
            <h2 className="font-serif text-[16px] font-bold text-ink">{s.heading}</h2>
            {s.paragraphs.map((p) => (
              <p key={p} className="mt-2 text-[13.5px] leading-[1.9] text-charcoal">{p}</p>
            ))}
            {s.items && s.items.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-[13.5px] leading-[1.8] text-charcoal">
                {s.items.map((i) => <li key={i}>{i}</li>)}
              </ul>
            )}
          </section>
        ))}
      </div>

      <section className="mt-10 rounded-2xl border border-line bg-surface p-5">
        <h2 className="font-serif text-[15px] font-bold text-ink">運営者・お問い合わせ</h2>
        <dl className="mt-3 space-y-2 text-[13px] text-charcoal">
          <div><dt className="text-[11px] text-sub">運営者</dt><dd>{view.operator.name ?? "準備中"}</dd></div>
          <div><dt className="text-[11px] text-sub">所在地</dt><dd>{view.operator.address ?? "準備中"}</dd></div>
          <div><dt className="text-[11px] text-sub">お問い合わせ</dt><dd>{view.operator.contact ?? "準備中"}</dd></div>
        </dl>
      </section>

      <p className="mt-8 text-[13px]"><Link href={other.href} className="font-semibold text-ink underline">{other.label}</Link></p>
    </main>
  );
}
