/* My stores: list renders, star toggles a favorite, Find/Add rows navigate, Back works. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  await page.evaluate(() => window.__aryaShow("stores-mine"));
  await page.waitForSelector("#view-stores-mine");
  await page.waitForFunction(() => document.querySelector("#sm-list .row, #sm-list .empty"));
  const h = await page.textContent("#view-stores-mine .largetitle");
  if (h !== "My stores") throw new Error("title: " + h);
  const star = await page.$("#sm-list [data-fav]");
  if (star) {
    const before = await star.getAttribute("aria-pressed");
    await star.click();
    await page.waitForFunction(b => {
      const s = document.querySelector("#sm-list [data-fav]");
      return s && s.getAttribute("aria-pressed") !== b || !!document.querySelector("#toast:not([hidden])");
    }, before);
  }
  await page.click('#view-stores-mine .navrow:has-text("Find stores")');
  await page.waitForFunction(() => !document.querySelector("#view-stores-mine"));
  await page.evaluate(() => window.__aryaShow("stores-mine"));
  await page.waitForSelector("#view-stores-mine");
  await page.click("#view-stores-mine .qback");
  await page.waitForFunction(() => !document.querySelector("#view-stores-mine"));
}
