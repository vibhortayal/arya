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
}
