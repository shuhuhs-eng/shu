"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export type StoreDirectoryItem = {
  id: string;
  name: string;
  organizationName: string;
  /** 所在地（店舗プロフィールの都道府県・市区町村）。未作成・未入力は null。 */
  location: string | null;
  usageActive: boolean;
  /** 店舗プロフィールの状態。取得できなかったときは null（状態を表示しない）。 */
  profileState: "public" | "private" | "none" | null;
};

type Props = { stores: StoreDirectoryItem[] };

const PROFILE_LABEL: Record<"public" | "private" | "none", string> = {
  public: "プロフィール公開中",
  private: "プロフィール非公開",
  none: "プロフィール未作成",
};

/**
 * 会社ダッシュボードの店舗一覧。店名・所在地・会社名で絞り込める（店舗数が増えても探せるように）。
 * 表示する値はすべて既存データ（salon_stores / salon_store_profiles / salon_organizations）。
 * 店舗の画像は店舗単位では保存されていないため、店名の頭文字で識別する（ロゴは店舗ごとではない）。
 */
export function StoreDirectory({ stores }: Props) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      q === ""
        ? stores
        : stores.filter((s) => [s.name, s.location ?? "", s.organizationName].some((v) => v.toLowerCase().includes(q))),
    [stores, q],
  );

  return (
    <div>
      {stores.length > 3 && (
        <div className="mb-3">
          <label htmlFor="store-search" className="sr-only">
            店舗を検索
          </label>
          <input
            id="store-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="店舗名・所在地で探す"
            className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-[14px] text-ink"
          />
          <p className="mt-1.5 text-[11.5px] text-sub" aria-live="polite">
            {q === "" ? `${stores.length}店舗` : `${filtered.length} / ${stores.length}店舗`}
          </p>
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-sub">「{query.trim()}」に合う店舗はありません。</p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((s) => (
            <li key={s.id}>
              <Link
                href={`/salon/stores/${s.id}`}
                className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-4"
              >
                <span
                  aria-hidden="true"
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-surface2 font-serif text-[18px] font-bold text-ink"
                >
                  {Array.from(s.name)[0] ?? "店"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] text-sub">{s.organizationName}</span>
                  <span className="mt-0.5 block break-words font-serif text-[16px] font-bold leading-snug text-ink">{s.name}</span>
                  <span className="mt-0.5 block truncate text-[12px] text-sub">{s.location ?? "所在地未設定"}</span>
                  <span className="mt-1.5 flex flex-wrap gap-1.5">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[10.5px] font-bold ${
                        s.usageActive ? "bg-[#EAF3EC] text-[#2E8B7F]" : "bg-surface2 text-sub"
                      }`}
                    >
                      {s.usageActive ? "利用中" : "未利用"}
                    </span>
                    {s.profileState && (
                      <span className="rounded-full bg-surface2 px-2.5 py-0.5 text-[10.5px] font-semibold text-sub">
                        {PROFILE_LABEL[s.profileState]}
                      </span>
                    )}
                  </span>
                </span>
                <span className="shrink-0 text-[12px] font-semibold text-ink" aria-label="店舗ダッシュボードへ">
                  <span className="hidden sm:inline">店舗画面へ </span>›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
