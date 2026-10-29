/* Album: loads, shows the page tabs and slots, a sticker opens its sheet, Back leaves. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  await page.evaluate(() => window.__aryaShow("album"));
  await page.waitForSelector("#view-album #alb-body .muted.albprivate");
  const sub = await page.textContent("#alb-sub");
  if (!/sticker/.test(sub)) throw new Error("sub: " + sub);
  const total = await page.evaluate(async () => (await (await fetch("/api/quest/album")).json()).total || 0);
  if (total > 0) {
    await page.waitForSelector(".albtab");
    await page.waitForSelector(".albpage .albgrid");
    const slot = await page.$(".albslot[data-alb-slot]");
    if (slot) {
      await slot.click();
      await page.waitForSelector("#alb-sheet .albsheettitle");
      await page.click("#alb-sheet [data-alb-close]");
      await page.waitForSelector("#alb-sheet", { state: "detached" });
    }
    const tabs = await page.$$(".albtab");
    if (tabs.length > 1) {
      await tabs[1].click();
      if ((await tabs[1].getAttribute("aria-pressed")) !== "true") throw new Error("tab not pressed");
    }
  } else if (!(await page.isVisible(".albempty"))) throw new Error("empty state missing");
  await page.click("#view-album .qback");
  await page.waitForSelector("#view-album", { state: "detached" });
}
