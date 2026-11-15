import Link from "next/link";

/**
 * 「マイページへ戻る」。行き先は /mypage（resolveMypagePath＝サイト共通の行き先判定）に任せる:
 * 美容師 → 美容師マイページ、サロン → サロンマイページ。サイトのホーム（/）へは戻さない。
 */
export function BackToMypage() {
  return (
    <Link href="/mypage" className="inline-flex min-h-[44px] items-center text-[13px] font-semibold text-sub underline">
      ← マイページへ戻る
    </Link>
  );
}
