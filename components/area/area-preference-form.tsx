"use client";

import { useState, useTransition } from "react";
import { RegionPicker } from "@/components/area/region-picker";
import { saveAreaPreferenceAction } from "@/lib/area/actions";
import type { RegionRow } from "@/lib/area/regions";

type Mode = "unset" | "selected" | "nationwide";
type Props = { rows: RegionRow[]; initialMode: Mode; initialCodes: string[]; initialRevision: number; needsReview: boolean };

const MODE_LABEL: Record<Mode, string> = { unset: "まだ決めていない", selected: "働きたい地域を選ぶ", nationwide: "全国どこでも検討できる" };

/** 美容師: 希望勤務地の設定。保存は全置換。別画面での更新と重なったときは、読み込み直しを案内する（上書きしない）。 */
export function AreaPreferenceForm({ rows, initialMode, initialCodes, initialRevision, needsReview }: Props) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [codes, setCodes] = useState<string[]>(initialCodes);
  const [revision, setRevision] = useState(initialRevision);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string; conflict?: boolean } | null>(null);
  const [pending, start] = useTransition();
  const canSave = !pending && (mode !== "selected" || codes.length > 0);

  function save() {
    setMessage(null);
    start(async () => {
      const r = await saveAreaPreferenceAction({ mode, codes: mode === "selected" ? codes : [], expectedRevision: revision });
      if (r.success) { setRevision(r.revision); setMessage({ kind: "ok", text: "希望勤務地を保存しました。" }); }
      else setMessage({ kind: "error", text: r.error, conflict: r.conflict });
    });
  }

  return (
    <div>
      {needsReview && (
        <p role="status" className="mb-5 rounded-lg bg-surface2 px-4 py-3 text-[12.5px] leading-relaxed text-charcoal">
          地域の区分が更新されたため、以前選んだ地域の見直しをお願いします。見直しが済むまで、地域を指定した検索には表示されません（「全国どこでも」を選んでいる場合は影響しません）。
        </p>
      )}
      <fieldset className="space-y-2" disabled={pending}>
        <legend className="mb-2 text-[13px] font-semibold text-ink">働きたい地域</legend>
        {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
          <label key={m} className="flex items-center gap-2 text-[13.5px] text-charcoal">
            <input type="radio" name="area-mode" checked={mode === m} onChange={() => setMode(m)} />
            {MODE_LABEL[m]}
          </label>
        ))}
      </fieldset>
      {mode === "unset" && <p className="mt-3 text-[12px] leading-relaxed text-sub">設定しないと、サロンの「近隣」検索には表示されません（「全国」の一覧には表示されます）。</p>}
      {mode === "selected" && (
        <div className="mt-5">
          <RegionPicker rows={rows} selected={codes} max={20} onChange={setCodes} onError={setPickerError} disabled={pending} />
          {pickerError && <p role="alert" className="mt-2 text-[12.5px] text-red-700">{pickerError}</p>}
        </div>
      )}
      <button type="button" onClick={save} disabled={!canSave} className="mt-6 w-full rounded-full bg-ink px-5 py-3 text-[14px] font-semibold text-white disabled:opacity-50">
        {pending ? "保存中…" : "保存する"}
      </button>
      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={`mt-3 text-[13px] leading-relaxed ${message.kind === "error" ? "text-red-700" : "text-charcoal"}`}>
          {message.text}
          {message.conflict && <> <button type="button" className="underline" onClick={() => window.location.reload()}>最新の内容を読み込み直す</button></>}
        </p>
      )}
    </div>
  );
}
