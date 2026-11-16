import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getSeoBaseUrl, OG_IMAGE, SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE } from "@/lib/seo/site";

// ★next/font/google（Shippori_Mincho / Zen_Kaku_Gothic_New / Archivo）は
// 削除した。next/font/googleはビルド時に実際にGoogle Fonts（fonts.googleapis.com /
// fonts.gstatic.com）へ通信してフォントファイルを取得する仕組みのため、
// ネットワークが不安定・遮断された環境では npm run build がその通信の失敗
// （ETIMEDOUT等）でそのまま失敗してしまう。
//
// 代わりに、tailwind.config.ts の fontFamily を「日本語OSに標準搭載されている
// 明朝体・ゴシック体のシステムフォント」を直接指定する方式に切り替えた
// （Hiragino Mincho ProN / Yu Mincho 等）。これによりビルド時・実行時ともに
// 外部フォントの取得が一切発生しない。見た目は完全に同一のフォントには
// ならないが、明朝体×ゴシック体×データ用フォントという役割分担そのものは
// 維持しているため、大きく崩れない。

// 全ページ共通の既定値。canonical はここに置かない（置くと全ページがトップURLを指してしまう）。各公開ページが自分のパスで指定する。
// openGraph は後勝ちで丸ごと置き換わるため、公開ページは lib/seo/metadata.ts の publicPageMetadata で完全な形を作る。
export const metadata: Metadata = {
  metadataBase: new URL(getSeoBaseUrl()),
  title: `${SITE_NAME} — ${SITE_TAGLINE}`,
  description: SITE_DESCRIPTION,
  icons: {
    icon: "/favicon.svg",
  },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "ja_JP",
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE.url],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="font-sans">{children}</body>
    </html>
  );
}
