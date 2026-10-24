import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * 日本語フォント（Noto Sans JP、SIL Open Font License 1.1）。
 * ★フォントファイルはGitに入れない。npmパッケージ @expo-google-fonts/noto-sans-jp
 *   （node_modules）から読み、next.config.mjs の outputFileTracingIncludes で
 *   デプロイ成果物へ含める。PDFにはPDF内で使う文字だけのサブセットを埋め込む。
 */
const FONT_DIR = path.join("node_modules", "@expo-google-fonts", "noto-sans-jp");

let cache: { regular: Uint8Array; bold: Uint8Array } | null = null;

export async function loadInvoiceFonts(): Promise<{ regular: Uint8Array; bold: Uint8Array }> {
  if (cache) return cache;
  const root = process.cwd();
  const [regular, bold] = await Promise.all([
    readFile(path.join(root, FONT_DIR, "400Regular", "NotoSansJP_400Regular.ttf")),
    readFile(path.join(root, FONT_DIR, "700Bold", "NotoSansJP_700Bold.ttf")),
  ]);
  cache = { regular: new Uint8Array(regular), bold: new Uint8Array(bold) };
  return cache;
}
