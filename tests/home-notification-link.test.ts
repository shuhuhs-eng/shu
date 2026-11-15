import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HomeNotificationLink, homeBellLabel, unreadBadgeText } from "@/components/notifications/home-notification-link";

const html = (role: "stylist" | "salon", unread: number | null) => renderToStaticMarkup(createElement(HomeNotificationLink, { role, unread }));

test("トップの通知ベル: 未読があればバッジと件数つきの名前、無ければバッジなし", () => {
  const a = html("stylist", 3);
  assert.ok(a.includes('aria-label="通知 未読3件"') && a.includes('data-testid="home-bell-badge"') && a.includes(">3<"));
  for (const n of [0, null]) {
    const b = html("stylist", n);
    assert.ok(b.includes('aria-label="通知"') && !b.includes("home-bell-badge"));
  }
  assert.equal(unreadBadgeText(99), "99");
  assert.equal(unreadBadgeText(100), "99+");
  assert.equal(homeBellLabel(null), "通知");
});

test("トップの通知ベル: 役割ごとのマイページの通知一覧へ移動する", () => {
  assert.ok(html("stylist", 1).includes('href="/stylist/mypage?notifications=open"'));
  assert.ok(html("salon", 1).includes('href="/salon/mypage?notifications=open"'));
});

test("トップのヘッダー: 美容師・サロンはベル、管理者は管理画面リンク、未登録はマイページリンク。通知の取得・既読は既存の仕組み", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  assert.ok(page.includes('view === "stylist" || view === "salon" ? ('));
  assert.ok(page.includes('href="/admin"') && page.includes('href="/mypage"'));
  assert.ok(page.includes("getUnreadNotificationCount"));
  const lib = readFileSync("lib/notifications/get-notifications.ts", "utf8");
  assert.ok(lib.includes('.eq("is_read", false)'));
  const actions = readFileSync("lib/notifications/actions.ts", "utf8");
  assert.equal((actions.match(/revalidatePath\("\/"\)/g) ?? []).length, 3); // 既読処理3種が、トップの未読件数も更新する
  assert.ok(!/\.insert\(|create_notification/.test(readFileSync("components/notifications/home-notification-link.tsx", "utf8")), "通知を作らない");
});
