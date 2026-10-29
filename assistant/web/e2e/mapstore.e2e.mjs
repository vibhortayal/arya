/* Map my store is easy to reach: the Ask chip, asking in words, and
 * the Quest home row all open the store's map screen. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  await page.evaluate(() => window.__aryaShow("chat"));
  await page.waitForSelector("#ask-map-store");
  await page.fill("#chat-input", "help me map my store");
  await page.click("#chat-send");
  await page.waitForSelector("#chat-log [data-map-open]");
  await page.click("#chat-log [data-map-open]");
  await page.waitForSelector("#view-mapper h2");
  await page.evaluate(() => window.__aryaShow("community"));
  await page.waitForSelector("#qm-map-store", { timeout: 20000 });
  await page.click("#qm-map-store");
  await page.waitForSelector("#view-mapper h2");
}
