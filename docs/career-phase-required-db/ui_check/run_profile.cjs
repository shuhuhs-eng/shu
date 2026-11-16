// プロフィール編集の通し操作（モック・保存先はモック。実Supabaseではない）
const { chromium, devices } = require("playwright");
const SP = process.argv[2]; let fail = 0; const ok = (n, c, i = "") => { console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : " " + JSON.stringify(i))); if (!c) fail++; };
(async () => {
  const browser = await chromium.launch();
  for (const [label, opts] of [["PC", { viewport: { width: 1280, height: 900 } }], ["スマホ", { ...devices["iPhone 13"] }]]) {
    const t = (n) => `[${label}] ${n}`;
    const open = async (qs = "") => { const ctx = await browser.newContext(opts); const page = await ctx.newPage(); await page.goto(`file://${SP}/profile.html${qs}`); await page.waitForSelector("form"); return { ctx, page }; };
    const save = async (page, ok_ = true) => { await page.getByRole("button", { name: "変更を保存" }).click(); if (ok_) await page.getByText("保存しました").waitFor({ timeout: 4000 }); };
    let { ctx, page } = await open("?phase=legacy");
    const btns = await page.locator("form button[type=submit]").allInnerTexts();
    ok(t("保存ボタンは1つだけ（変更を保存）"), btns.length === 1 && btns[0].trim() === "変更を保存", btns);
    const body = await page.locator("form").innerText();
    ok(t("旧文言がない（任意・選ばない・美容学生・卒業の区分・就業開始・免許・いまの立場を保存する）"), !/いまの立場（任意）|選ばない|美容学生|卒業の区分|就業開始|免許|いまの立場を保存する/.test(body));
    ok(t("見出しは「いまの立場（必須）」、3択のみ、旧データ（美容学生）でも未選択で開き、選び直しを案内"), (await page.locator("legend", { hasText: "いまの立場（必須）" }).count()) === 1 && (await page.locator("input[name=careerPhase]").count()) === 3 && (await page.locator("input[name=careerPhase]:checked").count()) === 0 && (await page.locator("[data-testid=career-phase-reselect]").count()) === 1);
    await save(page, false); await page.waitForTimeout(400);
    ok(t("未選択では保存されない。エラーが入力欄の近くとボタン直下に出る"), (await page.evaluate(() => window.__saved)) === undefined && (await page.locator("[data-testid=career-phase-field] [role=alert]").innerText()).includes("いまの立場を選んでください") && (await page.locator("form > div").last().innerText()).includes("入力内容をご確認ください"));
    ok(t("カードは未選択を表示・リンクやボタンなし"), (await page.locator("#card").innerText()).includes("未選択") && (await page.locator("#card a,#card button").count()) === 0);
    await ctx.close();
    // 既存の卒業月が3月/10月以外: 丸めず、年は残し月は未選択で、選び直しを案内。選ばないと保存できない
    ({ ctx, page } = await open("?phase=may"));
    ok(t("既存の卒業月（5月）は丸めない: 年は2027、月は未選択で、選び直しの案内が出る"), (await page.locator("#cp-year").inputValue()) === "2027" && (await page.locator("#cp-month").inputValue()) === "" && (await page.locator("[data-testid=career-phase-month-reselect]").count()) === 1);
    await save(page, false); await page.waitForTimeout(300);
    ok(t("月を選び直すまで保存できない"), (await page.evaluate(() => window.__saved)) === undefined && (await page.locator("[data-testid=career-phase-field] [role=alert]").innerText()).includes("卒業"));
    await page.selectOption("#cp-month", "10"); await save(page);
    ok(t("選び直して保存できる（2027年10月）"), (await page.evaluate(() => window.__saved)).graduationMonth[0] === "10");
    await ctx.close();
    // 不正なブランク期間はサーバー検証でエラー（入力は残る）
    ({ ctx, page } = await open()); await page.locator("input[name=careerPhase][value=blank]").check();
    for (const bad of ["0", "-1", "1.5", "abc", "121"]) {
      await page.fill("#cp-blank-value", bad); await save(page, false); await page.waitForTimeout(300);
      ok(t(`ブランク期間 ${bad}: 保存されず、エラーが出て入力が残る`), (await page.evaluate(() => window.__saved)) === undefined && (await page.locator("[data-testid=career-phase-blank] [role=alert]").count()) === 1 && (await page.locator("#cp-blank-value").inputValue()) === bad);
    }
    await page.fill("#cp-blank-value", "11"); await page.selectOption("select[name=blankPeriodUnit]", "years"); await save(page, false); await page.waitForTimeout(300);
    ok(t("11年は上限（10年）超えで保存されない"), (await page.evaluate(() => window.__saved)) === undefined);
    await ctx.close();
    for (const [val, f, text] of [
      ["experienced", async () => {}, "現役の美容師"],
      ["blank", async () => {}, "ブランクあり"],
      ["blank", async (p) => { await p.fill("#cp-blank-value", "6"); }, "ブランク期間: 6ヶ月"],
      ["blank", async (p) => { await p.fill("#cp-blank-value", "2"); await p.selectOption("select[name=blankPeriodUnit]", "years"); }, "ブランク期間: 2年"],
      ["new_graduate", async (p) => { await p.selectOption("#cp-year", "2027"); await p.selectOption("#cp-month", "3"); }, "卒業（予定）: 2027年3月"],
      ["new_graduate", async (p) => { await p.selectOption("#cp-year", "2028"); await p.selectOption("#cp-month", "10"); }, "卒業（予定）: 2028年10月"],
    ]) {
      ({ ctx, page } = await open());
      await page.locator(`input[name=careerPhase][value=${val}]`).check(); await f(page); await save(page);
      const s = await page.evaluate(() => window.__saved);
      ok(t(`${val}（${text}）: 保存でき、ボタン直下に「保存しました」。旧項目は送られない`), s.careerPhase[0] === val && (await page.locator("form > div").last().innerText()).includes("保存しました") && !s.graduationKind && !s.desiredStartYm && !s.licenseStatus, s);
      ok(t(`${val}: 立場以外の項目は送信値のまま（公開名・氏名・生年月日・自己紹介・公開範囲・大切にしたいこと）`), s.publicName[0] === "さくら" && s.fullName[0] === "山田 花子" && s.birthDate[0] === "1990-04-01" && s.bio[0] === "自己紹介" && s.visibility[0] === "PUBLIC" && s.valuePriorities.length === 3);
      await page.goto(`file://${SP}/profile.html?reload=1`); await page.waitForSelector("form");
      const chk = await page.locator("input[name=careerPhase]:checked").getAttribute("value");
      const restored = val === "new_graduate" ? (await page.locator("#cp-year").inputValue()) === s.graduationYear[0] && (await page.locator("#cp-month").inputValue()) === s.graduationMonth[0]
        : val === "blank" ? (await page.locator("#cp-blank-value").inputValue()) === (s.blankPeriodValue?.[0] ?? "") : true;
      ok(t(`${val}（${text}）: 再読み込み後も同じ内容が復元され、カードの表示とも一致`), chk === val && restored && (await page.locator("#card").innerText()).includes(text.replace("ブランク期間: ", "").replace("卒業（予定）: ", "")), [chk, restored]);
      await ctx.close();
    }
    ({ ctx, page } = await open()); await page.evaluate(() => (window.__mode = "fail"));
    await page.locator("input[name=careerPhase][value=blank]").check(); await page.fill("#cp-blank-value", "6"); await page.fill("#publicName", "変更した名前");
    await save(page, false); await page.getByText("保存に失敗しました").waitFor({ timeout: 4000 });
    const keep = [await page.locator("input[name=careerPhase]:checked").getAttribute("value"), await page.locator("#cp-blank-value").inputValue(), await page.locator("#publicName").inputValue()];
    ok(t("失敗してもボタン直下にエラーが出て、立場・ブランク期間・公開名の入力が残る"), JSON.stringify(keep) === JSON.stringify(["blank", "6", "変更した名前"]) && (await page.locator("form > div").last().innerText()).includes("保存に失敗しました"), keep);
    await page.screenshot({ path: `${SP}/profile_${label}.png`, fullPage: true });
    const m = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]); ok(t("横スクロールなし"), m[0] <= m[1], m);
    await ctx.close();
  }
  await browser.close(); console.log(fail ? "FAIL" : "ALL PASS"); process.exit(fail ? 1 : 0);
})();
