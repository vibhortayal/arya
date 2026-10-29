/* A list for a store goes to that store (usability audit, pain 4).
 * Returning player: Start shopping on the list opens the trip there.
 * The Quest home says "Start at <store>"; "Shop somewhere else" opens
 * the store pick, which leads with the list's store under Your stores. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  const { listId, store } = await page.evaluate(async () => {
    const j = { "Content-Type": "application/json" };
    const rows = (await (await fetch("/api/stores/search?q=")).json()).stores || [];
    if (!rows.length) throw new Error("no stores to pick from");
    const store = rows[rows.length - 1].name;
    const l = await (await fetch("/api/lists", { method: "POST", headers: j, body: JSON.stringify({ name: "Weekend run", stores: [store] }) })).json();
    await fetch("/api/list/add", { method: "POST", headers: j, body: JSON.stringify({ name: "Bananas", list_id: l.id }) });
    // Past the first-run practice nudge.
    const me = await (await fetch("/auth/me")).json();
    localStorage.setItem(`arya-quest:${me.user}:flags`, JSON.stringify({ practiced: true }));
    return { listId: l.id, store };
  });
  const v = page.locator("#view-community");

  // Start shopping on the list: straight into the trip at its store.
  await page.evaluate(id => window.__aryaShow("community", { listId: id }), listId);
  await page.waitForSelector('#view-community .qg[data-screen="play"]');
  if (!(await v.textContent('.qg[data-screen="play"]')).includes(store)) throw new Error("trip is not at " + store);
  await v.locator(".qg-mission .qg-btn", { hasText: "Let's go" }).click();
  await page.click('#view-community [aria-label="Leave the quest"]');
  // Nothing grabbed: End quest, or Leave once an ungrabbed trip is not saved.
  await page.locator('#view-community .qg-opts .qg-btn', { hasText: /^(End quest|Leave)$/ }).first().click();
  await page.waitForSelector("#view-community .qg-home");

  // The home names the store; Shop somewhere else leads with it.
  await v.locator(".qg-lists button", { hasText: "Weekend run" }).click();
  await v.locator(".qg-cta .qg-btn", { hasText: "Start at " + store }).waitFor();
  await page.click("#qg-otherstore");
  await v.locator(".qg-pick").waitFor();
  if ((await v.locator(".qg-kicker").first().textContent()) !== "Your stores") throw new Error("pick heading");
}
