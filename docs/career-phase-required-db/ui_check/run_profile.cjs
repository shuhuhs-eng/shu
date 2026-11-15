const { chromium, devices } = require("playwright");
const SP = process.argv[2]; let fail = 0; const ok = (n, c, i = "") => { console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : " " + JSON.stringify(i))); if (!c) fail++; };
(async () => {
  const browser = await chromium.launch();
  for (const [label, opts] of [["PC", { viewport: { width: 1280, height: 900 } }], ["スマホ", { ...devices["iPhone 13"] }]]) {
    const t = (n) => `[${label}] ${n}`;
    const open = async (qs = "") => { const ctx = await browser.newContext(opts); const page = await ctx.newPage(); await page.goto(`file://${SP}/profile.html${qs}`); await page.waitForSelector("form"); return { ctx, page }; };
    let { ctx, page } = await open("?phase=legacy");
    const btns = await page.locator("form button[type=submit]").allInnerTexts();
    ok(t("保存ボタンは1つだけ（変更を保存）"), btns.length === 1 && btns[0].trim() === "変更を保存", btns);
    const body = await page.locator("form").innerText();
    ok(t("旧フォームの文言がない（任意・選ばない・美容学生・いまの立場を保存する・選ばなくても）"), !/いまの立場（任意）|選ばない|美容学生|いまの立場を保存する|選ばなくても/.test(body));
    ok(t("見出しは「いまの立場（必須）」、3択のみ、旧データ（美容学生）でも未選択で開く"), (await page.locator("legend", { hasText: "いまの立場（必須）" }).count()) === 1 && (await page.locator("input[name=careerPhase]").count()) === 3 && (await page.locator("input[name=careerPhase]:checked").count()) === 0);
    const order = await page.evaluate(() => { const f = document.querySelector("[data-testid=career-phase-field]"); const b = document.querySelector("form button[type=submit]"); return !!(f.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING); });
    ok(t("立場の欄は保存ボタンより上（同じフォーム内）"), order && (await page.locator("form [data-testid=career-phase-field]").count()) === 1);
    await page.getByRole("button", { name: "変更を保存" }).click(); await page.waitForTimeout(400);
    ok(t("未選択では保存されない（送信は1回、サーバー検証でエラー）。エラーが入力欄の近くに出る"), (await page.evaluate(() => window.__saved)) === undefined && (await page.locator("[data-testid=career-phase-field] [role=alert]").innerText()).includes("いまの立場を選んでください"));
    ok(t("エラーはボタン直下にも出る"), (await page.locator("form > div").last().innerText()).includes("入力内容をご確認ください"));
    const card = await page.locator("#card").innerText(); ok(t("カードは未選択を表示・リンクやボタンなし"), card.includes("未選択") && (await page.locator("#card a,#card button").count()) === 0);
    await ctx.close();
    for (const [val, extra] of [["experienced", null], ["blank", null], ["new_graduate", { ym: "2027-03", kind: "planned", lic: "studying" }]]) {
      ({ ctx, page } = await open());
      await page.locator(`input[name=careerPhase][value=${val}]`).check();
      if (extra) { await page.fill("#cp-grad", extra.ym); await page.selectOption("#cp-kind", extra.kind); await page.selectOption("#cp-lic", extra.lic); }
      await page.getByRole("button", { name: "変更を保存" }).click(); await page.getByText("保存しました").waitFor({ timeout: 4000 });
      const s = await page.evaluate(() => window.__saved);
      ok(t(`${val}: 保存でき、ボタン直下に「保存しました」`), s.careerPhase[0] === val && (await page.locator("form > div").last().innerText()).includes("保存しました"));
      ok(t(`${val}: 立場以外の項目は送信値のまま（公開名・氏名・生年月日・自己紹介・公開範囲・大切にしたいこと）`), s.publicName[0] === "さくら" && s.fullName[0] === "山田 花子" && s.birthDate[0] === "1990-04-01" && s.bio[0] === "自己紹介" && s.visibility[0] === "PUBLIC" && s.valuePriorities.length === 3);
      await page.goto(`file://${SP}/profile.html?reload=1`); await page.waitForSelector("form"); // 再読み込み（保存された値から開く）
      const chk = await page.locator("input[name=careerPhase]:checked").getAttribute("value");
      const det = val === "new_graduate" ? [await page.locator("#cp-grad").inputValue(), await page.locator("#cp-kind").inputValue(), await page.locator("#cp-lic").inputValue()] : [];
      ok(t(`${val}: 再読み込み後も同じ選択${extra ? "・卒業情報" : ""}が復元され、カードの表示とも一致`), chk === val && (!extra || JSON.stringify(det) === JSON.stringify([extra.ym, extra.kind, extra.lic])) && (await page.locator("#card").innerText()).includes({ experienced: "現役の美容師", blank: "ブランクあり", new_graduate: "新卒" }[val]), [chk, det]);
      await ctx.close();
    }
    ({ ctx, page } = await open()); await page.evaluate(() => (window.__mode = "fail"));
    await page.locator("input[name=careerPhase][value=new_graduate]").check(); await page.fill("#cp-grad", "2027-03"); await page.selectOption("#cp-kind", "planned"); await page.fill("#publicName", "変更した名前");
    await page.getByRole("button", { name: "変更を保存" }).click(); await page.getByText("保存に失敗しました").waitFor({ timeout: 4000 });
    const keep = [await page.locator("input[name=careerPhase]:checked").getAttribute("value"), await page.locator("#cp-grad").inputValue(), await page.locator("#cp-kind").inputValue(), await page.locator("#publicName").inputValue()];
    ok(t("失敗してもボタン直下にエラーが出て、立場・卒業・公開名の入力が残る"), JSON.stringify(keep) === JSON.stringify(["new_graduate", "2027-03", "planned", "変更した名前"]), keep);
    await page.screenshot({ path: `${SP}/profile_${label}.png`, fullPage: true });
    const m = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]); ok(t("横スクロールなし"), m[0] <= m[1], m);
    await ctx.close();
  }
  await browser.close(); console.log(fail ? "FAIL" : "ALL PASS"); process.exit(fail ? 1 : 0);
})();
