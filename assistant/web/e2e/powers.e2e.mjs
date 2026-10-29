/* Powers: groups render (Working for you folded), an (i) sheet opens and closes, the share flow opens, Back returns. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  await page.evaluate(() => window.__aryaShow("home"));
  await page.evaluate(() => window.__aryaShow("powers"));
  await page.waitForSelector("#powers-body .pwgroup");
  const txt = await page.textContent("#view-powers");
  for (const t of ["Arya's powers", "Working for you", "You choose to turn on", "Community prices"])
    if (!txt.includes(t)) throw new Error("missing: " + t);
  if ((await page.$$("#powers-body .pwgroup")).length < 2) throw new Error("groups missing");
  if (await page.$eval("#powers-body .pwgroup", d => d.open)) throw new Error("Working for you should be folded");
  await page.click("#powers-body .pwgroup summary");
  if (!(await page.$eval("#powers-body .pwgroup", d => d.open))) throw new Error("group did not open");
  if ((await page.$$("#powers-body .powrow")).length < 8) throw new Error("no power rows");
  // The (i) on a share power opens its sheet with a Share prices button.
  await page.click('#powers-body .infobtn[data-info="community"]');
  await page.waitForSelector("#info-sheet .whyrow");
  await page.click("#info-sheet [data-pw=share]");
  await page.waitForSelector("#info-sheet >> text=Shop smarter together");
  await page.click("#info-sheet [data-pw=close]");
  await page.waitForSelector("#info-sheet", { state: "detached" });
  await page.click('#powers-body .infobtn[data-info="ask"]');
  await page.waitForSelector("#info-sheet .whyrow");
  await page.keyboard.press("Escape");
  await page.waitForSelector("#info-sheet", { state: "detached" });
  await page.click("#pw-back");
  await page.waitForSelector("#view-home");
}
