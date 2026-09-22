import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasCompletedRole } from "@/lib/auth/user-roles";
import {
  calculateStylistSalonMatch,
  getPublicSalonCultureDetail,
  getPublicSalonLinks,
  getPublicSalonPhotos,
  getPublicSalonLogoSignedUrl,
} from "@/lib/matching/actions";
import { deriveSalonTypes, SALON_TYPE_CONTENT } from "@/lib/salon-culture/salon-culture-types";
import { MATCH_AXIS_LABELS } from "@/lib/matching/types";
import { SALON_LINK_TYPE_LABELS } from "@/lib/validation/salon-links";
import { FavoriteSalonButton } from "@/components/stylist-salons/favorite-salon-button";
import { InterestSalonButton } from "@/components/stylist-salons/interest-salon-button";

type Props = {
  params: Promise<{ salonUserId: string }>;
};

/**
 * 美容師向けサロン詳細画面。/stylist/salons のカードから遷移してくる。
 *
 * ★role guard: middleware（STYLIST_ONLY_PREFIXESに/stylist/salonsのprefixで
 * 動的ルートも含めて保護済み）に加えて、このページ自体でもstylist roleの
 * 完了を確認する多重防御（既存の一覧ページ・/stylist/mypage等と同じ
 * パターン）。
 *
 * ★①サロン基本情報はsalon_profiles（既存のsalon_profiles_select_public
 * ポリシー、0011で追加済み・無変更）から取得。
 * ★②相性は既存calculateStylistSalonMatch()（無変更）をそのまま呼ぶ。
 * ★③サロンタイプは、get_public_salon_culture_detail RPC（0013、新設）が
 * 返すculture_axesを、このServer Component内で既存deriveSalonTypes()
 * （無変更）に渡してmain/subタイプ名を算出する。culture_axes自体は
 * この関数スコープ内でのみ扱い、Client Componentへpropsとして渡さない
 * （このページ自体もServer Componentであり、JSXには算出済みの
 * タイプ名・アイコンのみを埋め込むため、ブラウザへ送信される最終的な
 * HTML/JSペイロードに12軸の生数値は一切含まれない）。
 * ★④AI紹介はget_public_salon_culture_detailが返す現行AI（essence/
 * explanation/advice/growth）をそのまま表示するだけで、再生成は行わない。
 */
