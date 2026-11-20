import { classifyFind } from "../lib/email/outbox-search";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NOTICE_KEYS, buildLink, isNoticeKey, renderMail } from "../lib/email/templates";
import { CaptureProvider, ResendProvider, classifyHttpStatus, createMailProvider } from "../lib/email/provider";
import { runEmailWorker, BATCH_SIZE, SEND_TIMEOUT_MS, DEFAULT_BUDGET_MS, LEASE_SECONDS } from "../lib/email/worker";

const LINK = "https://example.test/salon/stores/abc/interests";
// 「確定した」と読める表現・個人を特定できる中身は、どのメールにも入れない
const FORBIDDEN = ["おめでとう", "採用が決定", "採用決定", "内定", "確定しました", "予約が完了", "予約完了", "参加が決まり", "合格", "年収", "給与", "円"];

test("全ての通知メールの文面: 固定文＋リンクだけ。確定を思わせる語・金額を含まない", () => {
  for (const k of NOTICE_KEYS) {
    const m = renderMail(k, LINK)!;
    assert.ok(m, k);
    assert.ok(m.text.includes(LINK), `${k} にリンクがある`);
    for (const w of FORBIDDEN) { assert.ok(!m.subject.includes(w) && !m.text.includes(w), `${k} に「${w}」が無い`); }
    assert.ok(m.subject.startsWith("【Beauty Reach】"));
  }
});

test("見学・体験入店の希望メールは「日程や参加はまだ確定していません」と明記する", () => {
  for (const k of ["interest_visit", "interest_trial", "scout_reply_visit", "scout_reply_trial"] as const) {
    assert.ok(renderMail(k, LINK)!.text.includes("まだ確定していません"), k);
  }
});

test("取消の訂正連絡: 直接希望のみ。希望が取り消されたことと、調整中・確定済みの日程は運営へ確認する旨を伝え、元の通知の日時を添える", () => {
  for (const k of ["interest_visit", "interest_trial", "interest_generic"]) {
    const m = renderMail(`cancel_${k}`, LINK, { notifiedAt: "2026-11-20T01:30:00Z" })!;
    assert.ok(m.text.includes("希望が取り消されました"));
    assert.ok(m.text.includes("調整中・確定済みの日程がある場合は、運営へご確認ください"));
    assert.ok(m.text.includes("2026/11/20 10:30") || m.text.includes("2026年11月20日 10:30") || m.text.includes("10:30"), "元の通知の日時（日本時間）を添える");
    assert.ok(m.subject.includes("取り消されました"));
    assert.ok(!m.text.includes("対応は不要"), "対応不要とは書かない（調整が進んでいる場合があるため）");
  }
  assert.ok(!renderMail("cancel_interest_visit", LINK)!.text.includes("参照:"), "日時が無いときは参照を書かない");
  for (const k of ["scout_received", "hiring_update"]) assert.equal(renderMail(`cancel_${k}`, LINK), null);
  assert.equal(renderMail("nope", LINK), null);
  assert.equal(renderMail("cancel_nope", LINK), null);
  assert.ok(!isNoticeKey("cancel_interest_visit"));
});

test("連絡・条件・実績・年齢開示・面接の要対応: 種類も中身も書かず「画面に連絡がある」ことだけを伝える", () => {
  for (const k of ["message_received", "message_reply_received", "offer_update", "evidence_update", "age_disclosure_update", "action_required"]) {
    const m = renderMail(k, LINK)!;
    assert.ok(m.subject.includes("画面に") && m.text.includes("画面"), k);
    for (const w of ["オファー", "条件", "年齢", "実績", "承諾", "辞退", "却下", "差し戻し"]) assert.ok(!m.subject.includes(w) && !m.text.includes(w), `${k} に「${w}」が無い`);
  }
});

