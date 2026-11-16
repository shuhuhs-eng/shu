// 新規登録ウィザードの通し操作（モック・保存先はモック。実Supabaseではない）
const { chromium, devices } = require("playwright");
const SP = process.argv[2]; let fail = 0; const ok = (n, c, i = "") => { console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : " " + JSON.stringify(i))); if (!c) fail++; };
async function step1(page) {
  await page.fill("#publicName", "さくら"); await page.selectOption("#prefecture", "東京都"); await page.fill("#fullName", "山田 花子");
  await page.selectOption("#ageBand", "30_34"); await page.selectOption("#gender", "female"); await page.fill("input[name=birthDate]", "1990-04-01");
  await page.locator("input[name=ageDisplayMode]").first().check();
}
async function toStep2(page) { await step1(page); await page.getByRole("button", { name: "次へ" }).click(); }
async function rest(page) { // 2の残り→4まで
  await page.locator("label[for=specialties-カット]").click(); await page.selectOption("#employmentType", "full_time");
  await page.getByRole("button", { name: "次へ" }).click(); await page.getByRole("button", { name: "次へ" }).click();
  for (const i of [0, 1, 2]) await page.locator("button[aria-pressed]").nth(i).click();
}
const toNext = async (page) => { await page.locator("label[for=specialties-カット]").click(); await page.selectOption("#employmentType", "full_time"); await page.getByRole("button", { name: "次へ" }).click(); };
(async () => {
  const browser = await chromium.launch();
  for (const [label, opts] of [["PC", { viewport: { width: 1280, height: 900 } }], ["スマホ", { ...devices["iPhone 13"] }]]) {
    const t = (n) => `[${label}] ${n}`;
    const fresh = async () => { const ctx = await browser.newContext(opts); const page = await ctx.newPage(); await page.goto("file://" + SP + "/index.html"); await page.waitForSelector("form"); return { ctx, page }; };
    let { ctx, page } = await fresh(); await toStep2(page);
    ok(t("ステップ2に立場の欄（必須・3択）。旧項目（卒業の区分・就業開始・免許）は出ない"), (await page.getByText("いまの立場（必須）").isVisible()) && (await page.locator("input[name=careerPhase]").count()) === 3);
    await page.locator("input[name=careerPhase][value=new_graduate]").check();
    const html = await page.locator("[data-testid=career-phase-field]").innerText();
    ok(t("新卒: 年（西暦の選択）と月（3月・10月の2択）だけ。日・自由入力・区分・就業開始・免許・ブランク期間は出ない"),
      (await page.locator("#cp-year option").count()) > 2 && (await page.locator("#cp-month option").allInnerTexts()).join("|") === "選んでください|3月|10月"
      && (await page.locator("[data-testid=career-phase-field] input[type=month], [data-testid=career-phase-field] input[type=date], [data-testid=career-phase-field] input[type=text]").count()) === 0
      && !/卒業の区分|就業開始|免許|ブランク期間/.test(html), html);
    ok(t("年の選択肢は西暦（2027年など）で、2027年に固定されていない"), (await page.locator("#cp-year option").allInnerTexts()).filter((x) => /^\d{4}年$/.test(x)).length >= 5);
    await toNext(page);
    ok(t("新卒で年・月が未選択なら進めない"), (await page.getByRole("alert").first().innerText()).includes("卒業") && (await page.getByText(/ステップ 2 \/ 4/).isVisible()));
    await page.selectOption("#cp-year", "2027"); await toNext(page).catch(() => {});
    ok(t("新卒で月だけ未選択でも進めない"), (await page.getByText(/ステップ 2 \/ 4/).isVisible()));
    await ctx.close();
    ({ ctx, page } = await fresh()); await toStep2(page);
    await page.getByRole("button", { name: "次へ" }).click();
    ok(t("立場が未選択では次へ進めない"), (await page.getByRole("alert").first().innerText()).includes("いまの立場を選んでください"));
    await page.locator("input[name=careerPhase][value=blank]").check();
    ok(t("ブランクあり: ブランク期間（数値＋単位 ヶ月/年）が出る。卒業欄は出ない"), (await page.locator("#cp-blank-value").isVisible()) && (await page.locator("select[name=blankPeriodUnit] option").allInnerTexts()).join("|") === "ヶ月|年" && (await page.locator("#cp-year").count()) === 0);
    await page.fill("#cp-blank-value", "0"); await toNext(page);
    ok(t("ブランク期間が0なら進めない"), (await page.getByRole("alert").first().innerText()).includes("1以上の整数"));
    await ctx.close();
    for (const [val, f, check] of [
      ["experienced", async () => {}, (s) => !s.graduationYear && !s.blankPeriodValue],
      ["blank", async () => {}, (s) => !s.blankPeriodValue?.[0] && !s.graduationYear],
      ["blank", async (p) => { await p.fill("#cp-blank-value", "6"); }, (s) => s.blankPeriodValue[0] === "6" && s.blankPeriodUnit[0] === "months"],
      ["blank", async (p) => { await p.fill("#cp-blank-value", "2"); await p.selectOption("select[name=blankPeriodUnit]", "years"); }, (s) => s.blankPeriodValue[0] === "2" && s.blankPeriodUnit[0] === "years"],
      ["new_graduate", async (p) => { await p.selectOption("#cp-year", "2027"); await p.selectOption("#cp-month", "3"); }, (s) => s.graduationYear[0] === "2027" && s.graduationMonth[0] === "3"],
      ["new_graduate", async (p) => { await p.selectOption("#cp-year", "2027"); await p.selectOption("#cp-month", "10"); }, (s) => s.graduationYear[0] === "2027" && s.graduationMonth[0] === "10"],
    ]) {
      ({ ctx, page } = await fresh()); await toStep2(page);
      await page.locator(`input[name=careerPhase][value=${val}]`).check(); await f(page);
      await rest(page); await page.getByRole("button", { name: "プロフィールを保存して始める" }).click();
      await page.waitForFunction(() => window.__saved || window.__pushed, null, { timeout: 5000 }).catch(() => {});
      const saved = await page.evaluate(() => window.__saved); const pushed = await page.evaluate(() => window.__pushed);
      const desc = `${val} ${saved?.graduationYear?.[0] ?? ""}${saved?.graduationMonth?.[0] ? "/" + saved.graduationMonth[0] : ""} ${saved?.blankPeriodValue?.[0] ?? ""}${saved?.blankPeriodUnit?.[0] ?? ""}`;
      ok(t(`保存できる（${desc.trim()}）。旧項目（卒業の区分・就業開始・免許）は送られない`), saved && saved.careerPhase[0] === val && pushed === "/stylist/mypage" && check(saved) && !saved.graduationKind && !saved.desiredStartYm && !saved.licenseStatus, saved);
      await ctx.close();
    }
    ({ ctx, page } = await fresh()); await page.evaluate(() => (window.__mode = "fail")); await toStep2(page);
    await page.locator("input[name=careerPhase][value=new_graduate]").check(); await page.selectOption("#cp-year", "2027"); await page.selectOption("#cp-month", "10");
    await rest(page); await page.getByRole("button", { name: "プロフィールを保存して始める" }).click();
    await page.getByText("保存に失敗しました").waitFor({ timeout: 5000 });
    const keep = async () => [await page.locator("input[name=careerPhase]:checked").getAttribute("value"), await page.locator("#cp-year").inputValue(), await page.locator("#cp-month").inputValue(),
      await page.locator("#publicName").inputValue(), await page.locator("#fullName").inputValue(), await page.locator("input[name=birthDate]").inputValue(), await page.locator("#employmentType").inputValue(), await page.locator("input[type=hidden][name=valuePriorities]").count()];
    const k1 = await keep(); ok(t("失敗後も、立場・卒業年・月・公開名・氏名・生年月日・雇用形態・大切にしたいことが残る"), JSON.stringify(k1) === JSON.stringify(["new_graduate", "2027", "10", "さくら", "山田 花子", "1990-04-01", "full_time", 3]), k1);
    await page.evaluate(() => (window.__mode = "ok")); await page.getByRole("button", { name: "プロフィールを保存して始める" }).click();
    await page.waitForFunction(() => window.__saved, null, { timeout: 5000 });
    const s = await page.evaluate(() => window.__saved); ok(t("再送で保存でき、送信値が画面の入力と一致"), s.careerPhase[0] === "new_graduate" && s.graduationYear[0] === "2027" && s.graduationMonth[0] === "10" && s.publicName[0] === "さくら" && s.birthDate[0] === "1990-04-01" && s.valuePriorities.length === 3, s);
    await page.screenshot({ path: `${SP}/${label}.png`, fullPage: true }); await ctx.close();
  }
  await browser.close(); console.log(fail ? "FAIL" : "ALL PASS"); process.exit(fail ? 1 : 0);
})();
