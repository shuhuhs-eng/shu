"use client";

import { csvBlobUrl, toCsv, type CsvCell } from "@/lib/export/csv";

/**
 * 集計表のCSV保存ボタン。行は呼び出し側が作る（個人名・社内メモ・IDは渡さない）。
 */
export function ExportCsvButton({ filename, header, rows, label = "この表をCSVで保存" }: {
  filename: string;
  header: string[];
  rows: CsvCell[][];
  label?: string;
}) {
  function download() {
    const url = csvBlobUrl(toCsv(header, rows));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <button type="button" onClick={download} className="rounded-full border border-line bg-surface px-4 py-1.5 text-[12px] font-semibold text-charcoal">
      {label}
    </button>
  );
}
