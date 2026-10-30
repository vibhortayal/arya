/* The fog nudge (owner, 2026-10-30): after a find in a section Arya has
 * not located, one small line offers Snap; the photo is taken inside
 * the game (the trip stays open) and goes to Map my store's scan. This
 * runtime has no reader key, so the scan refuses and the nudge says why. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  await page.evaluate(() => fetch("/api/list/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Milk" }) }));
  await page.evaluate(() => window.__aryaShow("community"));
  await page.waitForSelector("#view-community .qg-home");
  const v = page.locator("#view-community");
  await v.locator(".qg-cta .qg-btn", { hasText: /real quest|Start a quest|Start at/ }).first().click();
  if (await v.locator(".qg-pick").waitFor({ timeout: 3000 }).then(() => true, () => false)) {
    if (!(await v.locator(".qg-stores .qg-store:not(.find)").count())) await v.locator(".qg-store.find").click();
    await v.locator(".qg-stores .qg-store:not(.find)").first().click();
  }
  await page.waitForSelector('#view-community .qg[data-screen="play"]');
  await v.locator(".qg-mission .qg-btn", { hasText: "Let's go" }).click();
  await v.locator(".qg-shelf .qg-got").click({ timeout: 30000 });
  const nudge = v.locator(".qg-nudge");
  await nudge.waitFor();
  if (!/Snap the shelf/.test(await nudge.textContent())) throw new Error("the nudge should offer a shelf photo");
  const jpeg = await page.evaluate(() => {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d"); g.fillStyle = "#c84"; g.fillRect(0, 0, 64, 64);
    return c.toDataURL("image/jpeg").split(",")[1];
  });
  await nudge.locator("input.qg-snapfile").setInputFiles({ name: "shelf.jpg", mimeType: "image/jpeg", buffer: Buffer.from(jpeg, "base64") });
  await v.locator(".qg-nudge.fail, .qg-nudge.done").waitFor({ timeout: 30000 });
  // Still in the trip: the photo never left the game.
  await page.waitForSelector('#view-community .qg[data-screen="play"]');
}
