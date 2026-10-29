/* Landing → demo → shell with five tabs; Settings opens Profile.
 * Landing B1 (owner, 2026-10-29): a tapped card flips and stops
 * wobbling for good; "Start my own list" opens the sheet in register
 * mode while registration is open (the e2e API runs with
 * ARYA_REGISTRATION_OPEN=1) and is gone when it is closed; both
 * buttons fit in Safari's visible area (390 x 664). */
export default async function (page, base) {
  await page.setViewportSize({ width: 390, height: 664 });
  await page.goto(base + "/");
  await page.waitForSelector("#demo-btn");
  for (const id of ["#demo-btn", "#register-open"]) {
    const box = await page.locator(id).boundingBox();
    if (!box || box.y + box.height > 664) throw new Error(id + " is below the fold at 390x664: " + JSON.stringify(box));
  }
  if (await page.isVisible("#how-open")) throw new Error("How it works is still on the landing");

  // Flip once: the card stops wobbling, and stays still after a reload.
  await page.click("#land-quest");
  await page.waitForSelector("#land-quest.on.seen[aria-pressed=true]");
  await page.reload();
  await page.waitForSelector("#land-quest.seen:not(.on)");
  if (await page.$("#land-habits.seen")) throw new Error("an untapped card stopped wobbling");

  // Start my own list → register mode.
  await page.click("#register-open");
  await page.waitForSelector("#signin-sheet");
  const btn = await page.textContent("#login-btn");
  if (btn !== "Create account") throw new Error("register sheet button: " + btn);
  await page.keyboard.press("Escape");

  // Closed registration: no Start my own list.
  await page.route("**/auth/status", async route => {
    const r = await route.fetch();
    await route.fulfill({ response: r, json: { ...(await r.json()), registration_open: false } });
  });
  await page.reload();
  await page.waitForSelector("#demo-btn");
  if (await page.$("#register-open")) throw new Error("Start my own list shows while registration is closed");
  await page.unroute("**/auth/status");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.click("#demo-btn");
  await page.waitForSelector("#tabs");
  const labels = await page.$$eval("#tabs button span", s => s.map(x => x.textContent));
  if (labels.join() !== "Today,Lists,Ask,Quest,Settings") throw new Error("tabs: " + labels);
  if (!(await page.isVisible("#demobar"))) throw new Error("demo bar missing");
  await page.click('#tabs button[data-view="view-profile"]');
  await page.waitForSelector("#view-profile");
}
