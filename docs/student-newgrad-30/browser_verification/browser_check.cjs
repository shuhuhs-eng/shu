const { chromium, devices } = require("playwright");
const fs = require("fs");
const BASE = "http://localhost:3100", MOCK = "http://127.0.0.1:54399", SHOTS = __dirname + "/shots";
const results = []; let cur = "";
const ok = (name, cond, extra = "") => { results.push({ env: cur, name, pass: !!cond, extra }); console.log(`${cond ? "PASS" : "FAIL"} [${cur}] ${name}${extra ? " — " + extra : ""}`); };
const mock = async (set) => fetch(MOCK + "/__ctl", { method: "POST", body: JSON.stringify({ set }) });
const state = async () => (await fetch(MOCK + "/__state")).json();
const session = () => { const s = { access_token: "fake-access.fake.fake", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "r", user: { id: "11111111-1111-4111-8111-111111111111", aud: "authenticated", role: "authenticated", email: "tester@example.test", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" } }; return "base64-" + Buffer.from(JSON.stringify(s)).toString("base64url"); };
const eyebrow = async (p) => (await p.locator("p.eyebrow").first().textContent()) ?? "";
const idx = async (p) => Number(((await eyebrow(p)).match(/問 (\d+) \/ 30/) || [])[1] || 0);
const title = (p) => p.locator("h1").first().textContent();
const opts = (p) => p.locator("main .space-y-3 button[aria-pressed]");
const pressed = async (p) => { const n = await opts(p).count(); const r = []; for (let i = 0; i < n; i++) r.push((await opts(p).nth(i).getAttribute("aria-pressed")) === "true"); return r.indexOf(true); };
async function pick(p, i) { await opts(p).nth(i).click(); await p.waitForTimeout(120); }
async function answerFrom(p, from, choose) { // 現在の問から最後まで、choose(問番号)で選ぶ
  for (let q = from; q <= 30; q++) { if ((await idx(p)) !== q) await p.waitForFunction((n) => (document.querySelector("p.eyebrow")?.textContent || "").includes(`問 ${n} / 30`), q, { timeout: 8000 }).catch(() => {}); await pick(p, choose(q)); if (q === 30) break; }
}
const pickFor = (q) => (q * 7 + 1) % 4; // 問ごとに決まった選択（検証用）
async function newPage(browser, device, loggedIn) {
  const ctx = await browser.newContext(device ? { ...devices[device] } : { viewport: { width: 1280, height: 900 } });
  if (loggedIn) await ctx.addCookies([{ name: "sb-127-auth-token", value: session(), domain: "localhost", path: "/" }]);
  const p = await ctx.newPage(); p.on("pageerror", (e) => console.log("pageerror", e.message)); return { ctx, p };
}
async function scenarioGuest(browser, device) {
  const { ctx, p } = await newPage(browser, device, false);
  await p.goto(BASE + "/stylist/diagnosis"); await p.waitForSelector("h1");
  ok("1問目に5つの選択肢（新卒を含む）", (await opts(p).count()) === 5);
  // --- 経験者で3問進む → 1問目に戻って新卒へ切替 → 取り消す
  await pick(p, 1); await pick(p, 2); await pick(p, 3); await pick(p, 0); // Q1=1, Q2=2, Q3=3, Q4=0 → 今は5問目
  ok("経験者で5問目まで進んだ", (await idx(p)) === 5);
  for (let i = 0; i < 4; i++) await p.getByRole("button", { name: "戻る" }).click();
  ok("1問目まで戻れる（回答は残る）", (await idx(p)) === 1 && (await pressed(p)) === 1);
  const q2Before = await (async () => { await pick(p, 1); return null; })(); // 同じセット内の変更(1→1)は確認なし
  await p.getByRole("button", { name: "戻る" }).click();
  await pick(p, 4); // 新卒を選ぶ → 確認が出る
  ok("別セットへの切替は確認が出る（2問目以降に回答あり）", await p.getByText("2問目以降の回答は消えて").isVisible());
  await p.screenshot({ path: `${SHOTS}/${cur}_guest_switch_prompt.png` });
  await p.getByRole("button", { name: "今の回答のままにする" }).click();
  ok("取り消すと確認が消え、1問目の回答は経験者のまま", !(await p.getByText("2問目以降の回答は消えて").isVisible()) && (await pressed(p)) === 1 && (await idx(p)) === 1);
  await pick(p, 1); // 同じ選択でQ2へ
  ok("取り消し後、2問目以降の回答が残っている（問2=選択2）", (await idx(p)) === 2 && (await pressed(p)) === 2);
  await p.getByRole("button", { name: "戻る" }).click();
  await pick(p, 4);
  await p.getByRole("button", { name: "回答を消して切り替える" }).click();
  const t2 = await title(p);
  ok("切替を確定すると2問目から（回答は未選択）、新卒向けの質問", (await idx(p)) === 2 && (await pressed(p)) === -1 && t2.includes("美容を学ぶ中で"), t2);
  for (const n of [3, 4]) { await pick(p, 0); }
  for (let i = 0; i < 3; i++) await p.getByRole("button", { name: "戻る" }).click();
  ok("新卒を選んだ1問目の状態が残る", (await pressed(p)) === 4);
  await p.screenshot({ path: `${SHOTS}/${cur}_guest_after_switch.png` });
  await ctx.close();
}
async function scenarioGuestSaveFail(browser, device) {
  const { ctx, p } = await newPage(browser, device, false);
  await mock({ failPending: 1 }); const before = (await state()).pendings.length;
  await p.goto(BASE + "/stylist/diagnosis"); await p.waitForSelector("h1");
  await pick(p, 4); await answerFrom(p, 2, pickFor).catch(() => {});
  await p.getByText("結果の保存に失敗しました").waitFor({ timeout: 10000 });
  ok("保存失敗の表示と再送ボタン", await p.getByRole("button", { name: "今回の回答でもう一度保存する" }).isVisible());
  ok("失敗時は保存されていない", (await state()).pendings.length === before);
  ok("失敗後も、30問目の回答が画面に残っている", (await idx(p)) === 30 && (await pressed(p)) === pickFor(30));
  await p.screenshot({ path: `${SHOTS}/${cur}_guest_save_failed.png` });
  await p.getByRole("button", { name: "今回の回答でもう一度保存する" }).click();
  await p.waitForURL("**/diagnosis/result", { timeout: 15000 });
  const st = await state(); const added = st.pendings.slice(before);
  ok("再送で1件だけ保存（二重保存なし）・版は新卒", added.length === 1 && added[0].diagnosis_version === "stylist_newgrad_30_v1" && added[0].answers[0] === 4, JSON.stringify(added.map((a) => a.diagnosis_version)));
  const txt = await p.locator("main").innerText(); await p.waitForTimeout(500);
  ok("新卒結果: 経験年数・年収・市場価値・才能グラフ・経験者向けの言い方が出ない", !/経験年数|年収|市場価値|才能|経験・実績|6つの/.test(txt) && /あなたのタイプ/.test(txt) && txt.includes("評価するものではありません"), (txt.match(/.{0,15}(経験年数|年収|市場価値|才能|経験・実績|6つの).{0,15}/g)||[]).join(" | "));
  ok("新卒結果: 数値のグラフ(レーダー等のsvg)が無い", (await p.locator("main svg[role='img'], main polygon, main canvas").count()) === 0);
  await p.screenshot({ path: `${SHOTS}/${cur}_guest_newgrad_result.png`, fullPage: true });
  await ctx.close();
}
async function scenarioLoggedIn(browser, device) {
  const { ctx, p } = await newPage(browser, device, true);
  await p.goto(BASE + "/stylist/diagnosis"); await p.waitForSelector("h1");
  const first = await title(p); ok("ログイン状態で診断ページが開く", first.includes("美容師としての経験"), first);
  // 経験者で最後まで → 確認画面
  await pick(p, 2); await answerFrom(p, 2, pickFor).catch(() => {});
  await p.getByText("この内容で確定しますか").waitFor({ timeout: 8000 });
  ok("確認画面（経験者）: 30問が並ぶ", (await p.locator("main ol li").count()) === 30);
  await p.screenshot({ path: `${SHOTS}/${cur}_review_experienced.png`, fullPage: true });
  // 1問目を「直す」→ 新卒へ（確認→消す）→ 確認画面へ直接戻らず2問目から
  await p.locator("main ol li").nth(0).getByRole("button", { name: "直す" }).click();
  await pick(p, 4);
  ok("「直す」で別セットを選ぶと確認が出る", await p.getByText("2問目以降の回答は消えて").isVisible());
  await p.getByRole("button", { name: "回答を消して切り替える" }).click();
  ok("切替後は確認画面へ戻らず2問目から（未選択）", (await idx(p)) === 2 && (await pressed(p)) === -1 && !(await p.getByText("この内容で確定しますか").isVisible().catch(() => false)));
  await answerFrom(p, 2, pickFor).catch(() => {});
  await p.getByText("この内容で確定しますか").waitFor({ timeout: 8000 });
  const rows = await p.locator("main ol li p:nth-of-type(2)").allTextContents();
  const qs = await p.locator("main ol li p:nth-of-type(1)").allTextContents();
  ok("確認画面（新卒）: 質問は新卒向け、経験者の回答が混ざっていない（2問目の質問文・1問目の回答）", qs[1].includes("美容を学ぶ中で") && rows[0].includes("新卒") && qs.length === 30, qs[1]);
  // 戻る → 30問目に戻り、また確認へ
  await p.getByRole("button", { name: "最後の質問に戻る" }).click();
  ok("「最後の質問に戻る」で30問目、回答が残る", (await idx(p)) === 30 && (await pressed(p)) === pickFor(30));
  await pick(p, pickFor(30)); await p.getByText("この内容で確定しますか").waitFor();
  // 5問目を直す → 確認画面へ直接戻る、他の回答は不変
  const before = await p.locator("main ol li p:nth-of-type(2)").allTextContents();
  await p.locator("main ol li").nth(4).getByRole("button", { name: "直す" }).click();
  const cur5 = await pressed(p); const newPick = (cur5 + 1) % 4; await pick(p, newPick);
  await p.getByText("この内容で確定しますか").waitFor({ timeout: 5000 });
  const after = await p.locator("main ol li p:nth-of-type(2)").allTextContents();
  const diff = after.map((t, i) => (t !== before[i] ? i : -1)).filter((i) => i >= 0);
  ok("「直す」で1問だけ変更、確認画面へ戻り、他の29問は不変", diff.length === 1 && diff[0] === 4, JSON.stringify(diff));
  await p.screenshot({ path: `${SHOTS}/${cur}_review_newgrad.png`, fullPage: true });
  // 保存失敗 → 再送（同じ回答・同じ保存ID）
  await mock({ failCommit: 1 }); const s0 = await state(); const n0 = s0.saves.length;
  await p.getByRole("button", { name: "この内容で確定する" }).click();
  await p.getByRole("button", { name: "今回の回答でもう一度保存する" }).waitFor({ timeout: 10000 });
  ok("保存失敗: 通知と再送ボタン、確認画面の回答は残る", (await p.getByRole("button", { name: "今回の回答でもう一度保存する" }).isVisible()) && (await p.locator("main ol li").count()) === 30);
  await p.screenshot({ path: `${SHOTS}/${cur}_review_save_failed.png`, fullPage: true });
  await p.getByRole("button", { name: "今回の回答でもう一度保存する" }).click();
  await p.waitForURL("**/diagnosis/result", { timeout: 15000 });
  const s1 = await state(); const attempts = s1.commits.slice(-2);
  ok("再送は同じ保存IDで、保存は1件だけ（二重保存なし）", s1.saves.length === n0 + 1 && attempts.length === 2 && attempts[0].requestId === attempts[1].requestId && !attempts[0].ok && attempts[1].ok, JSON.stringify(attempts));
  const saved = s1.saves[s1.saves.length - 1];
  const expected = Array.from({ length: 30 }, (_, i) => (i === 0 ? 4 : pickFor(i + 1)));
  expected[4] = newPick;
  ok("保存された内容: 版は新卒・1問目=4・直した5問目だけ変わっている・市場価値/年収はnull", saved.version === "stylist_newgrad_30_v1" && saved.answers[0] === 4 && JSON.stringify(saved.answers) === JSON.stringify(expected) && saved.market === null && saved.salary === null, JSON.stringify(saved.answers) + " vs " + JSON.stringify(expected));
  await p.waitForTimeout(600);
  const txt = await p.locator("main").innerText();
  ok("新卒結果（ログイン中）: 経験年数・年収・市場価値・才能グラフが出ない", !/経験年数|年収|市場価値|才能|経験・実績|6つの/.test(txt) && /あなたのタイプ/.test(txt), txt.slice(0, 100).replace(/\n/g, " "));
  await p.screenshot({ path: `${SHOTS}/${cur}_member_newgrad_result.png`, fullPage: true });
  // 保存失敗後に回答を直して再送 → 新しい保存ID（古い送信が成功扱いにならない）
  await p.goto(BASE + "/stylist/diagnosis"); await p.waitForSelector("h1");
  await pick(p, 0); await answerFrom(p, 2, (q) => (q + 1) % 4).catch(() => {});
  await p.getByText("この内容で確定しますか").waitFor({ timeout: 8000 });
  await mock({ failCommit: 1 }); const n1 = (await state()).saves.length;
  await p.getByRole("button", { name: "この内容で確定する" }).click(); await p.getByRole("button", { name: "今回の回答でもう一度保存する" }).waitFor({ timeout: 10000 });
  await p.locator("main ol li").nth(6).getByRole("button", { name: "直す" }).click(); const c7 = await pressed(p); await pick(p, (c7 + 1) % 4);
  await p.getByRole("button", { name: "この内容で確定する" }).click(); await p.waitForURL("**/diagnosis/result", { timeout: 15000 });
  const s2 = await state(); const last3 = s2.commits.slice(-2);
  ok("失敗後に回答を直すと、新しい保存IDで送られ、1件だけ保存（経験者版）", s2.saves.length === n1 + 1 && last3[0].requestId !== last3[1].requestId && s2.saves.at(-1).version === "1.0.0" && s2.saves.at(-1).market !== null);
  await ctx.close();
}
(async () => {
  const browser = await chromium.launch();
  for (const [label, device] of [["PC", null], ["スマホ(iPhone 13)", "iPhone 13"]]) {
    cur = label;
    await scenarioGuest(browser, device); await scenarioGuestSaveFail(browser, device); await scenarioLoggedIn(browser, device);
  }
  await browser.close();
  fs.writeFileSync(__dirname + "/browser_results.json", JSON.stringify(results, null, 2));
  const fail = results.filter((r) => !r.pass); console.log(`\n結果: ${results.length - fail.length}/${results.length} PASS`); process.exit(fail.length ? 1 : 0);
})();
