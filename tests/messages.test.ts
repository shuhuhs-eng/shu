import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";

const orig = (Module as unknown as { _load: (...a: unknown[]) => unknown })._load;
(Module as unknown as { _load: (...a: unknown[]) => unknown })._load = function (req: unknown, ...rest: unknown[]) {
  if (req === "server-only") return {};
  return orig.call(this, req, ...rest);
};
let sh: typeof import("../lib/messages/shared");
let rp: typeof import("../lib/messages/rpc");
test.before(async () => { sh = await import("../lib/messages/shared"); rp = await import("../lib/messages/rpc"); });
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("本文・件名: 前後の空白を除き、空や長すぎは弾く", () => {
  assert.deepEqual(sh.parseBody("  こんにちは \n"), { ok: true, value: "こんにちは" });
  assert.equal(sh.parseBody("   ").ok, false);
  assert.equal(sh.parseBody(undefined).ok, false);
  assert.equal(sh.parseBody("あ".repeat(4001)).ok, false);
  assert.equal(sh.parseBody("あ".repeat(4000)).ok, true);
  assert.equal(sh.parseSubject("x".repeat(121)).ok, false);
  assert.equal(sh.parseSubject("x".repeat(120)).ok, true);
});

test("送信ID: URLのridが正しければ再利用（再送で同じID）、不正なら新規", () => {
  const id = "123e4567-e89b-12d3-a456-426614174000";
  assert.equal(sh.requestIdFrom(id, () => "NEW"), id);
  assert.equal(sh.requestIdFrom([id], () => "NEW"), id);
  assert.equal(sh.requestIdFrom("not-a-uuid", () => "NEW"), "NEW");
  assert.equal(sh.requestIdFrom(undefined, () => "NEW"), "NEW");
  assert.match(sh.requestIdFrom(undefined), sh.UUID_RE);
});

test("DBの例外は利用者向けの日本語になり、内部の詳細・権限の有無は漏れない", () => {
  assert.match(sh.mapMessageError("too many replies"), /上限/);
  assert.match(sh.mapMessageError("thread is closed"), /完了/);
  assert.match(sh.mapMessageError("request id content mismatch"), /内容が異なる/);
  assert.equal(sh.mapMessageError("thread not found"), sh.mapMessageError("login required"));
  const unknown = sh.mapMessageError('duplicate key value violates unique constraint "admin_messages_one_request"');
  assert.doesNotMatch(unknown, /constraint|admin_messages/);
});

function client(r: { data?: unknown; error?: { message: string; code?: string } | null }) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  return { calls, rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return { data: r.data ?? null, error: r.error ?? null }; } };
}

test("取得失敗は0件ではなく失敗として返す／存在しない・権限なしの区別", async () => {
  const e = await rp.adminListThreads(client({ error: { message: "boom" } }) as never, { limit: 30, offset: 0 });
  assert.equal(e.ok, false);
  const f = await rp.adminListThreads(client({ error: { message: "admin access required" } }) as never, { limit: 30, offset: 0 });
  assert.ok(!f.ok && f.reason === "forbidden");
  const n = await rp.inboxGet(client({ error: { message: "thread not found" } }) as never, "123e4567-e89b-12d3-a456-426614174000");
  assert.ok(!n.ok && n.reason === "not_found");
  const bad = await rp.inboxGet(client({}) as never, "../../etc");
  assert.ok(!bad.ok && bad.reason === "not_found");
  const c = client({ data: { total: 0, rows: [] } });
  const ok = await rp.inboxList(c as never, 30, 0);
  assert.ok(ok.ok); assert.equal(c.calls[0].fn, "inbox_list_threads");
});

