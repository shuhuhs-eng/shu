import type { PDFFont } from "pdf-lib";

/** 請求書PDF（成功報酬・月額）で共通に使う小さな純粋関数。レイアウトは各PDFで別に持つ。 */

export function jpDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`;
}

export function yen(n: number): string {
  return `${n.toLocaleString("ja-JP")}円`;
}

export function formatRate(rate: number): string {
  return `${Number.isInteger(rate) ? rate : rate.toString()}%`;
}

/** 幅に収まるよう1文字単位で折り返す（日本語向け）。 */
export function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let cur = "";
    for (const ch of para) {
      if (cur && font.widthOfTextAtSize(cur + ch, size) > maxWidth) {
        lines.push(cur);
        cur = ch;
      } else {
        cur += ch;
      }
    }
    lines.push(cur);
  }
  return lines;
}


/** PDFに埋め込むフォントのサブセット用に、使う文字を集める。 */
export function collectCharsWith(staticText: string, value: unknown): string {
  const set = new Set<string>();
  const add = (s: string) => { for (const ch of s) set.add(ch); };
  add(staticText);
  for (let code = 0x20; code <= 0x7e; code++) add(String.fromCharCode(code));
  add("　0123456789,.%");
  const walk = (v: unknown) => {
    if (typeof v === "string") add(v);
    else if (typeof v === "number") add(String(v));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(value);
  return Array.from(set).join("");
}
