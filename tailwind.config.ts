import type { Config } from "tailwindcss";

// Phase 1〜3のデザインシステムをトークン化（世界観・6才能カラーを維持）
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#F4F0E7",        // ivory
        surface: "#FBF9F4",
        surface2: "#F0EBE0",
        ink: "#1A1714",
        charcoal: "#3C372F",
        sub: "#8B8478",
        line: "#E5DFD3",
        gold: "#9A7B41",      // 限定アクセント
        line_green: "#06C755",
        // 6才能カラー（結果・グラフ専用）
        trait: {
          craft: "#2B4A7E",
          sense: "#B23A6B",
          hospitality: "#CE6B4F",
          brand: "#6E4AA6",
          drive: "#D89A3B",
          mentor: "#2E8B7F",
        },
      },
      fontFamily: {
        // next/font/google（Shippori Mincho）を廃止し、日本語OS標準の明朝体を
        // 直接指定する（ビルド時の外部フォント取得を発生させないため）。
        serif: ["Hiragino Mincho ProN", "Yu Mincho", "YuMincho", "MS Mincho", "serif"],
        // next/font/google（Zen Kaku Gothic New）を廃止し、日本語OS標準の
        // ゴシック体を直接指定する。
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Hiragino Kaku Gothic ProN",
          "Hiragino Sans",
          "Yu Gothic",
          "Meiryo",
          "system-ui",
          "sans-serif",
        ],
        // next/font/google（Archivo）を廃止し、汎用のシステムUIフォントを直接指定する。
        data: ["-apple-system", "BlinkMacSystemFont", "Helvetica Neue", "Arial", "sans-serif"],
      },
      borderRadius: {
        xl: "16px",
        "2xl": "20px",
      },
    },
  },
  plugins: [],
};

export default config;
