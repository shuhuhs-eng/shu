import subsetFont from "subset-font";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { bankAccountTypeLabel } from "./messages";
import { loadInvoiceFonts } from "./fonts";
import type { PreparedInvoice } from "./types";

/**
 * 請求書PDFを作る。入力は prepare_invoice_document が返したsnapshotだけ。
 * ★DBや他のデータは一切読まない。美容師の個人名はsnapshotに存在せず、PDFにも出さない。
 */

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;
const INK = rgb(0.1, 0.1, 0.1);
const SUB = rgb(0.4, 0.4, 0.4);
const LINE = rgb(0.75, 0.75, 0.75);
const ACCENT = rgb(0.16, 0.36, 0.27);

function jpDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`;
}

function yen(n: number): string {
  return `${n.toLocaleString("ja-JP")}円`;
}

function formatRate(rate: number): string {
  return `${Number.isInteger(rate) ? rate : rate.toString()}%`;
}

/** 幅に収まるよう1文字単位で折り返す（日本語向け）。 */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
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

/** PDFに書く固定の文言。フォントのサブセットに必ず含める。 */
const STATIC_TEXT =
  "請求書番号請求日御中ご請求金額（税込）お支払期限取引内容数量金額（税抜）店舗：採用成立日小計消費税適用税率対象税抜お振込先銀行名支店名口座種別口座番号口座名義普通当座貯蓄お支払期限までに上記口座へお振込みくださいますようお願いいたします。登録番号〒様名円合計（）TEL年月日";

function collectChars(value: unknown): string {
  const set = new Set<string>();
  const add = (s: string) => { for (const ch of s) set.add(ch); };
  add(STATIC_TEXT);
  for (let code = 0x20; code <= 0x7e; code++) add(String.fromCharCode(code));
  add("　0123456789,.%");
  const walk = (v: unknown) => {
    if (typeof v === "string") add(v);
    else if (typeof v === "number") add(String(v));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(value);
  // 金額は桁区切りで表示するため、数字・カンマは上で入れてある。
  return Array.from(set).join("");
}

export async function renderInvoicePdf(prepared: PreparedInvoice): Promise<Uint8Array> {
  const issuer = prepared.issuer_snapshot;
  const recipient = prepared.recipient_snapshot;
  const c = prepared.invoice_content_snapshot;
  const item = c.line_items[0];

  const fonts = await loadInvoiceFonts();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  // ★pdf-lib標準のサブセットは日本語の字形が欠けるため、使う文字だけを先にサブセット化してから埋め込む。
  const chars = collectChars(prepared);
  const [regularBytes, boldBytes] = await Promise.all([
    subsetFont(Buffer.from(fonts.regular), chars, { targetFormat: "truetype" }),
    subsetFont(Buffer.from(fonts.bold), chars, { targetFormat: "truetype" }),
  ]);
  const regular = await doc.embedFont(regularBytes, { subset: false });
  const bold = await doc.embedFont(boldBytes, { subset: false });

  doc.setTitle(`請求書 ${c.invoice_number}`);
  doc.setAuthor(issuer.legal_name);
  doc.setSubject("請求書");
  doc.setCreator("Beauty Reach");
  doc.setProducer("Beauty Reach");

  const page = doc.addPage([PAGE_W, PAGE_H]);

  const text = (p: PDFPage, s: string, x: number, y: number, size: number, f: PDFFont = regular, color = INK) =>
    p.drawText(s, { x, y, size, font: f, color });
  const textRight = (s: string, xRight: number, y: number, size: number, f: PDFFont = regular, color = INK) =>
    text(page, s, xRight - f.widthOfTextAtSize(s, size), y, size, f, color);
  const hr = (y: number, x1 = MARGIN, x2 = PAGE_W - MARGIN, thickness = 0.6, color = LINE) =>
    page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color });

  // ---- タイトル ----
  text(page, "請求書", MARGIN, PAGE_H - 78, 26, bold);
  hr(PAGE_H - 90, MARGIN, PAGE_W - MARGIN, 1.5, ACCENT);

  // ---- 請求書番号・請求日（右上） ----
  const metaX = PAGE_W - MARGIN;
  textRight(`請求書番号　${c.invoice_number}`, metaX, PAGE_H - 108, 10);
  textRight(`請求日　${jpDate(c.invoice_date)}`, metaX, PAGE_H - 123, 10);

  // ---- 請求先（左） ----
  let y = PAGE_H - 122;
  const leftW = 270;
  for (const line of wrap(`${recipient.legal_name} 御中`, bold, 14, leftW)) {
    text(page, line, MARGIN, y, 14, bold);
    y -= 19;
  }
  const recipientLines: string[] = [];
  if (recipient.postal_code) recipientLines.push(`〒${recipient.postal_code}`);
  if (recipient.address) recipientLines.push(...wrap(recipient.address, regular, 9.5, leftW));
  if (recipient.department_name) recipientLines.push(...wrap(recipient.department_name, regular, 9.5, leftW));
  if (recipient.contact_name) recipientLines.push(...wrap(`${recipient.contact_name} 様`, regular, 9.5, leftW));
  for (const line of recipientLines) {
    text(page, line, MARGIN, y, 9.5);
    y -= 13.5;
  }
  const leftBottom = y;

  // ---- 発行事業者（右） ----
  const issuerX = 330;
  const issuerW = PAGE_W - MARGIN - issuerX;
  let iy = PAGE_H - 158;
  for (const line of wrap(issuer.legal_name, bold, 11, issuerW)) {
    text(page, line, issuerX, iy, 11, bold);
    iy -= 15;
  }
  const issuerLines: string[] = [];
  if (issuer.postal_code) issuerLines.push(`〒${issuer.postal_code}`);
  issuerLines.push(...wrap(issuer.address, regular, 9, issuerW));
  if (issuer.phone) issuerLines.push(`TEL ${issuer.phone}`);
  if (issuer.email) issuerLines.push(issuer.email);
  issuerLines.push(`登録番号 ${issuer.invoice_registration_number}`);
  for (const line of issuerLines) {
    text(page, line, issuerX, iy, 9);
    iy -= 12.5;
  }

  y = Math.min(leftBottom, iy) - 24;

  // ---- ご請求金額 ----
  page.drawRectangle({ x: MARGIN, y: y - 34, width: PAGE_W - MARGIN * 2, height: 40, color: rgb(0.95, 0.97, 0.95), borderColor: LINE, borderWidth: 0.6 });
  text(page, "ご請求金額（税込）", MARGIN + 14, y - 20, 11, bold);
  textRight(yen(c.total_amount), PAGE_W - MARGIN - 14, y - 22, 18, bold, ACCENT);
  y -= 58;
  text(page, `お支払期限　${jpDate(c.due_date)}`, MARGIN, y, 11, bold);
  y -= 30;

  // ---- 明細 ----
  const colQty = 380;
  const colAmt = PAGE_W - MARGIN;
  page.drawRectangle({ x: MARGIN, y: y - 6, width: PAGE_W - MARGIN * 2, height: 22, color: rgb(0.92, 0.92, 0.92) });
  text(page, "取引内容", MARGIN + 8, y, 9.5, bold);
  textRight("数量", colQty + 30, y, 9.5, bold);
  textRight("金額（税抜）", colAmt - 8, y, 9.5, bold);
  y -= 24;

  const descLines = [
    ...wrap(item.description, regular, 10.5, colQty - MARGIN - 40),
    ...wrap(`店舗：${item.store_name ?? c.store_name ?? ""}`, regular, 9, colQty - MARGIN - 40),
    `採用成立日：${jpDate(item.hired_date)}`,
  ];
  const rowTop = y;
  descLines.forEach((line, i) => text(page, line, MARGIN + 8, y - i * 14, i === 0 ? 10.5 : 9, regular, i === 0 ? INK : SUB));
  textRight(`${item.quantity}${item.unit}`, colQty + 30, rowTop, 10.5);
  textRight(yen(item.amount), colAmt - 8, rowTop, 10.5);
  y -= descLines.length * 14 + 6;
  hr(y);
  y -= 26;

  // ---- 税の内訳・合計 ----
  const labelX = 340;
  const rows: Array<[string, string, boolean]> = [
    ["小計（税抜）", yen(c.fee_amount), false],
    [`消費税（${formatRate(c.tax_rate)}）`, yen(c.tax_amount), false],
    ["合計（税込）", yen(c.total_amount), true],
  ];
  for (const [label, value, strong] of rows) {
    const f = strong ? bold : regular;
    text(page, label, labelX, y, strong ? 11 : 10, f);
    textRight(value, colAmt - 8, y, strong ? 11 : 10, f);
    y -= 18;
    if (!strong) hr(y + 12, labelX, colAmt, 0.4);
  }
  y -= 4;
  text(page, `適用税率 ${formatRate(c.tax_rate)} 対象　税抜 ${yen(c.fee_amount)}　消費税 ${yen(c.tax_amount)}`, MARGIN, y, 8.5, regular, SUB);
  y -= 34;

  // ---- 振込先 ----
  text(page, "お振込先", MARGIN, y, 11, bold);
  y -= 8;
  hr(y);
  y -= 18;
  const bank = issuer.bank;
  const bankRows: Array<[string, string]> = [
    ["銀行名", bank.bank_name],
    ["支店名", bank.branch_name],
    ["口座種別", bankAccountTypeLabel(bank.account_type) || bank.account_type],
    ["口座番号", bank.account_number],
    ["口座名義", bank.account_holder],
  ];
  for (const [label, value] of bankRows) {
    text(page, label, MARGIN + 8, y, 9.5, regular, SUB);
    text(page, value, MARGIN + 90, y, 10);
    y -= 16;
  }
  y -= 10;
  text(page, "お支払期限までに上記口座へお振込みくださいますようお願いいたします。", MARGIN, y, 9, regular, SUB);

  return doc.save();
}
