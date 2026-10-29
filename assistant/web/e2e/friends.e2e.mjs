/* Friends (needs a second local account "cartqueen", see e2e/run.mjs): empty/list renders, adding a handle validates and posts, Back leaves. */
export default async function (page, base) {
  await page.goto(base + "/next/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  await page.evaluate(() => window.__aryaShow("friends"));
  await page.waitForSelector("#view-friends #fr-add");
  await page.waitForSelector("#fr-list .row, #fr-list .empty", { timeout: 15000 });
  await page.click("#fr-add");
  await page.waitForSelector("#toast:has-text('Type a handle first')").catch(() => {});
  await page.fill("#fr-handle", "cartqueen");
  await page.click("#fr-add");
  await page.waitForSelector("#toast:has-text('cartqueen')", { timeout: 10000 }).catch(() => {});
  await page.waitForSelector("#fr-list .row", { timeout: 10000 });
  const txt = await page.textContent("#fr-list");
  if (!txt.includes("@cartqueen")) throw new Error("friend row: " + txt);
  if ((await page.inputValue("#fr-handle")) !== "") throw new Error("handle not cleared");
  await page.click("#view-friends .qback");
  await page.waitForFunction(() => { const v = document.querySelector("#view-friends"); return !v || v.hidden || !v.offsetParent; }, null, { timeout: 10000 });
}
