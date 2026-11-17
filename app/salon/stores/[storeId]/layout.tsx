import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasCompletedRole } from "@/lib/auth/user-roles";

type Props = {
  children: React.ReactNode;
  params: Promise<{ storeId: string }>;
};

/**
 * 店舗ワークスペース共通layout（法人・複数店舗対応 Phase 2）。
 *
 * ★アクセス権チェック（最重要・Server側のみで判定）: salon_storesへの
 * SELECTは0026で定義済みのRLSポリシー salon_stores_select_accessible が
 * is_store_accessible(id) を使って判定しており、アクセス権の無いstore_id
 * （他人の店舗・存在しないstore_id）は行自体が返らない。ここでは
 * 独自の権限ロジックを一切実装せず、この既存RLSを唯一の正として
 * 「行が取得できたかどうか」だけを見る。Client側だけで判定することは
 * 一切行っていない（この判定はServer Componentとして実行される）。
 *
 * 「rpcでis_store_accessible()を直接呼ぶ」のではなく「salon_storesを
 * 直接SELECTする」方式にしているのは、(1) このRLSポリシー自体が
 * is_store_accessible()をそのまま使っているため権限ロジックの出典は
 * 完全に同一であること、(2) アクセス可否の判定と店舗データの取得を
 * 1回のクエリで同時に行え、往復を増やさずに済むため。
 *
 * ★既存機能への影響: scouts/salary_offers/matching等は一切参照していない。
 */
export default async function StoreWorkspaceLayout({ children, params }: Props) {
  const { storeId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=/salon/stores/${storeId}`);
  }

  if (!(await hasCompletedRole(supabase, user.id, "salon"))) {
    redirect("/onboarding/salon");
  }

  // ★他人のstore_id・存在しないstore_id・不正な形式のstore_idは、
  // RLSによる絞り込みの結果 data が null になるか、型キャストエラーで
  // error が返る。いずれの場合も「アクセス不可」として扱い、存在有無を
  // 区別せず会社ダッシュボードへ差し戻す（情報漏洩防止）。
  const { data: store, error } = await supabase
    .from("salon_stores")
    .select("id, store_name")
    .eq("id", storeId)
    .maybeSingle();

  if (error || !store) {
    redirect("/salon/company");
  }

  // 対象店舗の名前と、会社ダッシュボードへ戻る導線を、店舗配下のすべての画面の上部に出す。
  // 店舗名はURLのstoreIdで取得した（アクセス権のある）店舗のもの。別店舗の名前は混ざらない。
  return (
    <>
      <nav
        aria-label="店舗の切り替え"
        className="border-b border-line bg-surface2 px-5 py-2.5 text-[12.5px]"
      >
        <div className="mx-auto flex max-w-[640px] items-center justify-between gap-3">
          <p className="min-w-0 truncate text-ink">
            <span className="text-sub">対象店舗：</span>
            <Link href={`/salon/stores/${storeId}`} className="font-bold underline-offset-2 hover:underline">
              {store.store_name}
            </Link>
          </p>
          <Link href="/salon/company" className="shrink-0 font-semibold text-sub underline">
            会社ダッシュボードへ
          </Link>
        </div>
      </nav>
      {children}
    </>
  );
}
