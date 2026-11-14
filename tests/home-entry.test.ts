import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { determineAdminEntryPath } from "../lib/auth/post-auth-redirect";

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
const rpcClient = (r: { data?: unknown; error?: unknown } | "throw") => ({ rpc: async () => { if (r === "throw") throw new Error("net"); return { data: r.data ?? null, error: r.error ?? null }; } }) as never;

test("管理者入口: 管理者だけ /admin へ。next は /admin 配下のみ許可。メールでは判定しない", async () => {
  assert.deepEqual(await determineAdminEntryPath(rpcClient({ data: true }), null), { ok: true, path: "/admin" });
  assert.deepEqual(await determineAdminEntryPath(rpcClient({ data: true }), "/admin/messages"), { ok: true, path: "/admin/messages" });
  for (const bad of ["/salon/mypage", "//evil.example", "/administrator", "https://evil.example/admin"]) assert.deepEqual(await determineAdminEntryPath(rpcClient({ data: true }), bad), { ok: true, path: "/admin" });
  assert.deepEqual(await determineAdminEntryPath(rpcClient({ data: false }), "/admin"), { ok: false, reason: "not_admin" });
  for (const r of [{ error: { message: "x" } }, { data: null }, { data: "yes" }, "throw"] as const) assert.deepEqual(await determineAdminEntryPath(rpcClient(r as never)), { ok: false, reason: "check_failed" });
  assert.doesNotMatch(strip(src("lib/auth/post-auth-redirect.ts")), /email|@beautyreach/i);
});

