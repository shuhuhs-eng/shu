import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { determineRoleEntryPath, determinePostAuthPath } from "../lib/auth/post-auth-redirect";
import { isPlatformAdmin } from "../lib/admin/is-admin";
import { PREFECTURES } from "../lib/validation/profile-options";
import { REGION_BLOCKS, REGION_PREFECTURES, regionOf, displayPrefecture, prefecturesMentionedIn } from "../lib/admin/regions";

// is_platform_admin だけを持つ最小の偽クライアント。roles/profile は「運営者でない場合」の既存挙動の確認用。
function fake(rpc: () => Promise<{ data: unknown; error: unknown }> | never, roles: string[] = []) {
  return {
    rpc: async () => rpc(),
    from: (t: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: roles.includes("x") ? {} : null }), limit: () => ({ then: undefined }) }),
          single: async () => ({ data: t === "profiles" ? { onboarding_step: 0, role: "salon" } : null }),
          maybeSingle: async () => ({ data: null }),
        }),
      }),
    }),
  } as never;
}

test("運営者はサロン用ログインでも /admin へ（オンボーディングへ行かない）", async () => {
  const c = fake(async () => ({ data: true, error: null }));
  assert.equal(await determineRoleEntryPath(c, "u1", "salon"), "/admin");
  assert.equal(await determineRoleEntryPath(c, "u1", "stylist"), "/admin");
  assert.equal(await determinePostAuthPath(c, "u1"), "/admin");
});

test("RPCがfalse/エラー/例外のときは運営者として扱わない（安全側）", async () => {
  assert.equal(await isPlatformAdmin(fake(async () => ({ data: false, error: null }))), false);
  assert.equal(await isPlatformAdmin(fake(async () => ({ data: true, error: { message: "x" } }))), false);
  assert.equal(await isPlatformAdmin(fake(async () => { throw new Error("network"); })), false);
  assert.equal(await isPlatformAdmin(fake(async () => ({ data: null, error: null }))), false);
});

test("運営者判定にメールアドレスの文字列を使っていない", () => {
  for (const f of ["lib/admin/is-admin.ts", "lib/admin/guard.ts", "lib/auth/post-auth-redirect.ts"]) {
    const s = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    assert.ok(!/beautyreach\.jp|\.email\b/.test(s), f);
  }
});

test("オンボーディングのページは運営者を /admin へ返す", () => {
  for (const f of ["app/onboarding/page.tsx", "app/onboarding/salon/page.tsx"]) {
    assert.match(readFileSync(f, "utf8"), /isPlatformAdmin\(supabase\)[\s\S]{0,40}redirect\("\/admin"\)/, f);
  }
});

test("47都道府県が漏れなく・重複なく8つの地域ブロックに対応している", () => {
  assert.equal(PREFECTURES.length, 47);
  const all = REGION_BLOCKS.flatMap((b) => [...REGION_PREFECTURES[b]]);
  assert.equal(all.length, 47);
  assert.equal(new Set(all).size, 47);
  for (const p of PREFECTURES) assert.ok(regionOf(p), p);
  assert.deepEqual([...REGION_BLOCKS], ["北海道", "東北", "関東", "中部", "近畿", "中国", "四国", "九州・沖縄"]);
  assert.equal(regionOf("沖縄県"), "九州・沖縄");
  assert.equal(regionOf("神奈川県"), "関東");
});

test("所在地不明は推測せず『未設定』、勤務希望は書かれた都道府県名だけ拾う", () => {
  assert.equal(regionOf(null), null);
  assert.equal(regionOf("横浜"), null);
  assert.equal(displayPrefecture(null), "未設定");
  assert.equal(displayPrefecture(""), "未設定");
  assert.equal(displayPrefecture("横浜市"), "未設定");
  assert.equal(displayPrefecture("東京都"), "東京都");
  assert.deepEqual(prefecturesMentionedIn("神奈川県、東京都どちらも可"), ["東京都", "神奈川県"]);
  assert.deepEqual(prefecturesMentionedIn("横浜か渋谷"), []);
});
