/* Receipt detail: opened from the archive, shows totals, back returns to Receipts. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  const id = await page.evaluate(async () => {
    const r = await (await fetch("/api/quest/receipts")).json();
    return (r.receipts || [])[0]?.receipt_id || null;
  });
  if (!id) {
    await page.evaluate(() => window.__aryaShow("receipt", { receipt_id: "none" }));
    await page.waitForSelector("#rcd-back");
    await page.click("#rcd-back");
    return;
  }
  await page.evaluate(i => window.__aryaShow("receipt", { receipt_id: i, id: i }), id);
  await page.waitForSelector("#view-receipt #rc-body .largetitle");
  await page.waitForSelector("#rc-del-btn");
  const txt = await page.textContent("#rc-body");
  if (!txt.includes("Total")) throw new Error("Total row missing");
  const vb = await page.$("#rc-view-btn");
  if (vb) {
    await vb.click();
    await page.waitForFunction(() => !document.querySelector("#rc-view-img").hidden);
    await vb.click();
    await page.waitForFunction(() => document.querySelector("#rc-view-img").hidden);
  }
  await page.click("#rcd-back");
  await page.waitForFunction(() => !document.querySelector("#view-receipt"));
}
