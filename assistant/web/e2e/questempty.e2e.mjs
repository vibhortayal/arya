/* Usability fixes (2026-10-29): an empty list never starts a quest, it
 * offers Add items (to the Lists tab) instead; and leaving a real trip
 * offers End quest, which closes the trip so it never shows as Resume. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  // Empty every list the demo has, then open Quest.
  await page.evaluate(async () => {
    const lists = await (await fetch("/api/lists")).json();
    for (const l of (lists.lists || lists))
      for (const it of l.items || [])
        await fetch("/api/list/remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item_id: it.item_id || it.id }) });
  });
  await page.evaluate(() => window.__aryaShow("community"));
  await page.waitForSelector("#view-community .qg-home");
  const cta = page.locator("#view-community .qg-cta");
  if (await cta.locator(".qg-btn", { hasText: /real quest|Start a quest/ }).count())
    throw new Error("an empty list must not offer a quest");
  await cta.locator(".qg-btn", { hasText: /Add items/ }).first().click();
  await page.waitForSelector("#view-list", { state: "visible" });
  await endQuest(page);
}

/* End quest on a real trip closes the server session. */
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
  if (!before) throw new Error("a real quest should open a session");
  await v.locator(".qg-mission .qg-btn", { hasText: "Let's go" }).click();
  await page.click('#view-community [aria-label="Leave the quest"]');
  await page.click("#qg-endquest");
  await page.waitForSelector("#view-community .qg-home");
  if ((await open()) !== before - 1) throw new Error("End quest left the session open");
}
