"use client";

import { useState } from "react";

type Props = {
  src: string;
  alt: string;
};

/**
 * Hero右側のキャラクター画像。
 *
 * app/page.tsx（Server Component）から `<HeroCharacter src alt />` として
 * 呼び出す。サイズ・位置（幅・高さ・right・bottom・z-index等）はすべて
 * このファイル内のclassNameだけで完結させている。今後キャラクターの
 * 大きさ・位置を調整する場合は、このファイルの値だけを変更すればよい。
 *
 * 画像ファイルがまだ public配下に存在しない場合でも、onErrorで読み込み
 * 失敗を検知して何も描画しない（壊れた画像アイコンを見せない）。
 *
 * 配置方針（Hero自体の高さは変更せず、視覚的なはみ出しで調整）:
 *   ・前回はHero行に lg:min-h-[520px] を追加して大きなキャラクター用の
 *     余白を作ったが、これは下部カードの開始位置を約170px押し下げてしまい、
 *     1366×768前後でのファーストビュー内カード表示を崩すため不採用とした。
 *   ・今回は「HeroのCSSボックスとしての高さ」は一切変更せず（下部カードの
 *     位置は完全に従来のまま）、absolute配置のキャラクターをHeroの表示
 *     領域から視覚的にはみ出させる方式にした（app/page.tsx側でHero行に
 *     overflow-visible を明示）。
 *   ・座標の考え方（mainの座標系、lg基準）:
 *       ・ログインUI: top-5(20px) + pill高さ約31px ≒ y=51で終わる
 *       ・Hero行の開始位置: pt-16によりy=64
 *       ・Hero行自身の高さ（左側コンテンツの自然な高さ）: 約350px
 *         → Hero行の下端 ≒ y=414、下部カード開始位置 ≒ y=430（従来のまま）
 *     bottom に負の値（外側へのオフセット）を与えることで、キャラクター
 *     全体を下方向へシフトさせ、上端はログインUIの下（y=51）より
 *     十分下（目安y=69、約18pxの余白）に、下端は下部カード領域へ
 *     意図的に約110px潜り込ませている（「カードの後ろに潜り込むような
 *     見え方でも可」という指示に基づく）。
 *   ・高さ h-[470px]（460〜490pxの目安レンジ内）、
 *     right-[65px]（50〜80pxの目安レンジ内、画面右端には張り付かせない）、
 *     bottom-[-125px]（Hero行の下端から125px外側＝下へシフト）。
 *   ・z-index: キャラクターは z-[1]（低め）。右上ログインUI（z-10）・
 *     下部カード行（app/page.tsx側で relative z-10 を付与）の両方より
 *     必ず背面に描画されるようにしている。これにより、キャラクターの
 *     下部がカード領域に入り込んでも、カードが手前に見える。
 *   ・hidden lg:block でPCのみ表示。スマホは今回対象外のまま。
 *
 * ★正直な注記: このサンドボックスには実ブラウザが無く、モックアップでの
 * 検証にとどまる。実際の画像の縦横比・透過マージンによって見え方は
 * 変わるため、実機確認の上、必要であればこの h-[470px] / bottom-[-125px] /
 * right-[65px] の数値だけを微調整してほしい。
 *
 * ── スマホ用表示（新規追加分） ──────────────────────────────
 * PC用のabsolute値（right-65px・bottom--125px・h-470px等）はスマホでは
 * 一切流用しない。app/page.tsx側で、この呼び出し位置自体を「説明文の後・
 * CTAの前」に置くことで、スマホでは通常のドキュメントフロー内画像として
 * （ロゴ→キャッチコピー→説明→キャラクター→CTAの順で）自然に表示される。
 * PC側はabsolute配置なのでDOM順序に影響されず、見た目は従来のまま。
 *   ・サイズ: h-[230px]（案内役として認識できる、180〜230pxの目安内。
 *     説明文・CTAとは通常フローの上下マージンで分離されているため、
 *     高さを増やしても重なりは発生しない＝後続要素が押し下がるだけ）。
 *     幅はobject-containで高さに応じて自動スケール。
 *   ・配置: 中央揃え（flex justify-center）。案領域・カードには重ねない
 *     （通常フロー内表示のため、後続要素を押し下げるだけで重なりが
 *     発生しない）。
 *   ・lg:hidden でPC側では非表示（PC版はabsoluteブロックのみを使う）。
 */
export function HeroCharacter({ src, alt }: Props) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return null;
  }

  return (
    <>
      {/* スマホ用: 通常フロー内、説明文とCTAの間。案内役として認識できる
          サイズにとどめ、無理に大きくしない。 */}
      <div className="mt-6 flex justify-center lg:hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          onError={() => setFailed(true)}
          className="h-[230px] w-auto object-contain"
        />
      </div>

      {/* PC用: 既存のabsolute配置（Hero行からの視覚的なはみ出し）。数値は
          前回から一切変更していない。 */}
      <div className="pointer-events-none absolute right-[65px] bottom-[-125px] z-[1] hidden lg:block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          onError={() => setFailed(true)}
          className="h-[470px] w-auto max-w-none object-contain object-bottom"
        />
      </div>
    </>
  );
}
