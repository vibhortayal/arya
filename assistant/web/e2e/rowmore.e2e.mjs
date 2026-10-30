/* The row's ⋯ button (owner 2026-10-30): Move and Remove are reachable
 * without swiping. Opens a sheet with the item's name; Move opens the
 * move sheet; Remove takes the item off the list. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  await page.click('#tabs button[data-view="view-list"]');
  await page.click('[data-open-list="l-demo-tj"]');
  await page.waitForSelector(".listrow .morebtn");
  const rows = await page.$$eval(".listrow", r => r.length), btns = await page.$$eval(".listrow .morebtn", r => r.length);
  if (rows !== btns) throw new Error("a row has no ⋯ button: " + rows + " rows, " + btns + " buttons");
  const box = await page.$eval(".listrow .morebtn", b => { const r = b.getBoundingClientRect(); return [r.width, r.height]; });
  if (box[0] < 44 || box[1] < 44) throw new Error("⋯ button under 44pt: " + box);
  const name = await page.$eval(".listrow .name", n => n.textContent);
  await page.click(".listrow .morebtn");
  await page.waitForSelector('#list-sheet [data-ls="row-move"]');
  if (!(await page.textContent("#ls-title")).includes(name)) throw new Error("sheet title is not the item: " + name);
  await page.click('[data-ls="row-move"]');
  await page.waitForSelector("#list-sheet [data-ls-move]");
  await page.keyboard.press("Escape");
  await page.waitForSelector("#list-sheet", { state: "detached" });
  const before = await page.$$eval(".listrow", r => r.length);
  await page.click(".listrow .morebtn");
  await page.click('[data-ls="row-remove"]');
  await page.waitForFunction(n => document.querySelectorAll(".listrow").length < n, before);
}
