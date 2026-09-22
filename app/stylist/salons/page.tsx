import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasCompletedRole } from "@/lib/auth/user-roles";
import { calculateStylistSalonMatch, getPublicSalonCultureDetail } from "@/lib/matching/actions";
import { deriveSalonTypes, SALON_TYPE_CONTENT } from "@/lib/salon-culture/salon-culture-types";
import { SalonCard } from "@/components/stylist-salons/salon-card";
import type { Database } from "@/types/database";

type SalonProfileRow = Database["public"]["Tables"]["salon_profiles"]["Row"];

type Props = {
  searchParams: Promise<{ favorites?: string }>;
};

/**
 * 美容師専用のサロン一覧画面（「あなたらしさ × サロンらしさ」MVP）。
 *
 * ★role guard: middleware（STYLIST_ONLY_PREFIXESに/stylist/salonsを追加済み）
 * に加えて、このページ自体でもstylist roleの完了を確認する多重防御
 * （既存の/stylist/mypage・/stylist/diagnosis・/stylist/preferenceと同じ
 * パターン）。
 *
 * ★表示対象: salon_profiles.visibility = 'PUBLIC' のサロンのみ。
 * 0011migrationで追加したRLSポリシー（salon_profiles_select_public）に
 * より、そもそもPRIVATE/LIMITEDの行はこのクエリに返ってこない。念のため
 * .eq("visibility", "PUBLIC") でも明示的に絞り込み、二重に保証している。
 *
 * ★相性計算: calculateStylistSalonMatch()（SECURITY DEFINER RPC）が
 * すべての権限チェック・計算を行う。ここではサロンごとに呼び出すだけで、
 * クライアント側での再計算・生データの取り扱いは一切ない。
 */
export default async function StylistSalonsPage({ searchParams }: Props) {
  const { favorites } = await searchParams;
  const showFavoritesOnly = favorites === "1";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/stylist/salons");
  }

  if (!(await hasCompletedRole(supabase, user.id, "stylist"))) {
    redirect("/onboarding");
  }

  const { data: salons } = await supabase
    .from("salon_profiles")
    .select("*")
    .eq("visibility", "PUBLIC")
    .order("created_at", { ascending: false });

  const allSalonList: SalonProfileRow[] = salons ?? [];

  const { data: favoriteRows } = await supabase
    .from("stylist_favorite_salons")
    .select("salon_user_id")
    .eq("stylist_user_id", user.id);
  const favoriteSalonIds = new Set((favoriteRows ?? []).map((row) => row.salon_user_id));
  const salonList = showFavoritesOnly
    ? allSalonList.filter((salon) => favoriteSalonIds.has(salon.user_id))
    : allSalonList;

  // employee_size_masterのラベル解決。app/salon/mypage/page.tsxの既存
  // パターン（コードで引いてlabelを取得）をそのまま踏襲している
  // （既存ロジック自体は変更していない。ここは新規ページ側での再利用）。
  const sizeCodes = Array.from(
    new Set(
      salonList.map((s: SalonProfileRow) => s.employee_size_code).filter((c): c is string => !!c),
    ),
  );
  const sizeLabelByCode = new Map<string, string>();
  if (sizeCodes.length > 0) {
    const { data: sizeRows } = await supabase
      .from("employee_size_master")
      .select("*")
      .in("code", sizeCodes);
    for (const row of sizeRows ?? []) {
      sizeLabelByCode.set(row.code, row.label);
    }
  }

  // 各サロンとの相性と、公開済みサロンらしさを並列取得する。
  // culture_axesはこのServer Component内でタイプ判定にのみ使い、
  // SalonCardへは表示用の静的コンテンツだけを渡す。
  const [matches, cultureDetails] = await Promise.all([
    Promise.all(salonList.map((s: SalonProfileRow) => calculateStylistSalonMatch(s.user_id))),
    Promise.all(salonList.map((s: SalonProfileRow) => getPublicSalonCultureDetail(s.user_id))),
  ]);

  const salonTypes = cultureDetails.map((detail) => {
    if (!detail?.available) return null;
    const classification = deriveSalonTypes(detail.cultureAxes);
    return classification ? SALON_TYPE_CONTENT[classification.mainType] : null;
  });

  // 相性を計算できるサロンはスコアの高い順に並べる。未回答などで相性を
  // 計算できないサロンはその後ろに置き、同点時はDB取得順を維持する。
  // 計算式・RPC・DBは変更せず、表示順だけをここで整える。
  const rankedSalons = salonList
    .map((salon, index) => ({
      salon,
      match: matches[index],
      salonType: salonTypes[index],
      originalIndex: index,
    }))
    .sort((a, b) => {
      const aScore = a.match?.available ? a.match.overall_score : -1;
      const bScore = b.match?.available ? b.match.overall_score : -1;
      return bScore - aScore || a.originalIndex - b.originalIndex;
    });

  return (
    <main className="mx-auto max-w-[640px] px-5 py-12">
      <div className="mb-7 flex items-center gap-2.5">
        <span className="eyebrow">Beauty Reach</span>
        <hr className="h-px flex-1 border-0 bg-line" />
      </div>

      <p className="eyebrow mb-2">サロンを探す</p>
      <h1 className="font-serif text-2xl font-bold text-ink">
        あなたらしさ × サロンらしさ
      </h1>
      <p className="mt-3 text-[13px] leading-relaxed text-charcoal">
        公開しているサロンの中から、あなたの「働きたいサロン環境」との相性を確認できます。
      </p>
      {rankedSalons.some(({ match }) => match?.available) && (
        <p className="mt-2 text-[11.5px] text-sub">相性が高い順に表示しています</p>
      )}

      <div className="mt-5 grid grid-cols-2 gap-2 rounded-full bg-surface2 p-1">
        <Link
          href="/stylist/salons"
          className={`rounded-full px-3 py-2 text-center text-[12.5px] font-semibold ${
            !showFavoritesOnly ? "bg-surface text-ink shadow-sm" : "text-sub"
          }`}
        >
          すべてのサロン
        </Link>
        <Link
          href="/stylist/salons?favorites=1"
          className={`rounded-full px-3 py-2 text-center text-[12.5px] font-semibold ${
            showFavoritesOnly ? "bg-surface text-ink shadow-sm" : "text-sub"
          }`}
        >
          ★ 気になるサロン
        </Link>
      </div>

      {rankedSalons.length === 0 ? (
        <p className="mt-8 text-center text-[13px] text-sub">
          {showFavoritesOnly
            ? "気になるサロンはまだ保存されていません。"
            : "現在、公開しているサロンはありません。"}
        </p>
      ) : (
        <div className="mt-8 space-y-4">
          {rankedSalons.map(({ salon, match, salonType }) => (
            <SalonCard
              key={salon.user_id}
              salon={salon}
              employeeSizeLabel={
                salon.employee_size_code ? sizeLabelByCode.get(salon.employee_size_code) ?? null : null
              }
              match={match}
              salonType={salonType}
              isFavorite={favoriteSalonIds.has(salon.user_id)}
            />
          ))}
        </div>
      )}

      <Link href="/stylist/mypage" className="mt-8 block text-center text-[13px] text-sub underline">
        マイページに戻る
      </Link>
    </main>
  );
}