test("リンク: 相対パスのみ許可。外部URL・プロトコル相対・空白入りは作らない", () => {
  assert.equal(buildLink("https://example.test/", "/salon/x"), "https://example.test/salon/x");
  for (const bad of ["https://evil.test/x", "//evil.test", "salon/x", "", null, "/a b", "/a\\b"]) assert.equal(buildLink("https://example.test", bad as string | null), null, String(bad));
  assert.equal(buildLink("javascript:alert(1)", "/x"), null);
  assert.equal(buildLink("", "/x"), null);
});

test("DBのテンプレートキー一覧（0100の email_template_keys() から生成した固定データ）と、アプリの文面が過不足なく対応する", () => {
  const fx = JSON.parse(readFileSync(path.join(process.cwd(), "tests/fixtures/email-template-keys.json"), "utf8")) as { keys: string[] };
  const dbKeys = [...fx.keys].sort();
  const appKeys = [...NOTICE_KEYS.map(String), "cancel_interest_visit", "cancel_interest_trial", "cancel_interest_generic"].sort();
  assert.deepEqual(dbKeys, appKeys);
  for (const k of dbKeys) assert.ok(renderMail(k, LINK), `${k} は文面を作れる`);
});

test("HTTPステータスの分類: 2xx=送信済み／429=再試行／4xx=拒否／5xx=結果不明（二重送信を避ける）", () => {
  assert.equal(classifyHttpStatus(200), "sent");
  assert.equal(classifyHttpStatus(202), "sent");
  assert.equal(classifyHttpStatus(429), "retry");
  for (const s of [400, 401, 403, 422]) assert.equal(classifyHttpStatus(s), "rejected");
  for (const s of [500, 502, 503, 504]) assert.equal(classifyHttpStatus(s), "unknown");
});

test("Resend: 冪等キー付きで送り、通信断・タイムアウトは結果不明、本文が読めなくても2xxは送信済み", async () => {
  let seen: { headers: Record<string, string>; body: string } | null = null;
  const ok = new ResendProvider("k", "from@x.test", (async (_u: unknown, init: RequestInit) => { seen = { headers: init.headers as Record<string, string>, body: String(init.body) }; return new Response(JSON.stringify({ id: "m1" }), { status: 200 }); }) as unknown as typeof fetch);
  const r = await ok.send({ to: "a@b.test", subject: "s", text: "t", idempotencyKey: "KEY-1" });
  assert.deepEqual(r, { kind: "sent", messageId: "m1" });
  assert.equal(seen!.headers["Idempotency-Key"], "KEY-1");
  assert.ok(!seen!.body.includes("k\""), "APIキーは本文に入らない");
  const down = new ResendProvider("k", "f@x.test", (async () => { throw new Error("socket hang up"); }) as unknown as typeof fetch);
  assert.equal((await down.send({ to: "a@b.test", subject: "s", text: "t", idempotencyKey: "K" })).kind, "unknown");
  const bad = new ResendProvider("k", "f@x.test", (async () => new Response("{}", { status: 503 })) as unknown as typeof fetch);
  assert.equal((await bad.send({ to: "a@b.test", subject: "s", text: "t", idempotencyKey: "K" })).kind, "unknown");
  const nobody = new ResendProvider("k", "f@x.test", (async () => new Response("not json", { status: 200 })) as unknown as typeof fetch);
  assert.deepEqual(await nobody.send({ to: "a@b.test", subject: "s", text: "t", idempotencyKey: "K" }), { kind: "sent", messageId: null });
});

test("プロバイダー選択: 既定は送らない／captureは本番で拒否／resendは設定不足で失敗", () => {
  assert.equal(createMailProvider({}).name, "disabled");
  assert.equal(createMailProvider({ EMAIL_PROVIDER: "disabled" }).name, "disabled");
  assert.equal(createMailProvider({ EMAIL_PROVIDER: "capture" }).name, "capture");
  assert.throws(() => createMailProvider({ EMAIL_PROVIDER: "capture", VERCEL_ENV: "production" }));
  assert.throws(() => createMailProvider({ EMAIL_PROVIDER: "resend" }));
  assert.equal(createMailProvider({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "x", EMAIL_FROM: "a@b.test" }).name, "resend");
});

