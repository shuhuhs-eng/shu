/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // PDF用のフォントサブセット化（harfbuzz/wasm）は、バンドルせずNodeから直接読み込む。
  // バンドルすると、harfbuzzの読み込み処理が「プロジェクト全体」を成果物へ含めてしまうため。
  serverExternalPackages: ["subset-font", "harfbuzzjs", "fontverter"],
  // 請求書PDFの日本語フォント（npmパッケージ。Gitには入れていない）を、
  // PDFを作る（運営者の発行操作が動く）ルートの実行環境へ含める。
  outputFileTracingIncludes: {
    "/admin/**": ["./node_modules/@expo-google-fonts/noto-sans-jp/400Regular/NotoSansJP_400Regular.ttf", "./node_modules/@expo-google-fonts/noto-sans-jp/700Bold/NotoSansJP_700Bold.ttf"],
  },
};

export default nextConfig;
