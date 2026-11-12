"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FivePointScale } from "@/components/shared/five-point-scale";
import { SCENES, SUPPLEMENT_TITLES } from "@/lib/salon-culture/analysis/scenes";
import { SUPPLEMENT_KEYS, type BaseAnswers, type SupplementAnswers, type SupplementKey, type SupplementValue } from "@/lib/salon-culture/analysis/v1";
import type { SaveAnalysisResult } from "@/lib/salon-culture/analysis/actions";

type Props = {
  /** 回答の対象（例: サロン名・店舗名）。保存先と同じものを画面に出す。 */
  targetName: string;
  targetKind: "personal" | "store";
  /** この画面を表示した時点の既存回答5つ。保存時にサーバーが現在値と照合する。 */
  expectedBase: BaseAnswers;
  initial: Partial<SupplementAnswers> | null;
  /** 保存処理（Server Action を呼ぶ薄い関数）。 */
  save: (answers: SupplementAnswers, expectedBase: BaseAnswers) => Promise<SaveAnalysisResult>;
  doneHref: string;
  cancelHref: string;
};

/**
 * サロンらしさ 追加5問の回答フォーム。回答を促すが強制はしない（既存機能は回答なしでも使える）。
 * 「当てはまらない」は数値で埋めず、そのまま保存する。
 */
export function AnalysisForm({ targetName, targetKind, expectedBase, initial, save, doneHref, cancelHref }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<Partial<SupplementAnswers>>(initial ?? {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  const complete = SUPPLEMENT_KEYS.every((k) => values[k] != null);

  function set(key: SupplementKey, v: SupplementValue) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  async function handleSave() {
    if (!complete || saving) return;
    setSaving(true);
    setError(null);
    const result = await save(values as SupplementAnswers, expectedBase);
    setSaving(false);
    if (!result.success) {
      setError({ code: result.code, message: result.error });
      return;
    }
    router.push(doneHref);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-line bg-surface p-5">
        <p className="eyebrow mb-1">回答の対象</p>
        <p className="text-[15px] font-bold text-ink">{targetName}</p>
        <p className="mt-1 text-[12px] leading-relaxed text-sub">
          {targetKind === "store"
            ? "この回答は、この店舗の「サロンらしさ」に保存されます。ご自身の個人の回答や他の店舗とは、自動では共有されません。"
            : "この回答は、あなた個人の「サロンらしさ」に保存されます。店舗の回答とは、自動では共有されません。"}
        </p>
      </section>

      <p className="text-[13px] leading-relaxed text-charcoal">
        サロンらしさを、5つの観点でくわしく見るための追加の質問です。「今、実際にどうしているか」でお答えください。
        どちらが良い・悪いという質問ではありません。当てはまらない場合は「当てはまらない」を選べます。
      </p>

      {SUPPLEMENT_KEYS.map((key, i) => {
        const scene = SCENES[key];
        const value = values[key];
        const isNa = value === "na";
        return (
          <section key={key} className="rounded-2xl border border-line bg-surface p-5">
            <p className="eyebrow mb-2">追加の質問 {i + 1} / {SUPPLEMENT_KEYS.length}</p>
            <h2 className="text-[14.5px] font-bold leading-relaxed text-ink">{SUPPLEMENT_TITLES[key]}</h2>
            <div className="mt-4">
              <FivePointScale
                leftLabel={scene.low}
                rightLabel={scene.high}
                value={typeof value === "number" ? value : undefined}
                onChange={(n) => set(key, n as 1 | 2 | 3 | 4 | 5)}
                disabled={saving}
              />
              <button
                type="button"
                disabled={saving}
                aria-pressed={isNa}
                onClick={() => set(key, "na")}
                className={`mt-4 w-full rounded-full border px-4 py-2.5 text-[13px] font-semibold disabled:opacity-60 ${
                  isNa ? "border-ink bg-ink text-surface" : "border-line bg-surface text-charcoal"
                }`}
              >
                当てはまらない
              </button>
            </div>
          </section>
        );
      })}

      {error && (
        <div role="alert" className="rounded-xl border border-line bg-surface2 p-4 text-[13px] leading-relaxed text-ink">
          <p>{error.message}</p>
          {error.code === "base_changed" && (
            <button
              type="button"
              onClick={() => router.refresh()}
              className="mt-3 rounded-full border border-line bg-surface px-4 py-2 text-[13px] font-semibold"
            >
              画面を読み込み直す
            </button>
          )}
        </div>
      )}

      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={!complete || saving}
          className="flex w-full items-center justify-center rounded-full bg-ink px-6 py-4 text-[15px] font-semibold text-surface disabled:opacity-50"
        >
          {saving ? "保存しています…" : "回答を保存する"}
        </button>
        {!complete && <p className="text-[12px] text-sub">すべての質問に回答すると保存できます。</p>}
        <Link href={cancelHref} className="text-[13px] text-sub underline">
          あとで回答する
        </Link>
      </div>
    </div>
  );
}
