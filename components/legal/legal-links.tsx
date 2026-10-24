import Link from "next/link";

/** 公開ページ・ログイン/登録画面の下部に置く、規約とプライバシーへのリンク。 */
export function LegalLinks({ className = "" }: { className?: string }) {
  return (
    <p className={`text-center text-[11.5px] text-sub ${className}`}>
      <Link href="/terms" className="underline">利用規約</Link>
      <span className="mx-2">／</span>
      <Link href="/privacy" className="underline">プライバシーポリシー</Link>
    </p>
  );
}
