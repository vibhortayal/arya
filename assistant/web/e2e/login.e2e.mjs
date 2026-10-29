/* Landing → demo → shell with five tabs; Settings opens Profile. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.waitForSelector("#demo-btn");
  await page.click("#how-open");
  await page.waitForSelector("#how-sheet");
  await page.keyboard.press("Escape");
  await page.click("#demo-btn");
  await page.waitForSelector("#tabs");
  const labels = await page.$$eval("#tabs button span", s => s.map(x => x.textContent));
  if (labels.join() !== "Today,Lists,Ask,Quest,Settings") throw new Error("tabs: " + labels);
  if (!(await page.isVisible("#demobar"))) throw new Error("demo bar missing");
  await page.click('#tabs button[data-view="view-profile"]');
  await page.waitForSelector("#view-profile");
}
