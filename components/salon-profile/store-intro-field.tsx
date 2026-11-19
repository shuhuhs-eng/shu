"use client";

import { useEffect, useState } from "react";
import { FieldError } from "@/components/auth/form-messages";
import { countIntroChars } from "@/lib/validation/salon-store-profile";

type Props = {
  defaultBio: string;
  legacyCulture: string;
  unified: boolean;
  max: number;
  errors?: string[];
  onOverChange: (over: boolean) => void;
};

/**
 * 店舗紹介（旧「店舗のカルチャー・文化」の自由記述もここへ統合）。
 *  ・以前の文化欄に記載がある店舗では、その文章を読み取り表示し、「末尾に取り込む」（挿入のみ・自動では保存しない）で1欄にまとめられる。
 *  ・「統合済みにする」は公開画面で旧文化欄を別表示しなくする印だけ。旧文化欄の文章は削除されない。「表示を戻す」で再表示できる。
 *  ・上限は3,000字。超えたときは自動で切り詰めず、超過の文字数を示して保存を止める。
 * 表示の出し分け（紹介のみ／文化のみ／両方／両方空）は DB の公開RPC側が決める。
 */
export function StoreIntroField({ defaultBio, legacyCulture, unified, max, errors, onOverChange }: Props) {
  const [bio, setBio] = useState(defaultBio);
  const [toggle, setToggle] = useState(false);
  const hasLegacy = legacyCulture.trim().length > 0;
  const len = countIntroChars(bio);
  const over = len - max;
  useEffect(() => { onOverChange(over > 0); }, [over, onOverChange]);
  const included = hasLegacy && bio.includes(legacyCulture.trim());
  const introDisplay = toggle ? (unified ? "restore" : "unified") : "keep";

  return (
    <div>
      <label htmlFor="bio" className="mb-1.5 block text-[13px] font-medium text-charcoal">店舗紹介（任意）</label>
      <textarea
        id="bio" name="bio" rows={8} value={bio} onChange={(e) => setBio(e.target.value)}
        aria-describedby="bio-count" aria-invalid={over > 0}
        className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-[14px] leading-relaxed text-ink"
      />
      <p id="bio-count" className={over > 0 ? "mt-1 text-[12px] font-semibold text-[#8A2E2E]" : "mt-1 text-[12px] text-sub"}>
        {over > 0 ? `${over}文字超えています（上限${max}文字）。内容を短くしてください。自動では切り詰めません。` : `${len} / ${max}文字`}
      </p>
      <FieldError messages={errors} />
      <input type="hidden" name="introDisplay" value={introDisplay} />

      {hasLegacy && (
        <section className="mt-4 rounded-xl border border-line bg-surface2 p-4" aria-label="以前の文化欄">
          <p className="text-[12.5px] font-semibold text-charcoal">以前の「店舗のカルチャー・文化」欄の記載があります</p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-sub">
            {unified
              ? "この文章は公開画面では表示されていません（削除はされていません）。「表示を戻す」にすると、再び公開画面に表示されます。"
              : "この欄は店舗紹介に統合しました。下の文章を店舗紹介へ取り込むと、1か所で管理できます。取り込んでも、保存するまで内容は変わりません。"}
          </p>
          <p className="mt-2 whitespace-pre-wrap rounded-lg bg-surface px-3 py-2 text-[12.5px] leading-relaxed text-charcoal">{legacyCulture}</p>
          {!unified && (
            <button
              type="button" disabled={included}
              onClick={() => setBio((b) => (b.trim() ? `${b.trim()}\n\n${legacyCulture.trim()}` : legacyCulture.trim()))}
              className="mt-2 min-h-[44px] rounded-full border border-line px-4 text-[12px] font-semibold text-charcoal disabled:opacity-50"
            >
              {included ? "取り込み済み" : "店舗紹介の末尾に取り込む"}
            </button>
          )}
          <label className="mt-3 flex min-h-[44px] items-start gap-2 text-[12.5px] leading-relaxed text-charcoal">
            <input type="checkbox" checked={toggle} onChange={(e) => setToggle(e.target.checked)} className="mt-1" />
            <span>
              {unified
                ? "保存と同時に「表示を戻す」（以前の文化欄を、公開画面で再び別に表示する）"
                : "保存と同時に「統合済みにする」（以前の文化欄を、公開画面で別に表示しなくなります。文章は削除されません。あとで戻せます）"}
            </span>
          </label>
        </section>
      )}
    </div>
  );
}
