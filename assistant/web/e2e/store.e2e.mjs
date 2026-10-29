/* Where are you shopping?: input, store rows, Find/Add navigation, Back. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  await page.evaluate(() => window.__aryaShow("store"));
  await page.waitForSelector("#view-store");
  await page.waitForSelector("#st-name");
  await page.waitForFunction(() => document.querySelector("#st-mine .pickrow, #st-mine .empty, #st-history .pickrow"));
  await page.fill("#st-name", "Zzzz Unknown Mart");
  await page.press("#st-name", "Enter");
  await page.waitForSelector("#toast:not([hidden])");
  if (!(await page.isVisible("#view-store"))) throw new Error("unknown typed store must not advance");
  const star = await page.$("#st-mine [data-fav]");
  if (star) {
    // Starring moves the row between sections, so follow it by store id.
    const id = await star.getAttribute("data-fav");
    const sel = `#st-mine [data-fav="${id}"]`;
    const before = await star.getAttribute("aria-pressed");
    await star.click();
    await page.waitForFunction(([sel, b]) => document.querySelector(sel)?.getAttribute("aria-pressed") !== b, [sel, before]);
    await page.click(sel); // put it back
    await page.waitForFunction(([sel, b]) => document.querySelector(sel)?.getAttribute("aria-pressed") === b, [sel, before]);
  }
  await page.click('#view-store .navrow:has-text("Add a store")');
  await page.waitForFunction(() => !document.querySelector("#view-store"));
  await page.evaluate(() => window.__aryaShow("store"));
  await page.waitForSelector("#view-store");
  await page.click("#view-store .qback");
  await page.waitForFunction(() => !document.querySelector("#view-store"));
}
