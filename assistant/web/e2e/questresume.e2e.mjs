/* Resume picks a Quest trip back up in the Quest game (usability audit
 * pain 3), with what was grabbed already in the cart. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  const v = page.locator("#view-community");
  await page.evaluate(() => window.__aryaShow("community"));
  await page.waitForSelector("#view-community .qg-home");
  await v.locator(".qg-cta .qg-btn", { hasText: /real quest|Start a quest|Start at/ }).first().click();
  await v.locator(".qg-pick").waitFor();
  if (!(await v.locator(".qg-stores .qg-store:not(.find)").count())) await v.locator(".qg-store.find").click();
  await v.locator(".qg-stores .qg-store:not(.find)").first().click();
  await page.waitForSelector('#view-community .qg[data-screen="play"]');
  await v.locator(".qg-mission .qg-btn", { hasText: "Let's go" }).click();
  // Grab one item, then keep the trip for later.
  await page.click("#view-community .qg-basket");
  await v.locator(".qg-list-h").first().click();
  await v.locator(".qg-shelf .qg-got").click({ timeout: 30000 });
  await page.waitForFunction(async () => {
    const r = await (await fetch("/api/quest/sessions")).json();
    return r.sessions.some(s => s.mode === "quest" && s.items.some(i => i.checked));
  }, null, { polling: 300 });
  await page.click('#view-community [aria-label="Leave the quest"]');
  await v.locator(".qg-opts .qg-btn", { hasText: "Keep it for later" }).click();
  await page.waitForSelector("#view-community .qg-home");

  // Your trips › Resume: back in the game, one item already in the cart.
  await page.evaluate(() => window.__aryaShow("trips"));
  await page.click("#today-hero [data-hero]");
  await page.waitForSelector('#view-community .qg[data-screen="play"]', { timeout: 20000 });
  const cart = await page.getAttribute("#view-community .qg-basket", "aria-label");
  if (!/^Cart: 1 of \d+/.test(cart || "")) throw new Error("resumed cart: " + cart);
  if (await page.$("#view-hunt")) throw new Error("opened the old hunt screen");
}