test("サーバー処理: 送信IDをDBへ渡し、失敗は結果として返す（画面が入力と送信IDを保持できる）", () => {
  const a = src("lib/messages/actions.ts");
  for (const fn of ["admin_create_thread", "admin_post_message", "inbox_reply"]) assert.ok(a.includes(`"${fn}"`));
  assert.equal((a.match(/p_request_id: rid/g) ?? []).length, 3);
  assert.equal((a.match(/Promise<ActionResult>/g) ?? []).length, 3);
  assert.doesNotMatch(a.slice(a.indexOf("export async function createThreadAction"), a.indexOf("export async function setThreadStatusAction")), /redirect\(/);
  assert.match(a, /isUuid\(rid\)/);
});

test("入力フォーム: 成功を確認するまで送信IDと入力を保持し、成功後にだけ新しいIDへ", () => {
  const f = src("components/messages/message-form.tsx");
  assert.match(f, /catch \{ setUnknown\(true\)/);          // 結果不明: 保持
  const afterCatch = f.slice(f.indexOf("catch { setUnknown"));
  const failBranch = afterCatch.slice(afterCatch.indexOf("if (!res.ok)"), afterCatch.indexOf("setRid("));
  assert.doesNotMatch(failBranch, /setRid|setBody|setSubject/);   // 失敗: ID・入力を変えない
  assert.equal((f.match(/setRid\(/g) ?? []).length, 1);          // 成功後の1回だけ
  assert.match(f, /UNKNOWN_RESULT_MESSAGE/);
  assert.match(f, /text-\[16px\]/);                              // スマホで拡大されない入力サイズ
});

test("通知メールは送らない（連絡機能のコードにメール送信が無い）", () => {
  for (const f of ["lib/messages/actions.ts", "lib/messages/rpc.ts", "lib/messages/shared.ts", "app/admin/messages/page.tsx", "app/admin/messages/[threadId]/page.tsx", "app/admin/messages/new/page.tsx", "app/messages/page.tsx", "app/messages/[threadId]/page.tsx", "components/messages/message-form.tsx"]) {
    assert.doesNotMatch(src(f), /resend|nodemailer|sendMail|sendEmail|sendgrid|admin_record_delivery/i, f);
  }
});

test("相手側の画面は相手側RPCだけを使い、運営内部の種別・運営用RPCに触れない", () => {
  for (const f of ["app/messages/page.tsx", "app/messages/[threadId]/page.tsx"]) {
    const s = src(f);
    assert.doesNotMatch(s.replace(/\/\*[\s\S]*?\*\//g, ""), /internal_note|offline_log|adminGetThread|adminListThreads|requireAdminPage/, f);
  }
  assert.match(src("app/messages/[threadId]/page.tsx"), /inboxGet/);
});

test("運営の画面は入口で運営者を確認し、操作はサーバー処理でも運営者を確認する", () => {
  for (const f of ["app/admin/messages/page.tsx", "app/admin/messages/[threadId]/page.tsx", "app/admin/messages/new/page.tsx"]) assert.match(src(f), /requireAdminPage/, f);
  const a = src("lib/messages/actions.ts");
  assert.equal((a.match(/isPlatformAdmin\(supabase\)/g) ?? []).length, 3);
});

test("宛先が権限を失った場合も運営は閲覧でき、表示で区別する", () => {
  const d = src("app/admin/messages/[threadId]/page.tsx");
  assert.match(d, /recipient_access_lost/); assert.match(d, /salon_reader_count/);
  assert.match(d, /完了にする/); assert.match(d, /再開する/);
  assert.match(src("components/messages/cards.tsx"), /recipient_access_lost/);
});

test("本文はHTMLとして解釈しない（dangerouslySetInnerHTMLを使わない）", () => {
  assert.doesNotMatch(src("components/messages/thread-view.tsx"), /dangerouslySetInnerHTML/);
});

test("Server→Clientで関数を渡さない（連絡作成画面が「一時的に表示できません」になった原因の再発防止）", () => {
  const form = src("components/messages/message-form.tsx");
  assert.doesNotMatch(form, /goToThread|newRequestId/);
  assert.match(form, /threadPathPrefix\?: string/);
  for (const f of ["app/admin/messages/new/page.tsx", "app/admin/messages/[threadId]/page.tsx", "app/messages/[threadId]/page.tsx"]) {
    const m = src(f).match(/<MessageForm[\s\S]*?\/>/);
    assert.ok(m, f);
    assert.doesNotMatch(m![0], /=\{\s*\(?\w*\)?\s*=>/, `${f}: MessageFormに関数propを渡していない`);
  }
});

test("管理画面のエラーは「管理画面へ戻る」→/admin、一般画面は従来どおり「トップへ戻る」→/、ナビに「サイトのホームへ」→/", () => {
  const ae = src("app/admin/error.tsx");
  assert.match(ae, /homeHref="\/admin"/); assert.match(ae, /管理画面へ戻る/);
  assert.match(src("components/error-panel.tsx"), /homeHref = "\/"/); assert.match(src("components/error-panel.tsx"), /トップへ戻る/);
  assert.doesNotMatch(src("app/error.tsx"), /homeHref/);
  assert.match(src("components/admin/admin-nav.tsx"), /href: "\/", label: "サイトのホームへ"/);
});

test("権限確認は維持: エラー画面・ナビの変更で管理画面の入口の確認は外れていない", () => {
  assert.match(src("app/admin/layout.tsx"), /is_platform_admin/);
  assert.match(src("lib/admin/guard.ts"), /isPlatformAdmin/);
  assert.match(src("app/admin/messages/new/page.tsx"), /requireAdminPage/);
});
