/* Landing → demo → shell with five tabs; Settings opens Profile.
 * Landing B1 (owner, 2026-10-29): a tapped card flips and stops
 * wobbling for good; "Start my own list" opens the sheet in register
 * mode while registration is open (the e2e API runs with
 * ARYA_REGISTRATION_OPEN=1) and is gone when it is closed; both
 * buttons are reachable on Safari's visible area (390 x 664) with one scroll (eight cards). "Get the app"
 * (owner, 2026-10-29): not on this desktop browser; on an iPhone it
 * sits in the one-line header before Sign in, even at 360 wide, and
 * opens the steps sheet. */
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

async function getTheApp(page, base) {
  const ctx = await page.context().browser().newContext({ viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true, userAgent: IPHONE });
  const ip = await ctx.newPage();
  const errors = [];
  ip.on("pageerror", e => errors.push(e.message));
  try {
    await ip.goto(base + "/");
    await ip.waitForSelector("#getapp-open.jiggle");
    // Eight cards: the buttons are one scroll away on a short phone.
    for (const id of ["#demo-btn", "#register-open"]) {
      await ip.locator(id).scrollIntoViewIfNeeded();
      const box = await ip.locator(id).boundingBox();
      if (!box || box.y + box.height > 664) throw new Error(id + " cannot be scrolled into view at 390x664 with the pill: " + JSON.stringify(box));
    }
    await ip.evaluate(() => window.scrollTo(0, 0));
    for (const w of [390, 360]) {
      await ip.setViewportSize({ width: w, height: 664 });
      const [logo, pill, sign] = await Promise.all(["landlogo", "gethome", "landsign"].map(c => ip.locator(".landtop ." + c).boundingBox()));
      const mid = b => b.y + b.height / 2;
      if (Math.abs(mid(logo) - mid(pill)) > 2 || Math.abs(mid(pill) - mid(sign)) > 2 || pill.height > 40)
        throw new Error("header wraps at " + w + ": " + JSON.stringify({ logo, pill, sign }));
      if (sign.x + sign.width > w) throw new Error("Sign in off screen at " + w);
    }
    await ip.click("#getapp-open");
    await ip.waitForSelector("#a2hs-sheet ol.steps li");
    const text = await ip.textContent("#a2hs-sheet");
    for (const s of ["Get the Arya app", "Free, no app store.", "Add to Home Screen", "Tip: sign in from the Home Screen app."])
      if (!text.includes(s)) throw new Error("steps sheet lacks: " + s);
    if (await ip.$("#getapp-open.jiggle")) throw new Error("the pill still jiggles after a tap");
    await ip.keyboard.press("Escape");
    await ip.reload();
    await ip.waitForSelector("#getapp-open:not(.jiggle)");
    if (errors.length) throw new Error("iPhone page errors: " + errors.join("; "));
  } finally { await ctx.close(); }
}
export default async function (page, base) {
  await page.setViewportSize({ width: 390, height: 664 });
  await page.goto(base + "/");
  await page.waitForSelector("#demo-btn");
  // Eight cards make the landing a little taller than a short phone:
  // the buttons are one scroll away, never cut off.
  for (const id of ["#demo-btn", "#register-open"]) {
    await page.locator(id).scrollIntoViewIfNeeded();
    const box = await page.locator(id).boundingBox();
    if (!box || box.y + box.height > 664) throw new Error(id + " cannot be scrolled into view at 390x664: " + JSON.stringify(box));
  }
  if ((await page.$$(".ftile")).length !== 8) throw new Error("the landing has eight cards");
  await page.evaluate(() => window.scrollTo(0, 0));
  if (await page.isVisible("#how-open")) throw new Error("How it works is still on the landing");
  if (await page.$("#getapp-open")) throw new Error("Get the app shows on a desktop browser");
  await getTheApp(page, base);

  // Flip once: the card stops wobbling, and stays still after a reload.
  await page.click("#land-maps");
  await page.waitForSelector("#land-maps.on.seen[aria-pressed=true]");
  await page.reload();
  await page.waitForSelector("#land-maps.seen:not(.on)");
  if (await page.$("#land-lists.seen")) throw new Error("an untapped card stopped wobbling");

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
