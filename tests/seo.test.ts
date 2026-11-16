import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import robots from "../app/robots";
import sitemap from "../app/sitemap";
import { NOINDEX_PATH_PREFIXES, PUBLIC_INDEXABLE_PATHS, isNoindexPath } from "../lib/seo/noindex-paths.mjs";
import { publicPageMetadata, NOINDEX_METADATA } from "../lib/seo/metadata";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("robots: 公開ページの巡回を許可し、sitemapを案内。noindex対象は一律に巡回禁止にしない", () => {
  const r = robots();
  const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;
  assert.equal(rule.userAgent, "*");
  assert.equal(rule.allow, "/");
  const dis = ([] as string[]).concat(rule.disallow ?? []);
  assert.deepEqual(dis.sort(), ["/api/", "/auth/"]);
  for (const d of dis) assert.ok(!["/", "/admin", "/mypage", "/salon", "/stylist"].includes(d));
  // noindex を読み取らせる必要のあるページ（マイページ・管理画面・診断結果など）は禁止していない
  for (const p of ["/admin", "/mypage", "/stylist/mypage", "/salon/mypage", "/diagnosis/result", "/stylist/diagnosis/student/result"]) {
    assert.ok(!dis.some((d) => p.startsWith(d)), p);
  }
  assert.match(String(r.sitemap), /^https?:\/\/.+\/sitemap\.xml$/);
});

test("sitemap: 実在する公開ページだけ。非公開・認証・個人結果を含まない", () => {
  const urls = sitemap().map((e) => new URL(e.url).pathname);
  assert.deepEqual(urls.sort(), ["/", "/privacy", "/stylist/diagnosis", "/terms"]);
  for (const u of urls) assert.equal(isNoindexPath(u), false, u);
  assert.equal(new Set(urls).size, urls.length);
  for (const path of PUBLIC_INDEXABLE_PATHS) {
    const file = path === "/" ? "app/page.tsx" : `app${path}/page.tsx`;
    assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), `${path} のページが存在しない`);
  }
});

test("noindex対象: 主要な非公開ページを網羅し、公開ページを含まない", () => {
  for (const p of [
    "/admin", "/admin/stylists/abc", "/mypage", "/messages/x", "/onboarding", "/profile/edit",
    "/stylist/mypage", "/stylist/profile/preview", "/stylist/diagnosis/student/result", "/stylist/login",
    "/salon", "/salon/mypage", "/salon/stores/1/candidates", "/salon/login", "/salon-culture/result",
    "/diagnosis/result", "/diagnosis/salon", "/login", "/signup", "/signup/salon", "/reset-password",
    "/update-password", "/account-recovery", "/legal/accept", "/auth/callback", "/api/diagnosis/guest",
  ]) assert.equal(isNoindexPath(p), true, p);
  for (const p of ["/", "/stylist/diagnosis", "/privacy", "/terms"]) assert.equal(isNoindexPath(p), false, p);
  assert.ok(NOINDEX_PATH_PREFIXES.every((p) => p.startsWith("/") && !p.endsWith("/")));
});

test("next.config: noindex対象へ X-Robots-Tag を付ける", () => {
  const c = read("next.config.mjs");
  assert.match(c, /NOINDEX_PATH_PREFIXES/);
  assert.match(c, /X-Robots-Tag/);
  assert.match(c, /noindex, nofollow/);
});

test("metadata: canonicalはページごと。ルートに canonical を置かない", () => {
  const home = publicPageMetadata({ title: "t", description: "d", path: "/" });
  const priv = publicPageMetadata({ title: "t", description: "d", path: "/privacy" });
  assert.equal(home.alternates?.canonical, "/");
  assert.equal(priv.alternates?.canonical, "/privacy");
  assert.equal((priv.openGraph as { url?: string }).url, "/privacy");
  assert.ok((priv.openGraph as { images?: unknown[] }).images?.length);
  const root = read("app/layout.tsx");
  assert.match(root, /metadataBase/);
  assert.doesNotMatch(root, /alternates/);
  assert.equal((NOINDEX_METADATA.robots as { index: boolean }).index, false);
  // 公開ページが自分のパスを指定している
  assert.match(read("app/page.tsx"), /path: "\/"/);
  assert.match(read("app/stylist/diagnosis/page.tsx"), /path: "\/stylist\/diagnosis"/);
  assert.match(read("app/privacy/page.tsx"), /path: "\/privacy"/);
  assert.match(read("app/terms/page.tsx"), /path: "\/terms"/);
});

test("OGP画像は既存素材（生成しない）", () => {
  assert.ok(existsSync(new URL("../public/brand/logo.jpg", import.meta.url)));
  assert.match(read("lib/seo/site.ts"), /\/brand\/logo\.jpg/);
});

test("noindexレイアウト: 管理・認証・ログイン入口", () => {
  for (const f of ["app/admin/layout.tsx", "app/(auth)/layout.tsx", "app/stylist/login/layout.tsx", "app/salon/login/layout.tsx", "app/admin/login/layout.tsx"]) {
    assert.match(read(f), /export const metadata = NOINDEX_METADATA/, f);
  }
});
