/* Quest tab: the game's home on the user's lists, the store pick, a
 * practice trip (tabs hide, the 3D world loads), and the Trips page
 * with the old hunts, crew rows and Teach Arya your store. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  // A real quest needs something on the list.
  await page.evaluate(() => fetch("/api/list/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Milk" }) }));
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

  // Trips: history only (usability audit): no New quest, mapping,
  // level, album, Crew or Fastest Hands; those live in Quest.
  await page.evaluate(() => window.__aryaShow("trips"));
  await page.waitForSelector("#view-trips .largetitle");
  const title = await page.textContent("#view-trips .largetitle");
  if (title !== "Your trips") throw new Error("title: " + title);
  for (const sel of ["#btn-new-hunt", "#btn-map-store", "[data-qnav]", "#album-nav-sub", "#comm-fastest", "#today-level"])
    if (await page.$("#view-trips " + sel)) throw new Error("Your trips still shows " + sel);
}
