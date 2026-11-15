"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
import { SaveFeedback } from "@/components/profile/save-feedback";
import { ValuePrioritySelector } from "@/components/profile/value-priority-selector";
import { VALUE_PRIORITY_OPTIONS } from "@/lib/validation/profile-options";
import { proposeValuePriorities, valueLabel, VALUE_PRIORITY_COUNT } from "@/lib/profile/apply-diagnosis-values";
import type { ApplyValuesState } from "@/lib/profile/apply-diagnosis-actions";

/**
 * 診断結果の「大切にしたい働き方」を、プロフィールの「サロン選びで大切にしたいこと」へ反映する欄。
 * 押すまで何も保存しない。押すと、現在の設定と変更案を並べて見せ、本人が編集・確認してから保存する。
 * 診断の選択が3つに満たない・一覧に無い場合は、推測で補わず、足りない分を本人が選ぶ（プロフィールはちょうど3つ・重複なし）。
 * 結果は保存ボタンの直下に出し、失敗しても入力（選んだ内容）は残す。
 */
export function ApplyValuesToProfile({
  diagnosisValues, current, hasProfile, action,
}: {
  diagnosisValues: string[];
  /** プロフィールに保存済みの値（順番が優先順位）。プロフィールが無いときは null */
  current: string[] | null;
  hasProfile: boolean;
  action: (prev: ApplyValuesState, fd: FormData) => Promise<ApplyValuesState>;
}) {
  const [state, formAction, isPending] = useActionState(action, { status: "idle" } as ApplyValuesState);
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const { proposed, missing } = proposeValuePriorities(diagnosisValues);
  const [selected, setSelected] = useState<string[]>(proposed);
  const saved = state.status === "saved" && !dirty ? state.values : null;
  const shownCurrent = saved ?? current;
  const list = (codes: string[] | null) =>
    codes && codes.length > 0 ? <ol className="mt-1 space-y-0.5 text-[13.5px] text-ink">{codes.map((c, i) => <li key={c}>{i + 1}. {valueLabel(c)}</li>)}</ol> : <p className="mt-1 text-[13px] text-sub">未設定</p>;

  return (
    <section className="rounded-2xl border border-line bg-surface p-5" data-testid="apply-values">
      <p className="eyebrow mb-1">プロフィールへの反映</p>
      <p className="text-[13px] leading-relaxed text-charcoal">この診断で選んだ「大切にしたい働き方」を、プロフィールの「サロン選びで大切にしたいこと」に反映できます。押すまでは何も変わりません。</p>
      {!hasProfile ? (
        <p className="mt-3 text-[13px] text-sub">プロフィールがまだ保存されていません。<Link href="/stylist/profile" className="underline">先にプロフィールを保存</Link>すると、反映できます。</p>
      ) : !open ? (
        <button type="button" onClick={() => setOpen(true)} className="mt-3 flex min-h-[48px] w-full items-center justify-center rounded-full border border-ink bg-surface px-6 py-3 text-[14px] font-semibold text-ink">
          プロフィールに反映する
        </button>
      ) : (
        <form
          onSubmit={(e) => {
            // React 19 の <form action> は処理後に入力欄を初期値へ戻す。失敗時に入力を残すため、自前で送信する。
            e.preventDefault();
            if (isPending) return;
            const fd = new FormData(e.currentTarget);
            setDirty(false);
            startTransition(() => formAction(fd));
          }}
          className="mt-4 space-y-4"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-line bg-surface2 p-3" data-testid="apply-current">
              <p className="text-[12px] font-bold text-sub">現在の設定（プロフィール）</p>
              {list(shownCurrent)}
            </div>
            <div className="rounded-xl border border-line bg-surface2 p-3" data-testid="apply-proposed">
              <p className="text-[12px] font-bold text-sub">診断からの変更案</p>
              {list(proposed)}
              {missing > 0 && <p className="mt-2 text-[12px] leading-relaxed text-[#7A5410]" data-testid="apply-missing">診断では{proposed.length}つの選択でした。プロフィールは3つ選ぶため、あと{missing}つは下で選んでください（こちらで補うことはしません）。</p>}
            </div>
          </div>
          <ValuePrioritySelector name="valuePriorities" label="保存する内容（編集できます）" options={VALUE_PRIORITY_OPTIONS} defaultValues={proposed} onChange={(v) => { setSelected(v); setDirty(true); }} />
          <p className="text-[12px] leading-relaxed text-sub">反映できるのは「サロン選びで大切にしたいこと」だけです。氏名・経験・公開範囲など、ほかの保存済みの項目は変わりません。</p>
          <div>
            <button type="submit" disabled={isPending || selected.length !== VALUE_PRIORITY_COUNT} className="flex min-h-[48px] w-full items-center justify-center rounded-full bg-ink px-6 py-3.5 text-[14.5px] font-semibold text-surface disabled:opacity-50">
              {isPending ? "保存中…" : "この内容でプロフィールに保存する"}
            </button>
            <SaveFeedback
              success={saved ? "プロフィールに保存しました" : undefined}
              error={state.status === "error" ? state.message : undefined}
            />
          </div>
        </form>
      )}
    </section>
  );
}
