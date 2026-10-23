/**
 * CSV出力の共通処理。
 * ★出力するのは集計済みの件数と店舗名・入口名だけ。個人名・社内メモ・理由・ID(UUID)は含めない。
 * ★スプレッドシートの数式として解釈される文字(= + - @ など)で始まる文字列は先頭に ' を付けて無効化する。
 */
export type CsvCell = string | number | null;

function escapeCell(value: CsvCell): string {
  if (value === null) return "";
  let s = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(header: string[], rows: CsvCell[][]): string {
  return [header, ...rows].map((r) => r.map(escapeCell).join(",")).join("\r\n");
}

/** Excelで文字化けしないようBOM付き。 */
export function csvBlobUrl(csv: string): string {
  return URL.createObjectURL(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }));
}