test("captureプロバイダー: ファイルに書くだけ（実配信なし）。宛先で失敗を再現できる", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mailcap-"));
  const p = new CaptureProvider(dir);
  assert.equal((await p.send({ to: "ok@x.test", subject: "s", text: "t", idempotencyKey: "id1" })).kind, "sent");
  assert.deepEqual(readdirSync(dir), ["id1.json"]);
  assert.equal((await p.send({ to: "fail-retry@x.test", subject: "s", text: "t", idempotencyKey: "id2" })).kind, "retry");
  assert.equal((await p.send({ to: "fail-reject@x.test", subject: "s", text: "t", idempotencyKey: "id3" })).kind, "rejected");
  assert.equal((await p.send({ to: "fail-unknown@x.test", subject: "s", text: "t", idempotencyKey: "id4" })).kind, "unknown");
  assert.equal(readdirSync(dir).length, 1, "失敗の再現ではファイルを作らない");
});

// --- ワーカー（DBの代わりに偽のRPCを使う）---
type Conf = { ok: boolean; reason: string; recipient_email: string | null; notified_at: string | null };
const okConf = (email = "u@x.test"): Conf => ({ ok: true, reason: "ok", recipient_email: email, notified_at: "2026-11-20T01:30:00Z" });
function fakeClient(batches: unknown[][], confirm: (id: string, n: number) => Conf | "error", finishResult: (id: string) => string = () => "applied", releaseResult: (id: string) => string | "error" = () => "released") {
  const finished: { id: string; attempt: string; outcome: string; err: string | null; msg: string | null }[] = [];
  const calls: string[] = [];
  const released: { id: string; attempt: string }[] = [];
  let b = 0, confirms = 0;
  return {
    finished, calls, released,
    client: { rpc: async (name: string, a: Record<string, unknown>) => {
      calls.push(name);
      if (name === "email_outbox_claim") return { data: batches[b++] ?? [], error: null };
      if (name === "email_outbox_confirm_send") { const c = confirm(String(a.p_id), confirms++); return c === "error" ? { data: null, error: { code: "X" } } : { data: [c], error: null }; }
      if (name === "email_outbox_finish") { finished.push({ id: String(a.p_id), attempt: String(a.p_attempt), outcome: String(a.p_outcome), err: (a.p_error as string) ?? null, msg: (a.p_provider_message_id as string) ?? null }); return { data: finishResult(String(a.p_id)), error: null }; }
      if (name === "email_outbox_release") { released.push({ id: String(a.p_id), attempt: String(a.p_attempt) }); const r = releaseResult(String(a.p_id)); return r === "error" ? { data: null, error: { code: "X" } } : { data: r, error: null }; }
      return { data: null, error: { code: "unknown_rpc" } };
    } },
  };
}
const row = (id: string, key = "interest_visit", link: string | null = "/salon/stores/s/interests") => ({ outbox_id: id, attempt_id: `att-${id}`, mail_kind: "notice", template_key: key, link_path: link, attempts: 1 });
const SITE = "https://example.test";

