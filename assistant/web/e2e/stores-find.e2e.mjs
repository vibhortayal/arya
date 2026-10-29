/* Find stores: results render, chips toggle, search submits, Back works. */
export default async function (page, base) {
  await page.goto(base + "/next/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  await page.evaluate(() => window.__aryaShow("stores-find"));
  await page.waitForSelector("#view-stores-find");
  const h = await page.textContent("#view-stores-find h2.largetitle");
  if (h !== "Find stores") throw new Error("title: " + h);
  await page.waitForFunction(() => document.querySelector("#sf-results .row, #sf-results .empty"));
  await page.click('#sf-chips [data-sfchip="quests"]');
  const p = await page.getAttribute('#sf-chips [data-sfchip="quests"]', "aria-pressed");
  if (p !== "true") throw new Error("chip not pressed");
  await page.click('#sf-chips [data-sfchip="all"]');
  await page.fill("#sf-q", "91709");
  await page.click('#sf-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelector("#sf-results .row, #sf-results .empty"));
  await page.click("#view-stores-find .qback");
  await page.waitForFunction(() => !document.querySelector("#view-stores-find"));
}