test("ログイン処理: 入口はServer Actionで分ける。一般ログインは管理者を拒否しセッション破棄、管理者入口は is_platform_admin で判定", () => {
  const a = src("lib/auth/actions.ts");
  const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const ad = strip(a.slice(a.indexOf("export async function adminSignInAction("), a.indexOf("/**\n * 一般ログイン")));
  const gen = strip(a.slice(a.indexOf("export async function signInAction("), a.indexOf("export async function requestPasswordResetAction(")));
  // 管理者専用: is_platform_admin（determineAdminEntryPath）で判定。拒否時はこのセッションのみ破棄。フォーム値では分岐しない。
  assert.match(ad, /determineAdminEntryPath/); assert.match(ad, /redirect\(adminEntry\.path\)/); assert.match(ad, /discardThisSession/);
  assert.doesNotMatch(ad, /entryMode/);
  // 一般: 管理者は拒否（文言固定）、確認不能も拒否、いずれもセッション破棄。entryMode=admin 等のフォーム値で通れない。
  assert.match(gen, /getAdminStatus\(supabase\)/);
  assert.match(gen, /adminStatus === "admin"[\s\S]*?discardThisSession[\s\S]*?ADMIN_USE_ADMIN_LOGIN_MESSAGE/);
  assert.match(gen, /adminStatus === "error"[\s\S]*?discardThisSession/);
  assert.doesNotMatch(gen, /entryMode"\) === "admin"|determineAdminEntryPath|redirect\(adminEntry/);
  assert.ok(gen.indexOf("getAdminStatus") < gen.indexOf("safeInternalPath"), "管理者拒否は next の復帰より前");
  assert.doesNotMatch(a, /^export (const|let|var) /m, "\"use server\" のファイルは async 関数しかexportできない（ビルドエラーになる）");
  assert.match(a, /ADMIN_USE_ADMIN_LOGIN_MESSAGE = "管理者の方は、管理者ログインをご利用ください。"/);
  assert.match(a, /signOut\(\{ scope: "local" \}\)/);          // 他端末のセッションを巻き込まない
  assert.doesNotMatch(a.slice(a.indexOf("async function authenticateWithPassword"), a.indexOf("requestPasswordResetAction")), /auth\.signOut\(\)/);
  assert.match(src("app/(auth)/login/login-form.tsx"), /mode === "admin" \? adminSignInAction : signInAction/);
});

test("管理者専用ログイン画面: サロン名・店舗の入力なし、新規登録なし、共通のログイン処理を使う", () => {
  const f = src("app/(auth)/login/login-form.tsx");
  assert.match(f, /admin: \{[\s\S]*?heading: "管理者ログイン"[\s\S]*?signupHref: null/);
  assert.match(f, /mode === "stylist" \|\| mode === "admin" \? null/);
  const p = src("app/admin/login/page.tsx");
  assert.match(p, /<LoginForm mode="admin"/); assert.match(p, /getAdminStatus/);
  assert.doesNotMatch(strip(p), /store|organization|サロン名|店舗/i);
});

test("トップ: 「あなたのタイプ」見出し・30問診断の導線を維持し、サロン入口は小さく、管理者入口は文字リンク", () => {
  const h = strip(src("app/page.tsx"));
  assert.match(h, />あなたのタイプ<\/h2>/); assert.doesNotMatch(h, />美容師の方<\/h2>/);
  assert.match(h, /30問で[\s\S]{0,12}診断する/); assert.match(h, /href="\/stylist\/login"/);
  assert.match(h, />\s*サロンの方のログインはこちら\s*</); assert.doesNotMatch(h, /美容師としてログイン|サロンとしてログイン/); assert.match(h, /href="\/salon\/login"/);
  assert.match(h, /href="\/signup\/salon"[\s\S]{0,120}新規登録（受付）/);   // 新規受付は別の導線
  assert.match(h, /href="\/admin\/login"[\s\S]{0,120}管理者の方はこちら/);
  assert.doesNotMatch(h, /サロンの方<\/h2>/);
  assert.match(h, /basis-\[calc\(25%/);   // PCは従来のおよそ半分の幅
  assert.doesNotMatch(h, /マイページ（管理画面へ）/);
});

test("ヘッダー: 管理者のみ「管理画面へ」（ログアウトの左）。一般は「マイページ」。未ログインには出ない", () => {
  const h = src("app/page.tsx");
  const bar = h.slice(h.indexOf("{user && ("), h.indexOf("Hero行"));
  assert.match(bar, /isAdmin \? \([\s\S]*?href="\/admin"[\s\S]*?管理画面へ/);
  assert.match(bar, /href="\/mypage"[\s\S]*?マイページ/);
  assert.ok(bar.indexOf("管理画面へ") < bar.indexOf("signOutAction"), "管理画面へ は ログアウトより左（前）");
  assert.match(h, /const adminStatus = user \? await getAdminStatus\(supabase\) : "not_admin"/);
});

test("アクセス制御は画面の表示だけに頼らない（/admin 配下の入口確認は従来どおり）", () => {
  assert.match(src("app/admin/layout.tsx"), /is_platform_admin/);
  assert.match(src("lib/admin/guard.ts"), /isPlatformAdmin/);
  assert.match(src("app/admin/page.tsx"), /if \(!isAdmin\) redirect\("\/mypage"\)/);
});

test("表示文言: トップの美容師ログインは「ログイン」、サロン入口は「サロンの方のログインはこちら」。ログイン画面の見出しは「ログイン」「サロンログイン」。管理者ログインは変更しない", () => {
  const h = strip(src("app/page.tsx"));
  assert.match(h, /href="\/stylist\/login"[\s\S]{0,400}?>\s*ログイン\s*<ArrowRight/);
  assert.match(h, /href="\/salon\/login"[\s\S]{0,400}?>\s*サロンの方のログインはこちら\s*<ArrowRight/);
  const f = src("app/(auth)/login/login-form.tsx");
  assert.match(f, /stylist: \{\s*heading: "ログイン"/); assert.match(f, /salon: \{\s*heading: "サロンログイン"/);
  assert.match(f, /heading: "管理者ログイン"/);
  assert.match(f, /heading: copy\?\.heading \?\? "ログイン"|\{copy\?\.heading \?\? "ログイン"\}/);
  for (const t of [h, strip(f), strip(src("app/stylist/login/page.tsx")), strip(src("app/salon/login/page.tsx")), strip(src("app/stylist/login/layout.tsx")), strip(src("app/salon/login/layout.tsx"))]) assert.doesNotMatch(t, /美容師としてログイン|サロンとしてログイン/);
  assert.match(h, /href="\/admin\/login"[\s\S]{0,120}管理者の方はこちら/);
});

test("PC: 大きなイラスト(xl)＋サロン入口は左下の小さな枠、lgは縮小イラスト＋右端", () => {
  const c = src("components/home/hero-character.tsx");
  assert.match(c, /h-\[375px\]/); assert.match(c, /xl:h-\[470px\]/);
  assert.match(c, /xl:bottom-\[-125px\]/);
  const p = src("app/page.tsx");
  assert.match(p, /xl:ml-0/);
  assert.match(p, /xl:basis-\[calc\(21%/);
  assert.match(p, /lg:whitespace-nowrap/);   // 狭いPC幅でも「サロンログイン」が1行
});