test("ワーカー: 取り出し→送信直前に再確認→送信→結果記録。確認が止めた行は送らず結果も記録しない。宛先は確認が返した「いま」のメール", async () => {
  const sent: { to: string; key: string }[] = [];
  const provider = { name: "t", send: async (m: { to: string; idempotencyKey: string }) => { sent.push({ to: m.to, key: m.idempotencyKey }); return { kind: "sent" as const, messageId: `p-${m.idempotencyKey}` }; } };
  const f = fakeClient([[row("a"), row("b"), row("c", "cancel_interest_trial")]], (id) => id === "b" ? { ok: false, reason: "cancelled", recipient_email: null, notified_at: null } : okConf(`now-${id}@x.test`));
  const res = await runEmailWorker({ client: f.client, provider, workerId: "w", siteUrl: SITE });
  assert.deepEqual(sent, [{ to: "now-a@x.test", key: "a" }, { to: "now-c@x.test", key: "c" }]);
  assert.deepEqual(res, { claimed: 3, sent: 2, retried: 0, rejected: 0, unknown: 0, skippedCancelled: 1, skippedDisabled: 0, stale: 0, deferred: 0, released: 0, releaseFailed: 0, batches: 1 });
  assert.deepEqual(f.finished.map((x) => [x.id, x.attempt, x.outcome, x.msg]), [["a", "att-a", "sent", "p-a"], ["c", "att-c", "sent", "p-c"]]);
});

test("ワーカー: 冪等キーは送信待ちのID（同じ行を再送しても外部サービス側で重複しない）", async () => {
  const keys: string[] = [];
  const provider = { name: "t", send: async (m: { idempotencyKey: string }) => { keys.push(m.idempotencyKey); return { kind: "sent" as const, messageId: null }; } };
  const f = fakeClient([[row("id-123")]], () => okConf());
  await runEmailWorker({ client: f.client, provider, workerId: "w", siteUrl: SITE });
  assert.deepEqual(keys, ["id-123"]);
});

test("ワーカー: 失敗の種類を区別して記録し、1件の失敗で他の送信は止まらない・例外でも結果不明として記録", async () => {
  const provider = { name: "t", send: async (m: { to: string }) => {
    if (m.to.startsWith("r")) return { kind: "retry" as const, error: "http_429" };
    if (m.to.startsWith("x")) return { kind: "rejected" as const, error: "http_422" };
    if (m.to.startsWith("e")) throw new Error("boom");
    return { kind: "sent" as const, messageId: "ok" };
  } };
  const addr: Record<string, string> = { "1": "r@x", "2": "x@x", "3": "e@x", "4": "o@x" };
  const f = fakeClient([[row("1"), row("2"), row("3"), row("4")]], (id) => okConf(addr[id]));
  const res = await runEmailWorker({ client: f.client, provider, workerId: "w", siteUrl: SITE });
  assert.deepEqual(f.finished.map((x) => x.outcome), ["retry", "rejected", "unknown", "sent"]);
  assert.equal(res.sent, 1); assert.equal(res.retried, 1); assert.equal(res.rejected, 1); assert.equal(res.unknown, 1);
});

test("ワーカー: 未知のテンプレート・不正なリンクは送信直前の確認（送信開始の記録）より前に『拒否』で終える", async () => {
  let n = 0;
  const provider = { name: "t", send: async () => { n++; return { kind: "sent" as const, messageId: null }; } };
  const f = fakeClient([[row("1", "weird_key"), row("2", "interest_visit", "https://evil.test/x")]], () => okConf());
  await runEmailWorker({ client: f.client, provider, workerId: "w", siteUrl: SITE });
  assert.equal(n, 0);
  assert.deepEqual(f.finished.map((x) => [x.outcome, x.err]), [["rejected", "unknown_template"], ["rejected", "bad_link_or_site_url"]]);
  assert.ok(!f.calls.includes("email_outbox_confirm_send"));
});

test("ワーカー: 送信直前の確認が通信エラーなら送らない（記録もしない＝期限切れで安全側に倒れる）", async () => {
  let n = 0;
  const provider = { name: "t", send: async () => { n++; return { kind: "sent" as const, messageId: null }; } };
  const f = fakeClient([[row("1")]], () => "error");
  await runEmailWorker({ client: f.client, provider, workerId: "w", siteUrl: SITE });
  assert.equal(n, 0);
  assert.equal(f.finished.length, 0);
});

