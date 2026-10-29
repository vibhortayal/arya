/* Usability fixes (2026-10-29): an empty list never starts a quest, it
 * offers Add items (to the Lists tab) instead; and leaving a real trip
 * offers End quest, which closes the trip so it never shows as Resume. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  // Empty the list the game reads (the demo household suggests items too).
  await page.evaluate(async () => {
    const plan = await (await fetch("/api/quest/plan")).json();
    for (const it of plan.list || [])
      await fetch("/api/list/remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item_id: it.item_id }) });
  });
  await page.evaluate(() => window.__aryaShow("community"));
  await page.waitForSelector("#view-community .qg-home");
  const cta = page.locator("#view-community .qg-cta");
  if (await cta.locator(".qg-btn", { hasText: /real quest|Start a quest|Start at/ }).count())
    throw new Error("an empty list must not offer a quest");
  await cta.locator(".qg-btn", { hasText: /Add items/ }).first().click();
  await page.waitForSelector("#view-list", { state: "visible" });
  await endQuest(page);
}

/* A real trip is saved on its first grab; End quest closes it. */
export async function endQuest(page) {
  await page.evaluate(() => fetch("/api/list/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Milk" }) }));
  await page.evaluate(() => window.__aryaShow("home"));
  await page.evaluate(() => window.__aryaShow("community"));
  await page.waitForSelector("#view-community .qg-home");
  const v = page.locator("#view-community");
  await v.locator(".qg-cta .qg-btn", { hasText: /real quest|Start a quest/ }).first().click();
  await v.locator(".qg-pick").waitFor();
  // Any store: all stores when none is near.
  if (!(await v.locator(".qg-stores .qg-store:not(.find)").count())) await v.locator(".qg-store.find").click();
  await v.locator(".qg-stores .qg-store:not(.find)").first().click();
  await page.waitForSelector('#view-community .qg[data-screen="play"]');
  const open = () => page.evaluate(async () => {
    const r = await (await fetch("/api/quest/sessions")).json();
    return (r.sessions || r).filter(s => s.state !== "abandoned" && s.state !== "done").length;
  });
  const before = await open();
  await v.locator(".qg-mission .qg-btn", { hasText: "Let's go" }).click();
  // Nothing is saved until the first grab.
  if ((await open()) !== before) throw new Error("a trip with no grab must not be saved");
  await page.click("#view-community .qg-basket");
  await v.locator(".qg-list-h").first().click();
  await v.locator(".qg-shelf .qg-got").click({ timeout: 30000 });
  await page.waitForFunction(async n => {
    const r = await (await fetch("/api/quest/sessions")).json();
    return r.sessions.filter(s => s.state !== "abandoned" && s.state !== "done").length === n;
  }, before + 1, { polling: 300 });
  await page.click('#view-community [aria-label="Leave the quest"]');
  await page.click("#qg-endquest");
  await page.waitForSelector("#view-community .qg-home");
  if ((await open()) !== before) throw new Error("End quest left the session open");
}
