/* Analysis: spend sections render, an (i) sheet opens and closes, Back returns. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  await page.evaluate(() => window.__aryaShow("home"));
  await page.evaluate(() => window.__aryaShow("analysis"));
  await page.waitForSelector("#view-analysis");
  await page.waitForSelector("#an-spend .bignum");
  const txt = await page.textContent("#view-analysis");
  for (const t of ["Analysis", "Spend by month", "Spend by store", "Top grocery items", "All-time spend"])
    if (!txt.includes(t)) throw new Error("missing: " + t);
  if ((await page.$$("#an-months .month-row")).length < 1) throw new Error("no month bars");
  if ((await page.$$("#an-stores .row")).length < 1) throw new Error("no store rows");
  if ((await page.$$("#an-top .item-link")).length < 1) throw new Error("no top items");
  const info = await page.$("#an-prices .infobtn");
  if (info) {
    await info.click();
    await page.waitForSelector("#info-sheet .whyrow");
    await page.click("#info-sheet [data-pw=close]");
    await page.waitForSelector("#info-sheet", { state: "detached" });
  }
  await page.click("#an-back");
  await page.waitForSelector("#view-home");
}
