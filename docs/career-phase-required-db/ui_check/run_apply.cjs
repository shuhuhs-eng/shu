const { chromium, devices } = require("playwright");
const SP = process.argv[2]; let fail = 0; const ok = (n, c, i = "") => { console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : " " + JSON.stringify(i))); if (!c) fail++; };
(async () => {
  const browser = await chromium.launch();
  for (const [label, opts] of [["PC", { viewport: { width: 1280, height: 900 } }], ["スマホ", { ...devices["iPhone 13"] }]]) {
    const t = (n) => `[${label}] ${n}`;
    const open = async (qs = "") => { const ctx = await browser.newContext(opts); const page = await ctx.newPage(); await page.goto(`file://${SP}/apply.html${qs}`); await page.waitForSelector("[data-testid=apply-button]"); return { ctx, page }; };
    let { ctx, page } = await open();
    ok(t("押せるボタン「プロフィールに反映する」。自動では保存されない（読み込み直後は未呼び出し）"), (await page.getByRole("button", { name: "プロフィールに反映する" }).isEnabled()) && !(await page.evaluate(() => window.__apply)));
    await page.getByRole("button", { name: "プロフィールに反映する" }).click(); await page.getByText("プロフィールに反映しました").waitFor({ timeout: 4000 });
    ok(t("反映は1回・診断の3項目だけを送る"), JSON.stringify(await page.evaluate(() => window.__apply)) === JSON.stringify([["teamwork", "independence", "culture_fit"]]));
    await page.waitForTimeout(200);
    const cur = await page.locator("[data-testid=apply-current]").innerText();
    ok(t("反映後、現在の設定が変更案と同じになり、再度は押せない（すでにこの内容）"), cur.includes("1. チームワーク") && (await page.locator("[data-testid=apply-button]").isDisabled()) && (await page.locator("[data-testid=apply-disabled-reason]").innerText()).includes("すでにこの内容"), cur);
    const over = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth); ok(t("横スクロールなし"), !over);
    await page.screenshot({ path: `${SP}/apply_${label}.png`, fullPage: true }); await ctx.close();
    ({ ctx, page } = await open()); await page.evaluate(() => (window.__mode = "fail"));
    await page.getByRole("button", { name: "プロフィールに反映する" }).click(); await page.getByRole("alert").waitFor({ timeout: 4000 });
    ok(t("失敗: エラーを表示し、成功とは出さず、現在の設定は変わらない"), (await page.getByRole("alert").innerText()).includes("失敗しました") && !(await page.locator("body").innerText()).includes("反映しました") && (await page.locator("[data-testid=apply-current]").innerText()).includes("1. ワークライフバランス"));
    await ctx.close();
    ({ ctx, page } = await open("?diag=teamwork,independence"));
    ok(t("診断が2つ: 補わず、ボタンは押せない・案内を表示"), (await page.locator("[data-testid=apply-button]").isDisabled()) && (await page.locator("[data-testid=apply-disabled-reason]").innerText()).includes("プロフィール編集で3つ選んでください") && !(await page.evaluate(() => window.__apply)));
    await ctx.close();
  }
  await browser.close(); console.log(fail ? "FAILED " + fail : "ALL PASS"); process.exit(fail ? 1 : 0);
})();
