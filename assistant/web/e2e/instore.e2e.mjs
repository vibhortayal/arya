/* The in-store screen (owner approved the mockup 2026-10-30): one quiet
 * status cue whose Map it opens a sheet, no "not mapped" banner, and one
 * List sheet (add at the top, sections in walking order, reorder and
 * skip behind one link) instead of Route and List. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  for (const name of ["Milk", "Bananas"])
    await page.evaluate(n => fetch("/api/list/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: n }) }), name);
  await page.evaluate(() => window.__aryaShow("community"));
  await page.waitForSelector("#view-community .qg-home");
  const v = page.locator("#view-community");
  await v.locator(".qg-cta .qg-btn", { hasText: /real quest|Start a quest|Start at/ }).first().click();
  if (await v.locator(".qg-pick").count() || await v.locator(".qg-pick").waitFor({ timeout: 3000 }).then(() => true, () => false)) {
    if (!(await v.locator(".qg-stores .qg-store:not(.find)").count())) await v.locator(".qg-store.find").click();
    await v.locator(".qg-stores .qg-store:not(.find)").first().click();
  }
  await page.waitForSelector('#view-community .qg[data-screen="play"]');
  await v.locator(".qg-mission .qg-btn", { hasText: "Let's go" }).click();

  // One row of header, at most one status cue, no banner.
  if (await v.locator(".qg-play .qg-kind, .qg-play .qg-pill, .qg-mapcard").count()) throw new Error("old not-mapped badges are back");
  if ((await v.locator(".qg-cue").count()) > 1) throw new Error("more than one status cue");
  const mapIt = v.locator("button.qg-cue");
  if (await mapIt.count()) {
    await mapIt.click();
    await v.locator("#qg-mapnow").waitFor();
    await v.locator(".qg-sheet .qg-btn", { hasText: "Keep playing" }).click();
    await v.locator("#qg-mapnow").waitFor({ state: "detached" });
  }

  // Let's go walks to the first item; walk away to see the dock.
  await v.locator(".qg-shelf-x").click({ timeout: 30000 });
  // Route is gone; the List button says what is left.
  if (await v.locator(".qg-dock-row button", { hasText: /^Route$/ }).count()) throw new Error("Route button still there");
  await v.locator(".qg-dock-row button", { hasText: /^List · \d+ left$/ }).click();
  const sheet = v.locator('.qg-sheet[aria-label^="Your list"]');
  await sheet.locator(".qg-add input").fill("peanut butter");
  await sheet.locator(".qg-add button").click();
  await sheet.locator(".qg-list-i", { hasText: "Peanut butter" }).waitFor();
  if (!(await sheet.locator(".qg-list-h").first().textContent()).startsWith("1 · ")) throw new Error("sections are not numbered in walking order");
  await sheet.locator(".qg-list-edit").click();
  await sheet.locator(".qg-route li").first().waitFor();
  await sheet.locator(".qg-route button.sk").first().click();
  await sheet.locator(".qg-route button.sk", { hasText: "Add back" }).first().click();
  await sheet.locator(".qg-btn", { hasText: "Done" }).click();
  await sheet.locator(".qg-list-h").first().click();
  await v.locator(".qg-shelf").waitFor({ timeout: 30000 });
}
