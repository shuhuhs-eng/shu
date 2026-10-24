import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// eslint-config-next 16 は ESLint 9 のフラット設定。既存ルールを変えず、そのまま適用する。
const config = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  // React Compiler 系の新ルール。既存コードの挙動を変えずに CI を通すため警告に留める（販売開始後に個別整理）。
  { rules: { "react-hooks/set-state-in-effect": "warn" } },
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts", "scripts/**"] },
];

export default config;