test("ワーカー: 取り出し自体の失敗は例外（呼び出し側で500・業務処理には影響しない）", async () => {
  const client = { rpc: async () => ({ data: null, error: { code: "42501" } }) };
  await assert.rejects(runEmailWorker({ client, provider: { name: "t", send: async () => ({ kind: "sent", messageId: null }) }, workerId: "w", siteUrl: SITE }));
});

test("停止（取り出し後）: 1通目を送った後に停止されたら、2通目以降は外部送信を始めない。確認が『disabled』を返す", async () => {
  const sent: string[] = [];
  const provider = { name: "t", send: async (m: { idempotencyKey: string }) => { sent.push(m.idempotencyKey); return { kind: "sent" as const, messageId: "ok" }; } };
  const f = fakeClient([[row("1"), row("2"), row("3")]], (_id, n) => n === 0 ? okConf() : { ok: false, reason: "disabled", recipient_email: null, notified_at: null });
  const res = await runEmailWorker({ client: f.client, provider, workerId: "w", siteUrl: SITE });
  assert.deepEqual(sent, ["1"]);
  assert.equal(res.sent, 1); assert.equal(res.skippedDisabled, 2); assert.equal(res.skippedCancelled, 0);
  assert.deepEqual(f.finished.map((x) => x.id), ["1"], "停止で止めた行は結果を記録しない（DBが待ちへ戻す）");
  assert.equal(f.calls.filter((c) => c === "email_outbox_claim").length, 1, "停止を検知したら次の取り出しはしない");
});

test("古い試行の結果: 結果の記録が stale を返した件数を数える（DBが反映しない。ワーカーは再送も上書きもしない）", async () => {
  const provider = { name: "t", send: async () => ({ kind: "sent" as const, messageId: "m" }) };
  const f = fakeClient([[row("1"), row("2")]], () => okConf(), (id) => id === "1" ? "stale" : "applied");
  const res = await runEmailWorker({ client: f.client, provider, workerId: "w", siteUrl: SITE });
  assert.equal(res.stale, 1); assert.equal(res.sent, 2);
  assert.deepEqual(f.finished.map((x) => x.attempt), ["att-1", "att-2"], "どの結果にも試行の識別子を付けて送る");
});

test("時間予算: 20通×15秒（300秒）は予算50秒・リース120秒に収まらないので、小バッチ＋予算で打ち切る（偽の時計）", async () => {
  assert.equal(BATCH_SIZE, 5);
  assert.ok(BATCH_SIZE * SEND_TIMEOUT_MS <= 120_000 * 0.75, "1バッチの最悪時間がリース(120秒)に収まる");
  assert.ok(DEFAULT_BUDGET_MS + SEND_TIMEOUT_MS <= 65_000 && LEASE_SECONDS === 120);
  let clock = 0;
  const provider = { name: "t", send: async () => { clock += SEND_TIMEOUT_MS; return { kind: "unknown" as const, error: "timeout" }; } };  // 毎回15秒かかって結果不明
  const mk = (p: string) => Array.from({ length: BATCH_SIZE }, (_, i) => row(`${p}${i}`));
  const f = fakeClient([mk("a"), mk("b"), mk("c"), mk("d")], () => okConf());
  const started = clock;
  const res = await runEmailWorker({ client: f.client, provider, workerId: "w", siteUrl: SITE, now: () => clock });
  assert.ok(clock - started <= DEFAULT_BUDGET_MS, `使った時間 ${clock - started}ms は予算内`);
  assert.equal(res.unknown, 3, "50秒のうち、15秒かかる送信は最大3通（4通目は残り時間が足りず始めない）");
  assert.equal(res.deferred, BATCH_SIZE - 3, "取り出し済みで触れなかった行はリース期限後に待ちへ戻る");
  assert.equal(res.batches, 1);
  assert.equal(f.calls.filter((c) => c === "email_outbox_confirm_send").length, 3, "触れなかった行は確認（送信開始の記録）もしない");
});

