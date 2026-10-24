import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAdminLegalDocuments } from "@/lib/legal/actions";
import { getLegalOperatorInfo, isLegalOperatorInfoComplete } from "@/lib/legal/config";
import { LEGAL_DOCUMENTS } from "@/lib/legal/documents";
import { buildLegalSnapshot, parseLegalSnapshot, sameBody } from "@/lib/legal/snapshot";
import { jstToday } from "@/lib/billing/format";
import { LegalPublishButton } from "@/components/admin/legal-publish-button";

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric" });
}

/**
 * 規約・プライバシーポリシーの公開と同意状況（/admin/legal）。platform adminのみ。
 * 公開した各版について、種別・版・施行日・ハッシュ・公開時の本文（運営者情報・施行日を含む）を確認できる。
 * 公開済みの版は変更・削除できない。
 */
export default async function AdminLegalPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/legal");
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (!isAdmin) redirect("/mypage");

  const published = await getAdminLegalDocuments();
  const operator = getLegalOperatorInfo();
  const operatorComplete = isLegalOperatorInfoComplete(operator);
  // 本文の比較用（運営者情報・施行日は無関係なので、ダミーを入れて本文だけを比べる）。
  const dummyOp = { name: "-", address: "-", contactEmail: "-", effectiveDate: null };

  return (
    <main className="mx-auto max-w-[760px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5"><span className="eyebrow">Beauty Reach Admin</span><hr className="h-px flex-1 border-0 bg-line" /></div>
      <h1 className="font-serif text-2xl font-bold text-ink">利用規約・プライバシーポリシー</h1>
      <p className="mt-2 text-[12.5px] leading-relaxed text-sub">
        公開した版にだけ、ユーザーの同意を求めます。公開時に、運営者情報・施行日を含む完成した本文がそのまま保存され、あとから変更・削除できません。
        同意の記録（誰が・どの版に・いつ）も変更・削除できません。本文を変更したときは、版を上げてから公開してください。
      </p>

      {!operatorComplete && (
        <p className="mt-4 rounded-lg bg-[#B8860B]/15 px-3 py-2 text-[12px] leading-relaxed text-[#7A5A06]">
          運営者の名称・所在地・問い合わせ先の設定が未完了のため、公開できません。環境設定で入力してください。
          また、本文は法的な確認を経てから公開してください。
        </p>
      )}
      {published === null && (
        <p className="mt-4 rounded-lg bg-[#C24545]/10 px-3 py-2 text-[12px] text-[#8A2E2E]">公開状況を取得できませんでした。画面を更新してください。</p>
      )}

      <div className="mt-6 space-y-5">
        {(["terms", "privacy"] as const).map((type) => {
          const doc = LEGAL_DOCUMENTS[type];
          const rows = (published ?? []).filter((p) => p.document_type === type);
          const current = rows.find((r) => r.is_current) ?? null;
          const same = rows.find((r) => r.version === doc.version);
          const codeBody = buildLegalSnapshot(doc, dummyOp, "2000-01-01");
          const sameSnap = same ? parseLegalSnapshot(same.content_snapshot) : null;
          const mismatch = same !== undefined && codeBody !== null && (sameSnap === null || !sameBody(sameSnap, codeBody));
          return (
            <section key={type} className="rounded-2xl border border-line bg-surface p-5">
              <h2 className="font-serif text-[16px] font-bold text-ink">{doc.title}</h2>
              <p className="mt-2 text-[12px] text-charcoal">
                現在のコードの本文：版 {doc.version}　／　
                {current ? <>ユーザーに適用中：版 {current.version}（施行 {fmt(current.effective_at)}・同意 {current.accepted_count}人）</> : "公開された版はまだありません（同意は求めていません）"}
              </p>
              {mismatch && (
                <p className="mt-2 rounded-lg bg-[#C24545]/10 px-3 py-2 text-[12px] text-[#8A2E2E]">
                  コードの本文が、公開済みの版 {doc.version} と異なっています。版を上げてから公開してください（公開済みの版は変更できません）。
                </p>
              )}
              {!same && <LegalPublishButton type={type} defaultDate={jstToday()} disabled={!operatorComplete} />}
              {same && !mismatch && <p className="mt-2 text-[12px] text-sub">この版は公開済みです。</p>}

              {rows.length > 0 && (
                <div className="mt-4 space-y-2 border-t border-line pt-3">
                  <p className="text-[11px] font-semibold text-sub">公開した版（新しい順）</p>
                  {rows.map((r) => {
                    const snap = parseLegalSnapshot(r.content_snapshot);
                    return (
                      <details key={r.document_id} className="rounded-xl bg-surface2 px-3 py-2 text-[11.5px] text-charcoal">
                        <summary className="cursor-pointer">
                          版 {r.version}　施行 {fmt(r.effective_at)}　同意 {r.accepted_count}人{r.is_current ? "　（適用中）" : ""}
                        </summary>
                        <p className="mt-2 break-all text-[10.5px] text-sub">本文のハッシュ（SHA-256）：{r.content_hash}</p>
                        <p className="text-[10.5px] text-sub">公開日：{fmt(r.published_at)}</p>
                        {snap ? (
                          <div className="mt-2 space-y-2 border-t border-line pt-2">
                            <p>運営者：{snap.operator.name} ／ {snap.operator.address} ／ {snap.operator.contact}（施行日 {snap.effective_date}）</p>
                            <p className="leading-relaxed">{snap.lead}</p>
                            {snap.sections.map((s) => (
                              <div key={s.heading}>
                                <p className="font-bold">{s.heading}</p>
                                {s.paragraphs.map((p) => <p key={p} className="leading-relaxed">{p}</p>)}
                                {s.items.length > 0 && <ul className="list-disc pl-5">{s.items.map((i) => <li key={i}>{i}</li>)}</ul>}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-2 whitespace-pre-wrap break-all border-t border-line pt-2">{r.content_snapshot}</p>
                        )}
                      </details>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}
