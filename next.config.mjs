import { NOINDEX_PATH_PREFIXES } from "./lib/seo/noindex-paths.mjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // PDF用のフォントサブセット化（harfbuzz/wasm）は、バンドルせずNodeから直接読み込む。
  // バンドルすると、harfbuzzの読み込み処理が「プロジェクト全体」を成果物へ含めてしまうため。
  serverExternalPackages: ["subset-font", "harfbuzzjs", "fontverter"],
  // 請求書PDFの日本語フォント（npmパッケージ。Gitには入れていない）を、
  // PDFを作る（運営者の発行操作が動く）ルートの実行環境へ含める。
  // 基本のセキュリティヘッダ（CSPは影響が大きいため、本番公開前の検証で別途検討する）。
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      // 検索対象外ページ（マイページ・管理画面・個人の診断結果・登録/認証など）は noindex。
      // robots.txt では禁止せず、巡回を許したうえで noindex を読み取らせる（lib/seo/noindex-paths.mjs）。
      ...NOINDEX_PATH_PREFIXES.map((p) => ({
        source: `${p}/:path*`,
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      })),
    ];
  },
  outputFileTracingIncludes: {
    "/admin/**": ["./node_modules/@expo-google-fonts/noto-sans-jp/400Regular/NotoSansJP_400Regular.ttf", "./node_modules/@expo-google-fonts/noto-sans-jp/700Bold/NotoSansJP_700Bold.ttf"],
    // 月額の請求書PDFはStripe webhook（invoice.paid）から自動発行する。
    "/api/stripe/webhook": ["./node_modules/@expo-google-fonts/noto-sans-jp/400Regular/NotoSansJP_400Regular.ttf", "./node_modules/@expo-google-fonts/noto-sans-jp/700Bold/NotoSansJP_700Bold.ttf"],
  },
};

export default nextConfig;