test("時間予算: 確認RPCが遅れて残りが足りなくなったら、外部送信せず待ちへ戻す（試行の識別子つき）。後続の行は触れない", async () => {
  let clock = 0;
  const sent: string[] = [];
  const provider = { name: "t", send: async (m: { idempotencyKey: string }) => { sent.push(m.idempotencyKey); clock += 1_000; return { kind: "sent" as const, messageId: "p" }; } };
  // 3通目の確認だけ極端に遅い（35秒）。確認前は残り≥15秒だが、確認後は残り<15秒になる
  const f = fakeClient([[row("a"), row("b"), row("c"), row("d"), row("e")]], (id) => { if (id === "c") clock += 35_000; return okConf(); });
  const res = await runEmailWorker({ client: f.client, provider, workerId: "w", siteUrl: SITE, now: () => clock });
  assert.deepEqual(sent, ["a", "b"], "遅れた行(c)以降は外部送信を始めない");
  assert.deepEqual(f.released, [{ id: "c", attempt: "att-c" }]);
  assert.equal(res.released, 1); assert.equal(res.releaseFailed, 0); assert.equal(res.deferred, 2, "d, e は確認もしない");
  assert.equal(f.calls.filter((c) => c === "email_outbox_confirm_send").length, 3);
  assert.deepEqual(f.finished.map((x) => x.id), ["a", "b"], "戻した行の結果は記録しない");
});

test("時間予算: 待ちへ戻す記録が失敗しても、外部送信はしない・ログに残す・数える（再送しない）", async () => {
  let clock = 0; let sent = 0;
  const provider = { name: "t", send: async () => { sent++; return { kind: "sent" as const, messageId: "p" }; } };
  const f = fakeClient([[row("a")]], () => { clock += 40_000; return okConf(); }, () => "applied", () => "error");
  const res = await runEmailWorker({ client: f.client, provider, workerId: "w", siteUrl: SITE, now: () => clock });
  assert.equal(sent, 0); assert.equal(res.releaseFailed, 1); assert.equal(res.released, 0);
});

test("時間予算: 戻す時点で既に古い試行（stale）なら何もしない（失敗扱いにしない）", async () => {
  let clock = 0;
  const f = fakeClient([[row("a")]], () => { clock += 40_000; return okConf(); }, () => "applied", () => "stale");
  const res = await runEmailWorker({ client: f.client, provider: { name: "t", send: async () => ({ kind: "sent", messageId: null }) }, workerId: "w", siteUrl: SITE, now: () => clock });
  assert.equal(res.released, 0); assert.equal(res.releaseFailed, 0);
});

test("時間予算の最悪ケース: 確認前の判定を通った送信は予算内に終わり、結果の記録にmaxDuration(60秒)までの余裕が残る", () => {
  assert.ok(DEFAULT_BUDGET_MS <= 50_000);
  assert.ok(60_000 - DEFAULT_BUDGET_MS >= 10_000, "finish用の余裕は10秒以上");
});

test("時間予算: 予算が尽きていれば取り出しもしない", async () => {
  const f = fakeClient([[row("1")]], () => okConf());
  const res = await runEmailWorker({ client: f.client, provider: { name: "t", send: async () => ({ kind: "sent", messageId: null }) }, workerId: "w", siteUrl: SITE, budgetMs: 1_000 });
  assert.equal(res.claimed, 0); assert.equal(f.calls.length, 0);
});

test("取消の訂正連絡: 確認が返した元の通知の日時を文面に使う", async () => {
  const bodies: string[] = [];
  const provider = { name: "t", send: async (m: { text: string }) => { bodies.push(m.text); return { kind: "sent" as const, messageId: null }; } };
  const f = fakeClient([[{ ...row("1", "cancel_interest_visit"), mail_kind: "cancel_correction" }]], () => okConf());
  await runEmailWorker({ client: f.client, provider, workerId: "w", siteUrl: SITE });
  assert.ok(bodies[0].includes("10:30") && bodies[0].includes("希望が取り消されました"));
});

