/* Quest tab: the game's home on the user's lists, the store pick, a
 * practice trip (tabs hide, the 3D world loads), and the Trips page
 * with the old hunts, crew rows and Teach Arya your store. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  const show = async () => {
    await page.evaluate(() => window.__aryaShow("community"));
    await page.waitForSelector("#view-community .qg-home");
  };
  await show();
  if (await page.isVisible("#avatar-btn")) throw new Error("avatar should hide on Quest");

  // Store pick lists the user's stores; Back returns home.
  // A first visit points at practice; "Skip to a real quest" picks a store.
  await page.locator("#view-community .qg-cta .qg-btn", { hasText: /real quest|Start a quest/ }).first().click();
  await page.waitForSelector("#view-community .qg-pick");
  await page.click('#view-community .qg-pick [aria-label="Back"]');
  await page.waitForSelector("#view-community .qg-home");

  // Practice: the trip takes the whole phone and draws the store.
  await page.locator("#view-community .qg-cta .qg-btn", { hasText: /practice/i }).first().click();
  await page.waitForSelector('#view-community .qg[data-screen="play"]');
  await page.waitForFunction(() => !document.querySelector("#tabs"));
  await page.locator("#view-community .qg-mission .qg-btn", { hasText: "Let's go" }).click();
  await page.waitForSelector("#view-community canvas", { timeout: 20000 });
  await page.click('#view-community [aria-label="Leave the quest"]');
  await page.locator("#view-community .qg-btn", { hasText: /^Leave$/ }).click();
  await page.waitForSelector("#view-community .qg-home");
  await page.waitForSelector("#tabs");

  // Trips: the hunts behind the game, crew and mapping.
  await page.evaluate(() => window.__aryaShow("trips"));
  await page.waitForSelector("#view-trips #btn-new-hunt");
  const title = await page.textContent("#view-trips .largetitle");
  if (title !== "Your trips") throw new Error("title: " + title);
  for (const sel of ["#btn-map-store", "#view-trips [data-qnav=view-race]", "#view-trips [data-qnav=view-friends]", "#album-nav-sub"])
    if (!(await page.isVisible(sel))) throw new Error("missing " + sel);
  await page.click("#btn-new-hunt");
  await page.waitForSelector("#view-community .qg-home");
  await page.evaluate(() => window.__aryaShow("trips"));
  await page.click('#view-trips [data-qnav=view-race]');
  await page.waitForFunction(() => !document.querySelector("#view-trips"));
  await page.evaluate(() => window.__aryaShow("trips"));
  await page.click("#btn-map-store");
  await page.waitForFunction(() => !document.querySelector("#view-trips"));
}
