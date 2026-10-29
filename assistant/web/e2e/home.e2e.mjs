/* Today: date line, Running low (Add flips to On list), Your lists cards,
 * Use soon with the item sheet, Still good fold, Quest row and Lists link. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  await page.evaluate(() => window.__aryaShow("profile"));
  await page.evaluate(() => window.__aryaShow("home"));
  await page.waitForSelector("#view-home #today-dow:not(:empty)");
  const txt = await page.textContent("#view-home");
  for (const t of ["Today", "Running low", "Your lists", "Use soon", "Make your next trip a quest"])
    if (!txt.includes(t)) throw new Error("missing: " + t);
  if (!/From your receipts up to/.test(await page.textContent("#today-through"))) throw new Error("through line missing");

  // Running low: Add puts the item on the list.
  await page.waitForSelector("#today-low .row [data-low-add]");
  await page.click("#today-low [data-low-add]");
  await page.waitForSelector("#today-low .chip.onlist");

  // Your lists: a card per list, opening one goes to Lists.
  await page.waitForSelector("#today-lists .listcard");
  if (await page.isHidden("#today-lists-row")) throw new Error("lists row hidden");
  // A card opens that list's page, not the Lists home.
  await page.click("#today-lists .listcard");
  await page.waitForSelector("#view-list #list-page");
  await page.evaluate(() => window.__aryaShow("home"));
  await page.waitForSelector("#today-expiry .sectrow");

  // Use soon: a row opens its sheet, Escape closes it.
  await page.waitForSelector("#today-expiry .sectrow");
  const row = await page.$("#today-expiry [data-ex-item]");
  if (row) {
    await row.click();
    await page.waitForSelector("#expiry-sheet #ex-done");
    await page.keyboard.press("Escape");
    await page.waitForSelector("#expiry-sheet", { state: "detached" });
  } else {
    await page.click("#today-expiry [data-ex-snap]");
    await page.waitForSelector("#expiry-sheet #ex-type");
    await page.click("#ex-type");
    await page.waitForSelector("#expiry-sheet #ex-save");
    await page.keyboard.press("Escape");
    await page.waitForSelector("#expiry-sheet", { state: "detached" });
  }

  // Still good? folds open when there is something to check.
  const fold = await page.$("#today-checks [data-checks-fold]");
  if (fold) {
    await fold.click();
    await page.waitForSelector("#today-checks .checkrows:not([hidden])");
  }

  // The Quest row and the Lists link navigate.
  await page.click("#today-quest");
  await page.waitForSelector("#view-community .qg-home");
  await page.evaluate(() => window.__aryaShow("home"));
  await page.waitForSelector("#today-listline");
  await page.click("#today-listline");
  await page.waitForSelector("#view-list");
}