// --- 運営画面・利用者設定の静的な取り決め ---
const src = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");
test("運営の操作: 「受理されていない」と「受理後の不達」の根拠を混ぜない（画面とサーバー操作が同じ分け方）", () => {
  const a = src("app/admin/email-outbox/actions.ts"), pg = src("app/admin/email-outbox/page.tsx");
  assert.ok(a.includes('BASIS_NOT_DELIVERED = new Set(["provider_not_accepted"])'));
  assert.ok(a.includes('"provider_bounced", "provider_rejected"') && a.includes("mark_undeliverable") && a.includes("annotate"));
  assert.ok(!pg.includes("provider_rejected_or_bounced") && !a.includes("provider_rejected_or_bounced"));
  assert.ok(pg.includes('value="mark_undeliverable"') && pg.includes('name="provider_ref"') && pg.includes("bounced:"));
  assert.ok(pg.includes("unrouted_replies"));
});
test("利用者のメール設定: 自分の分だけ・既定オン・戻り先は固定の許可リスト・認証が無ければ設定しない", () => {
  const a = src("app/notification-settings/actions.ts"), c = src("components/notifications/email-notification-setting.tsx");
  assert.ok(a.includes('new Set(["/stylist/mypage", "/salon/mypage"])') && a.includes("auth.getUser()") && a.includes('"set_my_email_notifications"'));
  assert.ok(!a.includes("p_user") && !a.includes("user_id"), "対象の利用者を引数で受け取らない（本人のみ）");
  assert.ok(c.includes('"get_my_email_notifications"') && c.includes(": true;") && c.includes("サイト内の通知とログイン・パスワード再設定のメールは変わりません"));
  assert.ok(src("app/stylist/mypage/page.tsx").includes("<EmailNotificationSetting") && src("app/salon/mypage/page.tsx").includes("<EmailNotificationSetting"));
});

test("運営画面: 送信済みメールを特定して後日の不達を記録できる（完全一致の検索・sentにだけ不達ボタン・受理確認の文言は到着と区別）", () => {
  const pg = src("app/admin/email-outbox/page.tsx");
  assert.ok(pg.includes('"admin_email_outbox_find"') && pg.includes('data-testid="found-row"') && pg.includes('f.status === "sent"') && pg.includes("受理後に不達と記録"));
  assert.ok(pg.includes("送信サービスが受理（受信箱への到着は未確認）") && pg.includes("受信箱への到着を確認"));
  assert.ok(!pg.includes(">届いていた<"));
});

test("運営画面の検索: 成功・正常な0件・RPC失敗を分ける（失敗を「該当なし」にしない）", () => {
  assert.equal(classifyFind(null), null, "検索していない");
  assert.deepEqual(classifyFind<{ id: string }>({ data: [{ id: "a" }], error: null }), { failed: false, rows: [{ id: "a" }] });
  assert.deepEqual(classifyFind({ data: [], error: null }), { failed: false, rows: [] }, "正常な0件");
  assert.deepEqual(classifyFind({ data: null, error: { code: "X" } }), { failed: true, rows: [] }, "RPCエラー");
  assert.deepEqual(classifyFind({ data: [{ id: "a" }], error: { code: "X" } }), { failed: true, rows: [] }, "エラーがあれば行は使わない");
  assert.deepEqual(classifyFind({ data: { not: "array" }, error: null }), { failed: true, rows: [] }, "想定外の形");
  const pg = src("app/admin/email-outbox/page.tsx");
  assert.ok(pg.includes("classifyFind<Found>(found)") && pg.includes('data-testid="find-error"') && pg.includes("検索結果を取得できませんでした。時間をおいて再検索してください。"));
  assert.ok(pg.includes("q.length >= 8 && !findFailed && foundRows.length === 0"), "失敗時は該当なしを出さない");
  assert.ok(pg.includes("defaultValue={q}"), "検索語は保持");
});
