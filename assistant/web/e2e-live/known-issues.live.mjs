/* Bugs found on 2026-10-31 in the demo. Each check passes once the bug
 * is fixed; run with ARYA_LIVE_KNOWN=1. Delete a check when it passes
 * for good. */
export default async function (t) {
  const page = await t.newPhone("known");
  await page.goto(t.base + "/");
  await page.click("#demo-btn");
  await page.waitForSelector("#tabs");
  const fail = [];

  // 1. "mlik" should become the tracked Whole Milk, not a new item.
  await t.api(page, "/api/list/add", { name: "mlik" });
  const h1 = (await t.api(page, "/api/home")).json;
  if (h1.list.items.some(i => i.on_list && i.name === "mlik")) fail.push("typed 'mlik' is a new item named mlik");

  // 2. "3 avocados" on a list that has Avocados 4 ct should raise its amount, not add a second row.
  await t.api(page, "/api/list/add", { name: "3 avocados" });
  const h2 = (await t.api(page, "/api/home")).json;
  if (h2.list.items.filter(i => i.on_list && /avocado/i.test(i.name)).length > 1) fail.push("'3 avocados' made a second avocado row");

  // 3. Unknown addresses should get a page, not raw JSON.
  await page.goto(t.base + "/no-such-page");
  if ((await page.textContent("body")).trim().startsWith("{")) fail.push("unknown address shows raw JSON");

  await page.context().close();
  if (fail.length) throw new Error(fail.join("; "));
}
