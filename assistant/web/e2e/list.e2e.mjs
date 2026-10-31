/* Lists: cards, a list's page, add by typing, check/select/move sheet,
 * New list sheet, Start shopping's how-to-shop sheet into the Quest game. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  await page.evaluate(() => window.__aryaShow("list"));
  await page.waitForSelector("#view-list");
  await page.waitForSelector("#list-cards .listcard");
  // Everything else shows only when it holds something (cards only when
  // they matter), so give it an item first.
  if (!(await page.isVisible('#list-cards [data-open-list="else"]'))) {
    await page.evaluate(() => fetch("/api/list/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "zz bread" }) }));
    await page.reload();
    await page.waitForSelector("#tabs");
    await page.evaluate(() => window.__aryaShow("list"));
    await page.waitForSelector("#list-cards .listcard");
  }
  if (!(await page.isVisible('#list-cards [data-open-list="else"]'))) throw new Error("Everything else card missing");

  // New list sheet: needs a name, then opens the new list's page.
  await page.click("#list-new");
  await page.waitForSelector("#list-sheet #ls-name");
  await page.click('#list-sheet [data-ls="create"]');
  await page.waitForSelector("#toast:not([hidden])");
  const stamp = "Zz" + Date.now().toString(36).slice(-5);
  await page.fill("#ls-name", stamp);
  await page.click('#list-sheet [data-ls="create"]');
  await page.waitForSelector("#list-page");
  await page.waitForFunction(n => document.querySelector("#lp-title")?.textContent.includes(n), stamp);
  await page.waitForFunction(() => !document.querySelector("#list-sheet"));

  // Add by typing: the split preview, then the row.
  await page.fill("#add-text", "zz eggs, zz milk");
  await page.waitForSelector("#add-split .spchip");
  // The add box shows a + after typing; its label says what it adds.
  if ((await page.getAttribute("#add-submit", "aria-label")) !== "Add 2 items") throw new Error("add label: " + (await page.getAttribute("#add-submit", "aria-label")));
  await page.press("#add-text", "Enter");
  await page.waitForFunction(() => [...document.querySelectorAll("#smart-list .listrow .name")].some(n => n.textContent === "zz eggs"));
  if (!(await page.isVisible("#list-hunt"))) throw new Error("Start shopping bar missing");

  // Check one off: it folds into the checked-off line.
  await page.click('#smart-list [data-act="check"]');
  await page.waitForSelector("#list-done .donetoggle");

  // Select -> pick the other row -> Move sheet.
  await page.click("#lp-select");
  await page.waitForSelector("#list-selbar");
  await page.click("#smart-list .listrow");
  await page.waitForFunction(() => document.querySelector("#ls-move")?.textContent.startsWith("Move 1"));
  await page.click("#ls-move");
  await page.waitForSelector('#list-sheet [data-ls-move="else"]');
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector("#list-sheet"));
  await page.click("#lp-select"); // Done
  await page.waitForFunction(() => !document.querySelector("#list-selbar"));

  // List options sheet, then delete the list again (cleanup).
  await page.click("#lp-menu");
  await page.waitForSelector('#list-sheet [data-ls="delete"]');
  await page.click('#list-sheet [data-ls="delete"]');
  await page.waitForSelector("#lists-home");

  // Start shopping asks once how to shop (Quest or Just my list), then
  // remembers; Quest opens the game.
  await page.click('#list-cards [data-open-list="else"]');
  await page.waitForSelector("#list-page");
  if (!(await page.isVisible("#list-hunt"))) {
    await page.fill("#add-text", "zz bread");
    await page.press("#add-text", "Enter");
    await page.waitForSelector("#list-hunt");
  }
  await page.click("#list-hunt");
  await page.waitForSelector('#shop-sheet [data-shop="quest"]');
  if (!(await page.$('#shop-sheet [data-shop="list"]'))) throw new Error("the sheet should offer Just my list");
  await page.click('#shop-sheet [data-shop="quest"]');
  await page.waitForSelector('#view-community .qg');
}
