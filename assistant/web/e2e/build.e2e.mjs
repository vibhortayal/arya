/* Quest Build: three answers make a whole store; it is walked as
 * practice and saved, as a dream store or as My map of a real store
 * (the store pick then says "Your map"). No key here: the answers'
 * own store stands, which is the no-model path. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  // The store pick needs something on the list to start a quest.
  await page.evaluate(() => fetch("/api/list/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Milk" }) }));
  await page.evaluate(() => window.__aryaShow("community"));
  await page.waitForSelector("#view-community .qg-home");
  const v = page.locator("#view-community");
  const btn = (t) => v.locator("button", { hasText: t }).first();

  // Dream store: name, a cuisine, a look, what is big.
  await v.locator(".qg-seg button", { hasText: "Build" }).click();
  await btn("Dream store").click();
  await v.locator(".qg-say input, .qg-say textarea").first().fill("Spice Bazaar");
  await btn(/^Next$/).click();
  await btn("A cuisine").click();
  await v.locator(".qg-say input, .qg-say textarea").first().fill("Turkish");
  await btn(/^Next$/).click();
  await btn("Neon arcade").click();
  await btn(/^Next$/).click();
  await btn("Snacks").click();
  await btn("Build my store").click();
  await v.locator("h1", { hasText: "Spice Bazaar" }).waitFor();
  await v.locator("canvas").waitFor({ timeout: 20000 });
  await btn("Save dream store").click();
  await v.locator(".qg-reply", { hasText: "Saved" }).waitFor();
  const maps = await page.evaluate(() => fetch("/api/quest/maps").then(r => r.json()));
  if (maps.maps?.[0]?.key !== "dream:spice-bazaar") throw new Error("not saved: " + JSON.stringify(maps).slice(0, 200));

  // Walk it: a practice trip in the built store, under its own name.
  await btn("Walk it").click();
  await page.waitForSelector('#view-community .qg[data-screen="play"]');
  const go = v.locator(".qg-mission .qg-btn", { hasText: "Let's go" });
  if (await go.isVisible().catch(() => false)) await go.click();
  const title = await v.locator(".qg-where b").first().textContent();
  if (!/Spice Bazaar/.test(title || "")) throw new Error("walk title: " + title);
  await page.click('#view-community [aria-label="Leave the quest"]');
  await btn(/^Leave$/).click();
  await page.waitForSelector("#view-community .qg-home");

  // My map of a real store: saved, then the store pick says so.
  await v.locator(".qg-seg button", { hasText: "Build" }).click();
  await v.locator(".qg-saved", { hasText: "Spice Bazaar" }).waitFor();
  await btn("Draw my store").click();
  const store = v.locator(".qg-store").first();
  await store.waitFor();
  const name = (await store.locator("b").textContent()) || "";
  await store.click();
  await btn(/^Next$/).click();
  await btn(/^Next$/).click();
  await btn("Build my store").click();
  await btn("Save as my map").click();
  await v.locator(".qg-reply", { hasText: "your map" }).waitFor();
  await page.click('#view-community [aria-label="Back"]');
  await page.click('#view-community [aria-label="Back"]');
  await page.waitForSelector("#view-community .qg-home");
  await v.locator(".qg-cta .qg-btn", { hasText: /real quest|Start a quest/ }).first().click();
  await v.locator(".qg-pick").waitFor();
  await v.locator(".qg-pick", { hasText: "Your map" }).waitFor();
  if (!(await v.locator(".qg-pick").textContent()).includes(name)) throw new Error("store missing from pick: " + name);
}
