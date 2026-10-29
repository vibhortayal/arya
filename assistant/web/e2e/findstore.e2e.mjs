/* Find or add a store where you need one (owner 2026-10-29): Teach
 * Arya your store and Quest's Build a store both open the same search
 * and add as Find stores, and an added store becomes a choice there. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");

  // Teach Arya your store.
  await page.evaluate(() => window.__aryaShow("mapper"));
  await page.waitForSelector("#mp-stores #mp-findstore");
  const before = (await page.$$("#mp-stores [data-mstore]")).length;
  await page.click("#mp-findstore");
  await page.waitForSelector("#mp-find #sf-q");
  await page.waitForFunction(() => document.querySelector("#mp-find #sf-results .row, #mp-find #sf-results .empty"));
  const add = await page.$("#mp-find [data-addstore]");
  if (add) {
    const row = await add.evaluate(b => b.closest(".row").querySelector(".name").textContent);
    await add.click();
    await page.waitForFunction(n => [...document.querySelectorAll("#mp-stores [data-mstore]")].some(c => c.getAttribute("aria-pressed") === "true" && c.textContent === n), row);
    if (await page.$("#mp-find")) throw new Error("the search should close after adding");
    if ((await page.$$("#mp-stores [data-mstore]")).length <= before) throw new Error("added store missing from the chips");
  }

  // Build a store: Which store? offers the same search.
  await page.evaluate(() => window.__aryaShow("community"));
  await page.waitForSelector('button[role="tab"]:has-text("Build")', { timeout: 20000 });
  await page.click('button[role="tab"]:has-text("Build")');
  await page.click(".qg-bigchoice:not(.dream)");
  await page.waitForSelector("#qg-findstore, .qg-findstore #sf-q");
  if (await page.$("#qg-findstore")) await page.click("#qg-findstore");
  await page.waitForSelector(".qg-findstore #sf-q");
}
