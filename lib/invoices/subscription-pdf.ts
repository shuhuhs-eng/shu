import subsetFont from "subset-font";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { loadInvoiceFonts } from "./fonts";
import { collectCharsWith, formatRate, jpDate, wrap, yen } from "./pdf-common";
import type { PreparedSubscriptionInvoice } from "./subscription-types";

/**
 * 月額利用料の適格請求書PDF（クレジットカード決済済み）。入力は prepare 系RPCのsnapshotだけ。
 * 成功報酬の請求書とはレイアウトを共有しない（振込先・支払期限が無く、対象期間・決済済み表示がある）。
 * ★カード番号・ブランド・下4桁は載せない（snapshotに存在しない）。
 */
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;
const INK = rgb(0.1, 0.1, 0.1);
const SUB = rgb(0.4, 0.4, 0.4);
const LINE = rgb(0.75, 0.75, 0.75);
const ACCENT = rgb(0.16, 0.36, 0.27);

// ★PDFに書く固定の文言をすべて含めること（フォントはここ＋snapshotの文字だけにサブセットされ、欠けた文字は表示されない）。
const FIXED_LABELS = [
  "請求書（クレジットカード決済済み）", "請求書番号", "請求日", "御中", "ご請求金額（税込）", "クレジットカードにて決済済みです",
  "取引年月日", "対象期間", "取引内容", "数量", "金額（税抜）", "小計（税抜）", "消費税", "適用税率", "対象", "税抜", "合計（税込）",
  "登録番号", "〒", "様", "TEL", "円", "年", "月", "日", "〜", "お支払い", "支払方法", "クレジットカード", "決済日", "決済参照",
];
const STATIC_TEXT = FIXED_LABELS.join("");

export async function renderSubscriptionInvoicePdf(prepared: PreparedSubscriptionInvoice): Promise<Uint8Array> {
  const issuer = prepared.issuer_snapshot;
  const recipient = prepared.recipient_snapshot;
  const c = prepared.invoice_content_snapshot;
  const item = c.line_items[0];

  const fonts = await loadInvoiceFonts();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const chars = collectCharsWith(STATIC_TEXT, prepared);
  const [regularBytes, boldBytes] = await Promise.all([
    subsetFont(Buffer.from(fonts.regular), chars, { targetFormat: "truetype" }),
    subsetFont(Buffer.from(fonts.bold), chars, { targetFormat: "truetype" }),
  ]);
  const regular = await doc.embedFont(regularBytes, { subset: false });
  const bold = await doc.embedFont(boldBytes, { subset: false });

  doc.setTitle(`請求書 ${c.invoice_number}`);
  doc.setAuthor(issuer.legal_name);
  doc.setSubject("請求書（クレジットカード決済済み）");
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
  text(page, "請求書（クレジットカード決済済み）", MARGIN, PAGE_H - 78, 20, bold);
  hr(PAGE_H - 90, MARGIN, PAGE_W - MARGIN, 1.5, ACCENT);
  textRight(`請求書番号　${c.invoice_number}`, PAGE_W - MARGIN, PAGE_H - 108, 10);
  textRight(`請求日　${jpDate(c.invoice_date)}`, PAGE_W - MARGIN, PAGE_H - 123, 10);

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

  // ---- ご請求金額・決済済み ----
  page.drawRectangle({ x: MARGIN, y: y - 34, width: PAGE_W - MARGIN * 2, height: 40, color: rgb(0.95, 0.97, 0.95), borderColor: LINE, borderWidth: 0.6 });
  text(page, "ご請求金額（税込）", MARGIN + 14, y - 20, 11, bold);
  textRight(yen(c.total_amount), PAGE_W - MARGIN - 14, y - 22, 18, bold, ACCENT);
  y -= 58;
  text(page, "クレジットカードにて決済済みです", MARGIN, y, 11, bold, ACCENT);
  y -= 26;

  // ---- 取引年月日・対象期間 ----
  text(page, `取引年月日　${jpDate(c.transaction_date)}`, MARGIN, y, 10);
  y -= 15;
  text(page, `対象期間　${jpDate(c.service_period_start)} 〜 ${jpDate(c.service_period_end)}`, MARGIN, y, 10);
  y -= 28;

  // ---- 明細 ----
  const colQty = 380;
  const colAmt = PAGE_W - MARGIN;
  page.drawRectangle({ x: MARGIN, y: y - 6, width: PAGE_W - MARGIN * 2, height: 22, color: rgb(0.92, 0.92, 0.92) });
  text(page, "取引内容", MARGIN + 8, y, 9.5, bold);
  textRight("数量", colQty + 30, y, 9.5, bold);
  textRight("金額（税抜）", colAmt - 8, y, 9.5, bold);
  y -= 24;
  const descLines = wrap(item.description, regular, 10.5, colQty - MARGIN - 40);
  const rowTop = y;
  descLines.forEach((line, i) => text(page, line, MARGIN + 8, y - i * 14, 10.5));
  textRight(`${item.quantity}${item.unit}`, colQty + 30, rowTop, 10.5);
  textRight(yen(item.amount), colAmt - 8, rowTop, 10.5);
  y -= descLines.length * 14 + 6;
  hr(y);
  y -= 26;

  // ---- 税の内訳・合計 ----
  const labelX = 340;
  const rows: Array<[string, string, boolean]> = [
    ["小計（税抜）", yen(c.amount_excl_tax), false],
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
  text(page, `適用税率 ${formatRate(c.tax_rate)} 対象　税抜 ${yen(c.amount_excl_tax)}　消費税 ${yen(c.tax_amount)}`, MARGIN, y, 8.5, regular, SUB);
  y -= 34;

  // ---- 支払方法 ----
  text(page, "お支払い", MARGIN, y, 11, bold);
  y -= 8;
  hr(y);
  y -= 18;
  const payRows: Array<[string, string]> = [
    ["支払方法", "クレジットカード"],
    ["決済日", jpDate(c.invoice_date)],
    ["決済参照", c.payment.stripe_invoice_id],
  ];
  for (const [label, value] of payRows) {
    text(page, label, MARGIN + 8, y, 9.5, regular, SUB);
    text(page, value, MARGIN + 90, y, 10);
    y -= 16;
  }
  return doc.save();
}
