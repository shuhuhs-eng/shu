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
  for (const l of ["ワークライフバランス", "スキルアップ", "収入の安定"]) { const b = page.locator("button[aria-pressed]").nth(["ワークライフバランス","スキルアップ","収入の安定"].indexOf(l)); await b.click(); }
}
(async () => {
  const browser = await chromium.launch();
  for (const [label, opts] of [["PC", { viewport: { width: 1280, height: 900 } }], ["スマホ", { ...devices["iPhone 13"] }]]) {
    const t = (n) => `[${label}] ${n}`;
    const fresh = async () => { const ctx = await browser.newContext(opts); const page = await ctx.newPage(); await page.goto("file://" + SP + "/index.html"); await page.waitForSelector("form"); return { ctx, page }; };
    // 1) 未選択では進めない
    let { ctx, page } = await fresh(); await toStep2(page);
    ok(t("ステップ2に立場の欄（必須・3択）が出ている"), (await page.getByText("いまの立場（必須）").isVisible()) && (await page.locator("input[name=careerPhase]").count()) === 3);
    await page.locator("label[for=specialties-カット]").click(); await page.selectOption("#employmentType", "full_time");
    await page.getByRole("button", { name: "次へ" }).click();
    ok(t("未選択では次へ進めない（ステップ2のまま・案内が出る）"), (await page.getByRole("alert").first().innerText()).includes("いまの立場を選んでください") && (await page.getByText(/ステップ 2 \/ 4/).isVisible()));
    await page.locator("input[name=careerPhase][value=new_graduate]").check();
    await page.getByRole("button", { name: "次へ" }).click();
    ok(t("新卒で卒業年月が空なら進めない"), (await page.getByRole("alert").first().innerText()).includes("卒業"));
    await ctx.close();
    // 2) 3択それぞれで保存できる
    for (const [val, extra] of [["experienced", null], ["blank", null], ["new_graduate", { ym: "2027-03", kind: "planned" }]]) {
      ({ ctx, page } = await fresh()); await toStep2(page);
      await page.locator(`input[name=careerPhase][value=${val}]`).check();
      if (extra) { await page.fill("#cp-grad", extra.ym); await page.selectOption("#cp-kind", extra.kind); }
      await rest(page);
      await page.getByRole("button", { name: "プロフィールを保存して始める" }).click();
      await page.waitForFunction(() => window.__saved || window.__pushed, null, { timeout: 5000 }).catch(() => {});
      const saved = await page.evaluate(() => window.__saved); const pushed = await page.evaluate(() => window.__pushed);
      ok(t(`${val}: 保存でき、送信値に careerPhase=${val}`), saved && saved.careerPhase[0] === val && pushed === "/stylist/mypage", saved);
      ok(t(`${val}: 卒業情報は新卒のときだけ送られる`), val === "new_graduate" ? saved.graduationYm[0] === "2027-03" && saved.graduationKind[0] === "planned" : !saved.graduationYm && !saved.licenseStatus);
      await ctx.close();
    }
    // 3) 失敗時に入力が残る（立場・新卒の詳細・他の入力）
    ({ ctx, page } = await fresh()); await page.evaluate(() => (window.__mode = "fail")); await toStep2(page);
    await page.locator("input[name=careerPhase][value=new_graduate]").check(); await page.fill("#cp-grad", "2027-03"); await page.selectOption("#cp-kind", "planned"); await page.selectOption("#cp-lic", "studying");
    await rest(page); await page.getByRole("button", { name: "プロフィールを保存して始める" }).click();
    await page.getByText("保存に失敗しました").waitFor({ timeout: 5000 });
    const keep = async () => [
      await page.locator("input[name=careerPhase]:checked").getAttribute("value"), await page.locator("#cp-grad").inputValue(), await page.locator("#cp-kind").inputValue(), await page.locator("#cp-lic").inputValue(),
      await page.locator("#publicName").inputValue(), await page.locator("#fullName").inputValue(), await page.locator("input[name=birthDate]").inputValue(), await page.locator("#employmentType").inputValue(), await page.locator("input[type=hidden][name=valuePriorities]").count(),
    ];
    const k1 = await keep(); ok(t("失敗後も、立場・卒業・免許・公開名・氏名・生年月日・雇用形態・大切にしたいことが残る"), JSON.stringify(k1) === JSON.stringify(["new_graduate", "2027-03", "planned", "studying", "さくら", "山田 花子", "1990-04-01", "full_time", 3]), k1);
    // 4) 失敗後にそのまま再送して成功し、送信値が最初の入力と一致
    await page.evaluate(() => (window.__mode = "ok")); await page.getByRole("button", { name: "プロフィールを保存して始める" }).click();
    await page.waitForFunction(() => window.__saved, null, { timeout: 5000 });
    const s = await page.evaluate(() => window.__saved); ok(t("再送で保存でき、送信値が画面の入力と一致（立場・卒業・免許・名前・生年月日）"), s.careerPhase[0] === "new_graduate" && s.graduationYm[0] === "2027-03" && s.licenseStatus[0] === "studying" && s.publicName[0] === "さくら" && s.birthDate[0] === "1990-04-01" && s.valuePriorities.length === 3, s);
    await page.screenshot({ path: `${SP}/${label}.png`, fullPage: true }); await ctx.close();
  }
  await browser.close(); console.log(fail ? "FAIL" : "ALL PASS"); process.exit(fail ? 1 : 0);
})();
