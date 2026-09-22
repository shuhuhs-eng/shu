import type { Metadata, Viewport } from "next";
import "./globals.css";

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

export const metadata: Metadata = {
  title: "Beauty Reach — 才能を、多彩に評価する。",
  description: "美容師の才能を診断し、相性の合うサロンと出会う。",
  icons: {
    icon: "/favicon.svg",
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
