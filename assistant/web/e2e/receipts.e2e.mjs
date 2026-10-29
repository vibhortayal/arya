/* Receipts: add-photo input, archive, back link, a receipt row opens the detail view. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  await page.evaluate(() => window.__aryaShow("receipts"));
  await page.waitForSelector("#view-receipts");
  await page.waitForSelector("#rc-photo", { state: "attached" });
  await page.waitForSelector("#rc-archive");
  await page.waitForFunction(() => document.querySelector("#rc-archive .sessrow, #rc-archive .empty"));
  const heads = await page.$$eval("#view-receipts h3.sect", h => h.map(x => x.textContent));
  if (!heads.includes("Archive")) throw new Error("Archive heading missing: " + heads);
  const row = await page.$("#rc-archive [data-receipt]");
  if (row) {
    await row.click();
    await page.waitForFunction(() => !document.querySelector("#view-receipts"));
    await page.evaluate(() => window.__aryaShow("receipts"));
    await page.waitForSelector("#view-receipts");
  }
  await page.click("#rc-back");
  await page.waitForFunction(() => !document.querySelector("#view-receipts"));
}