export default async function StylistSalonDetailPage({ params }: Props) {
  const { salonUserId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=/stylist/salons/${salonUserId}`);
  }

  if (!(await hasCompletedRole(supabase, user.id, "stylist"))) {
    redirect("/onboarding");
  }

  // ①サロン基本情報。既存のsalon_profiles_select_publicポリシー
  // （visibility='PUBLIC'）により、他サロンでもPUBLICなら取得できる。
  // 一覧ページと同じく、念のため.eq("visibility", "PUBLIC")でも明示的に
  // 絞り込む（RLSとクエリ条件の二重防御）。
  const { data: salon } = await supabase
    .from("salon_profiles")
    .select("*")
    .eq("user_id", salonUserId)
    .eq("visibility", "PUBLIC")
    .maybeSingle();

  if (!salon) {
    notFound();
  }

  let employeeSizeLabel: string | null = null;
  if (salon.employee_size_code) {
    const { data: sizeRow } = await supabase
      .from("employee_size_master")
      .select("*")
      .eq("code", salon.employee_size_code)
      .maybeSingle();
    employeeSizeLabel = sizeRow?.label ?? null;
  }

  // ②相性。既存のcalculateStylistSalonMatch()をそのまま呼ぶ（計算式は無変更）。
  const match = await calculateStylistSalonMatch(salonUserId);

  // ③④サロンCulture詳細・AI。get_public_salon_culture_detail（0013、新設）。
  const cultureDetail = await getPublicSalonCultureDetail(salonUserId);

  // ★culture_axesはこの関数スコープ内だけで使い切る。以降、この変数を
  // JSXへそのまま埋め込むことは無い（mainType/subTypeの表示用文字列のみ
  // JSXに渡す）。
  const classification =
    cultureDetail?.available === true ? deriveSalonTypes(cultureDetail.cultureAxes) : null;

  // ★サロンロゴ（既存profiles.avatar_path）。0015で追加した
  // avatars_select_public_salon_logo ポリシー経由でsigned URLを発行する
  // （avatars bucket・既存4ポリシーは無変更）。未登録ならnull。
  const logoSignedUrl = await getPublicSalonLogoSignedUrl(salonUserId);

  // ★サロン写真（既存0014 salon_photos）。0015のget_public_salon_photos
  // RPC（id/category/storage_path/sort_orderのみ）→ここでsigned URL発行。
  const salonPhotos = await getPublicSalonPhotos(salonUserId);

  // ★外部リンク（0015 salon_links）。get_public_salon_links RPC経由。
  const salonLinks = await getPublicSalonLinks(salonUserId);

  const { data: favoriteRow } = await supabase
    .from("stylist_favorite_salons")
    .select("salon_user_id")
    .eq("stylist_user_id", user.id)
    .eq("salon_user_id", salonUserId)
    .maybeSingle();
  const isFavorite = !!favoriteRow;

  const { data: interestRow } = await supabase
    .from("stylist_salon_interests")
    .select("salon_user_id")
    .eq("stylist_user_id", user.id)
    .eq("salon_user_id", salonUserId)
    .maybeSingle();
  const isInterested = !!interestRow;

  return (
    <main className="mx-auto max-w-[640px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5">
        <span className="eyebrow">Beauty Reach</span>
        <hr className="h-px flex-1 border-0 bg-line" />
      </div>

      <Link href="/stylist/salons" className="text-[13px] font-semibold text-sub underline">
        ← サロン一覧に戻る
      </Link>

      <FavoriteSalonButton
        salonUserId={salonUserId}
        isFavorite={isFavorite}
        className="mt-4"
      />

      <InterestSalonButton salonUserId={salonUserId} isInterested={isInterested} />

      {/* ①サロン基本情報。タグ間の余白をgap-1.5→gap-2へ広げ、従業員規模タグと
          得意分野タグが詰まって見えないように調整（デザインルール自体・
          カード構造は既存のまま）。 */}
      <section className="mt-5 rounded-2xl border border-line bg-surface p-6">
        <h1 className="font-serif text-2xl font-bold text-ink">{salon.salon_name ?? "サロン"}</h1>
        {(salon.prefecture || salon.city) && (
          <p className="mt-1 text-[13px] text-sub">
            {[salon.prefecture, salon.city].filter(Boolean).join(" ")}
          </p>
        )}

        {(employeeSizeLabel || (salon.target_specialties && salon.target_specialties.length > 0)) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {employeeSizeLabel && (
              <span className="rounded-full border border-line bg-surface2 px-2.5 py-1 text-[11px] text-charcoal">
                従業員数: {employeeSizeLabel}
              </span>
            )}
            {salon.target_specialties?.map((s: string) => (
              <span key={s} className="rounded-full border border-line bg-surface2 px-2.5 py-1 text-[11px] text-charcoal">
                {s}
              </span>
            ))}
          </div>
        )}

        {salon.culture_description && (
          <p className="mt-4 text-[13.5px] leading-relaxed text-charcoal">{salon.culture_description}</p>
        )}
        {!salon.culture_description && salon.bio && (
          <p className="mt-4 text-[13.5px] leading-relaxed text-charcoal">{salon.bio}</p>
        )}
      </section>

      {/* ★サロンロゴ（既存profiles.avatar_path、salon側では「サロンロゴ」として
          扱う）。未登録ならセクション自体を表示しない。既存avatar_path列・
          avatarsバケットの設定・既存4ポリシーは変更していない
          （0015で追加したavatars_select_public_salon_logoポリシー経由で
          signed URLを取得しているだけ）。 */}
      {logoSignedUrl && (
        <section className="mt-5 rounded-2xl border border-line bg-surface p-6 text-center">
          <p className="eyebrow mb-3">サロンロゴ</p>
          <div className="mx-auto h-20 w-20 overflow-hidden rounded-full border border-line bg-surface2">
            {/* eslint-disable-next-line @next/next/no-img-element -- 署名付きURLをそのまま表示するため */}
            <img src={logoSignedUrl} alt="" className="h-full w-full object-cover" />
          </div>
        </section>
      )}

      {/* ★PHOTO / サロン写真（既存0014 salon_photos。テーブル・RLSは無変更、
          0015のget_public_salon_photos経由で取得）。内装・スタッフ雰囲気を
          分けて表示。画像が1枚も無いカテゴリはセクションごと非表示。 */}
      {(salonPhotos.interior.length > 0 || salonPhotos.atmosphere.length > 0) && (
        <section className="mt-5 rounded-2xl border border-line bg-surface p-6">
          <p className="eyebrow mb-3">PHOTO</p>

          {salonPhotos.interior.length > 0 && (
            <div className="mt-2">
              <p className="text-[12px] font-medium text-charcoal">内装写真</p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {salonPhotos.interior.map((photo) => (
                  <div
                    key={photo.id}
                    className="aspect-square overflow-hidden rounded-xl border border-line bg-surface2"
                  >
                    {photo.signedUrl && (
                      // eslint-disable-next-line @next/next/no-img-element -- 署名付きURLをそのまま表示するため
                      <img src={photo.signedUrl} alt="" className="h-full w-full object-cover" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {salonPhotos.atmosphere.length > 0 && (
            <div className="mt-4">
              <p className="text-[12px] font-medium text-charcoal">スタッフ・サロンの雰囲気</p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {salonPhotos.atmosphere.map((photo) => (
                  <div
                    key={photo.id}
                    className="aspect-square overflow-hidden rounded-xl border border-line bg-surface2"
                  >
                    {photo.signedUrl && (
                      // eslint-disable-next-line @next/next/no-img-element -- 署名付きURLをそのまま表示するため
                      <img src={photo.signedUrl} alt="" className="h-full w-full object-cover" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ②サロンからの一言。cultureDetail.comment（既存RPCが既に返している
          データ、新規DB/RPCなし）が無ければセクション自体を表示しない。 */}
      {cultureDetail?.available && cultureDetail.comment && (
        <section className="mt-5 rounded-2xl border border-line bg-surface p-6">
          <p className="eyebrow mb-3">サロンからの一言</p>
          <p className="text-[13.5px] leading-relaxed text-charcoal">{cultureDetail.comment}</p>
        </section>
      )}

      {/* ③あなたらしさ × サロンらしさ。総合マッチ度をページ内で最も強調する
          要素にする（数値・計算は既存calculateStylistSalonMatch()のまま、
          表示サイズのみ拡大）。8軸はTraitScoreBars（components/diagnosis/
          trait-score-bars.tsx）の視覚パターン（h-2・rounded-full・
          bg-surface2・右側に%表示）を参考に、このページ専用のインライン
          実装として8軸用に作る（TraitScoreBars自体は6才能専用の型のため
          変更・共用していない）。良し悪しの新しい色分けは行わず、既存の
          #2E8B7F アクセント1色で統一する。 */}
      <section className="mt-5 rounded-2xl border border-line bg-surface p-6">
        <p className="eyebrow mb-3 text-center">あなたらしさ × サロンらしさ</p>

        {match === null && <p className="text-center text-[12.5px] text-sub">相性を確認できませんでした。</p>}

        {match && !match.available && (
          <p className="text-center text-[12.5px] leading-relaxed text-charcoal">
            {match.reason === "stylist_preference_incomplete"
              ? "働きたいサロン環境を回答すると相性が分かります"
              : "相性診断準備中"}
          </p>
        )}

        {match?.available && (
          <>
            <div className="text-center">
              <p className="text-[12px] text-sub">総合マッチ度</p>
              <p className="mt-1 text-[52px] font-bold leading-none" style={{ color: "#2E8B7F" }}>
                {match.overall_score}
                <span className="text-[24px] align-top">%</span>
              </p>
            </div>
            <div className="mt-6 space-y-3">
              {(Object.keys(MATCH_AXIS_LABELS) as (keyof typeof MATCH_AXIS_LABELS)[]).map((key) => (
                <div key={key} className="flex items-center gap-3">
                  <span className="w-[104px] shrink-0 text-[12px] text-sub">{MATCH_AXIS_LABELS[key]}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface2">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${match.axis_scores[key]}%`, background: "#2E8B7F" }}
                    />
                  </div>
                  <span className="w-9 shrink-0 text-right text-[12px] text-sub">{match.axis_scores[key]}%</span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* ④このサロンのタイプ。deriveSalonTypes()の算出結果（アイコン・名称・
          description の文字列のみ）を表示する。culture_axes自体はJSXに
          一切現れない。SALON_TYPE_CONTENTに無いcatchphrase/colorは
          作らず、既存フィールド（icon/name/description）のみ使用する。
          mainを大きく、subを小さく補助的に表示する。 */}
      <section className="mt-5 rounded-2xl border border-line bg-surface p-6">
        <p className="eyebrow mb-3">このサロンのタイプ</p>

        {(!cultureDetail || !cultureDetail.available) && (
          <p className="text-[12.5px] leading-relaxed text-charcoal">サロンらしさは現在準備中です</p>
        )}

        {cultureDetail?.available && classification && (
          <div>
            <div className="text-center">
              <div className="mx-auto h-44 w-full max-w-[220px] overflow-hidden rounded-[28px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={SALON_TYPE_CONTENT[classification.mainType].characterImagePath}
                  alt={SALON_TYPE_CONTENT[classification.mainType].name}
                  className="h-full w-full object-contain"
                />
              </div>
              <p className="mt-2 font-serif text-[20px] font-bold text-ink">
                {SALON_TYPE_CONTENT[classification.mainType].name}
              </p>
              <p className="mt-2 text-[13px] leading-relaxed text-charcoal">
                {SALON_TYPE_CONTENT[classification.mainType].description}
              </p>
            </div>

            <div className="mt-5 border-t border-line pt-4 text-center">
              <p className="eyebrow mb-2">サブタイプ</p>
              <p className="text-[14px] font-semibold text-ink">
                <span aria-hidden="true">{SALON_TYPE_CONTENT[classification.subType].icon}</span>{" "}
                {SALON_TYPE_CONTENT[classification.subType].name}
              </p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-sub">
                {SALON_TYPE_CONTENT[classification.subType].description}
              </p>
            </div>
          </div>
        )}
      </section>

      {/* ⑤AIによるサロン紹介。AI本文は一切変更・再生成せず、既存4データを
          見出し付きの4ブロックへ分けて表示するだけ（表示コードの変更のみ）。
          adviceは既存の配列構造のまま箇条書き表示を維持する。 */}
      <section className="mt-5 rounded-2xl border border-line bg-surface p-6">
        <p className="eyebrow mb-3">AIによるサロン紹介</p>

        {(!cultureDetail || !cultureDetail.available || !cultureDetail.ai) && (
          <p className="text-[12.5px] leading-relaxed text-charcoal">
            サロンらしさを回答すると、AIによるサロン紹介文が表示されます。
          </p>
        )}

        {cultureDetail?.available && cultureDetail.ai && (
          <div className="space-y-5">
            {cultureDetail.ai.essence && (
              <div>
                <p className="eyebrow mb-1.5" style={{ color: "var(--gold)" }}>
                  このサロンらしさ
                </p>
                <p className="text-[13.5px] leading-relaxed text-charcoal">{cultureDetail.ai.essence}</p>
              </div>
            )}
            {cultureDetail.ai.explanation && (
              <div>
                <p className="eyebrow mb-1.5" style={{ color: "var(--gold)" }}>
                  働く環境
                </p>
                <p className="text-[13.5px] leading-relaxed text-charcoal">{cultureDetail.ai.explanation}</p>
              </div>
            )}
            {cultureDetail.ai.advice && cultureDetail.ai.advice.length > 0 && (
              <div>
                <p className="eyebrow mb-1.5" style={{ color: "var(--gold)" }}>
                  こんな美容師と相性◎
                </p>
                <ul className="list-disc space-y-1 pl-5 text-[13.5px] leading-relaxed text-charcoal">
                  {cultureDetail.ai.advice.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
            {cultureDetail.ai.growth && (
              <div>
                <p className="eyebrow mb-1.5" style={{ color: "var(--gold)" }}>
                  これからの可能性
                </p>
                <p className="text-[13.5px] leading-relaxed text-charcoal">{cultureDetail.ai.growth}</p>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ★外部リンクCTA（0015 salon_links）。美容師向け表示における外部リンクの
          唯一のsource of truthはsalon_linksのみとする。旧salon_profiles.
          instagram_handle/hotpepper_url（既存カラム、無変更・削除しない）は
          このページの表示には一切使わない（フォールバック表示は廃止した）。
          理由: サロンがsalon_links側でリンクを削除した後に、旧カラムの値が
          フォールバックとして再表示されてしまう不整合を防ぐため。登録されて
          いるsalon_linksが0件の場合、このセクション自体を表示しない。 */}
      {salonLinks.length > 0 && (
        <section className="mt-5 rounded-2xl border border-line bg-surface p-6">
          <p className="eyebrow mb-3">このサロンをもっと見る</p>
          <div className="space-y-2">
            {salonLinks.map((link) => (
              <a
                key={link.id}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center justify-center rounded-full border border-line bg-surface2 px-6 py-3.5 text-[13.5px] font-semibold text-ink"
              >
                {SALON_LINK_TYPE_LABELS[link.linkType as keyof typeof SALON_LINK_TYPE_LABELS] ?? "リンク"}
                {link.linkType === "other" && link.label ? `（${link.label}）` : ""}
                を見る
              </a>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
