import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * 日本語フォント（Noto Sans JP、SIL Open Font License 1.1）。
 * ★フォントファイルはGitに入れない。npmパッケージ @expo-google-fonts/noto-sans-jp
 *   （node_modules）から読み、next.config.mjs の outputFileTracingIncludes で
 *   デプロイ成果物へ含める。PDFにはPDF内で使う文字だけのサブセットを埋め込む。
 * ★パッケージには全ウェイト（約50MB）が入っているが、使うのは Regular と Bold の2つだけ。
 *   パスは固定の文字列にして、他のウェイトがデプロイ成果物へ入らないようにしている。
 */
let cache: { regular: Uint8Array; bold: Uint8Array } | null = null;

export async function loadInvoiceFonts(): Promise<{ regular: Uint8Array; bold: Uint8Array }> {
  if (cache) return cache;
  const [regular, bold] = await Promise.all([
    readFile(path.join(/*turbopackIgnore: true*/ process.cwd(), "node_modules/@expo-google-fonts/noto-sans-jp/400Regular/NotoSansJP_400Regular.ttf")),
    readFile(path.join(/*turbopackIgnore: true*/ process.cwd(), "node_modules/@expo-google-fonts/noto-sans-jp/700Bold/NotoSansJP_700Bold.ttf")),
  ]);
  cache = { regular: new Uint8Array(regular), bold: new Uint8Array(bold) };
  return cache;
}
