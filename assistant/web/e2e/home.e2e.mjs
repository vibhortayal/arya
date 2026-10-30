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
  // The receipts date shows only when the last receipt is over a week old.
  const through = (await page.textContent("#today-through")) || "";
  if (through && !/^Last receipt /.test(through)) throw new Error("through line: " + through);

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
  } else if (await page.$("#perish-open")) {
    // After a receipt (#207): one sheet of what can expire or go bad; skip one, pick a
    // date for another, Escape leaves without saving.
    await page.click("#perish-open");
    await page.waitForSelector("#perish-sheet .pz li");
    const n = (await page.$$("#perish-sheet .pz li")).length;
    if (n < 2 || n > 8) throw new Error("perishables shown: " + n);
    await page.click("#perish-sheet .pz li:first-child .pz-x");
    await page.waitForSelector("#perish-sheet .pz li.skip");
    await page.fill("#perish-sheet .pz li:nth-child(2) .pz-pick input", "2030-01-15");
    await page.waitForSelector("#perish-sheet .pz-date");
    await page.focus("#pz-more");
    await page.keyboard.press("Escape");
    await page.waitForSelector("#perish-sheet", { state: "detached" });
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

  // No "Open Lists" link (usability pass): the cards and the tab do it.
  if (await page.$("#today-listline")) throw new Error("Open Lists link should be gone");

  // The Quest row shows until this account first opens Quest, then retires.
  await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("arya-quest-opened:")).forEach(k => localStorage.removeItem(k)));
  await page.evaluate(() => window.__aryaShow("list"));
  await page.evaluate(() => window.__aryaShow("home"));
  await page.click("#today-quest");
  await page.waitForSelector("#view-community .qg-home");
  await page.evaluate(() => window.__aryaShow("home"));
  await page.waitForSelector("#today-expiry .sectrow");
  if (await page.$("#today-quest")) throw new Error("Quest nudge should retire after Quest opens");
}
