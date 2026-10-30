/* Start shopping goes straight into the store (UI/UX pass 2026-10-30):
 * no one-option sheet, no lobby, no second "Where are you shopping?"
 * for a list that already names its store ("Costco" finds "Costco
 * Wholesale"). In the store, the strip chips, the list button and the
 * HUD icons are 44pt tap targets. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  await page.evaluate(() => window.__aryaShow("list"));
  await page.waitForSelector("#list-cards .listcard");
  const card = page.locator("#list-cards [data-open-list]", { hasText: "Costco" }).first();
  await card.click();
  await page.waitForSelector("#list-page");
  await page.click("#list-hunt");
  if (await page.$("#shop-sheet")) throw new Error("Start shopping should skip the sheet");
  const v = page.locator("#view-community");
  await page.waitForSelector('#view-community .qg[data-screen="play"]', { timeout: 15000 });
  if (await v.locator(".qg-pick").count()) throw new Error("the store was asked for again");
  const lets = v.locator(".qg-mission .qg-btn", { hasText: "Let's go" });
  if (await lets.count()) await lets.click();
  await v.locator(".qg-strip .qg-chip").first().waitFor({ timeout: 30000 });
  const small = await page.evaluate(() => {
    const out = [];
    const check = (el, name) => {
      const r = el.getBoundingClientRect();
      const b = getComputedStyle(el, "::before");
      const pad = b.content && b.content !== "none" ? [parseFloat(b.top), parseFloat(b.bottom)] : [0, 0];
      const h = r.height - pad[0] - pad[1];
      if (h < 44) out.push(`${name} ${Math.round(h)}`);
    };
    document.querySelectorAll("#view-community .qg-strip .qg-chip").forEach(el => check(el, "chip"));
    document.querySelectorAll("#view-community .qg-listbtn, #view-community .qg-live .qg-hud .qg-ic, #view-community .qg-live .qg-cue").forEach(el => check(el, el.className));
    return out;
  });
  if (small.length) throw new Error("tap targets under 44pt: " + small.join(", "));
}
