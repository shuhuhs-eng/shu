"use client";

import { useState, type ChangeEvent } from "react";
import { addSalonLinkAction, deleteSalonLinkAction, type SalonLinkRow } from "@/lib/salon-links/actions";
import { SALON_LINK_TYPE_LABELS } from "@/lib/validation/salon-links";
import type { SalonLinkType } from "@/types/database";

type Props = {
  initialLinks: SalonLinkRow[];
};

const MAX_LINKS = 5;
const LINK_TYPE_OPTIONS: SalonLinkType[] = ["hotpepper", "website", "recruit", "instagram", "other"];

/**
 * サロンの外部リンク（HOTPEPPER Beauty／公式ホームページ／求人・自社LP／
 * Instagram／その他、最大5件）を編集するUI。
 *
 * ★既存の salon_profiles.instagram_handle / hotpepper_url とは独立した
 * 仕組み（このコンポーネントは salon_links テーブルのみを扱う）。既存の
 * フォーム内の instagramHandle / hotpepperUrl フィールドはそのまま残っており、
 * このコンポーネントはそれらを一切変更しない。
 *
 * ★salon_photosのSalonPhotoUploaderと同じ設計方針：追加・削除は即時に
 * サーバーへ反映する（フォーム全体の「変更を保存」ボタンを待たない）。
 * salon_linksはRLSでサロン本人の直接INSERT/UPDATE/DELETEを許可している
 * テーブルだが、書き込みはServer Action（addSalonLinkAction/
 * deleteSalonLinkAction）経由に統一し、sort_order算出・5件上限チェック・
 * URL形式検証をサーバー側で一元的に行う。
 */
export function SalonLinksEditor({ initialLinks }: Props) {
  const [links, setLinks] = useState<SalonLinkRow[]>(initialLinks);
  const [linkType, setLinkType] = useState<SalonLinkType>("hotpepper");
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const isFull = links.length >= MAX_LINKS;

  async function handleAdd() {
    setError(null);

    if (isFull) {
      setError(`外部リンクは既に${MAX_LINKS}件登録されています。`);
      return;
    }
    if (!url.trim()) {
      setError("URLを入力してください。");
      return;
    }

    setSaving(true);
    const result = await addSalonLinkAction({ linkType, label, url });
    setSaving(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    setLinks((prev) => [...prev, result.link].sort((a, b) => a.sort_order - b.sort_order));
    setLabel("");
    setUrl("");
  }

  async function handleDelete(linkId: string) {
    setError(null);
    setDeletingId(linkId);

    const result = await deleteSalonLinkAction(linkId);
    setDeletingId(null);

    if (!result.success) {
      setError(result.error);
      return;
    }

    setLinks((prev) => prev.filter((l) => l.id !== linkId));
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-charcoal">登録済みのリンク</span>
        <span className="text-[12px] text-sub">
          {links.length} / {MAX_LINKS}件
        </span>
      </div>

      {links.length > 0 && (
        <ul className="mt-2 space-y-2">
          {links.map((link) => (
            <li
              key={link.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface2 px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-semibold text-charcoal">
                  {SALON_LINK_TYPE_LABELS[link.link_type]}
                  {link.link_type === "other" && link.label ? `（${link.label}）` : ""}
                </p>
                <p className="truncate text-[12px] text-sub">{link.url}</p>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(link.id)}
                disabled={deletingId === link.id}
                className="shrink-0 text-[12px] text-[#8A2E2E] underline disabled:opacity-60"
              >
                {deletingId === link.id ? "削除中..." : "削除"}
              </button>
            </li>
          ))}
        </ul>
      )}

      {!isFull && (
        <div className="mt-4 space-y-2.5 rounded-xl border border-dashed border-line bg-surface2 p-3.5">
          <select
            value={linkType}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setLinkType(e.target.value as SalonLinkType)}
            disabled={saving}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-[13.5px] text-ink outline-none focus:border-ink"
          >
            {LINK_TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {SALON_LINK_TYPE_LABELS[t]}
              </option>
            ))}
          </select>

          {linkType === "other" && (
            <input
              type="text"
              value={label}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setLabel(e.target.value)}
              placeholder="表示名（例：採用サイト）"
              disabled={saving}
              maxLength={40}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-[13.5px] text-ink outline-none focus:border-ink"
            />
          )}

          <input
            type="text"
            value={url}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setUrl(e.target.value)}
            placeholder="https://…"
            disabled={saving}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-[13.5px] text-ink outline-none focus:border-ink"
          />

          <button
            type="button"
            onClick={handleAdd}
            disabled={saving}
            className="flex w-full items-center justify-center rounded-full bg-ink px-4 py-2.5 text-[13px] font-semibold text-surface disabled:opacity-60"
          >
            {saving ? "追加中..." : "＋ リンクを追加"}
          </button>
        </div>
      )}

      {error && <p className="mt-1.5 text-[12.5px] text-[#8A2E2E]">{error}</p>}
    </div>
  );
}
