/* Express run: rows check off (first tap starts the run), the help row
 * follows the next item, Not here? opens
 * its sheets, More help shows Ask Arya / Teach, Finish leaves the items
 * sheet and goes to the finish screen. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  await page.evaluate(async () => {
    const r = await fetch("/api/quest/sessions", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ store: "Trader Joe's", mode: "express", items: [{ name: "Milk", qty: 1 }, { name: "Bread", qty: 2 }, { name: "Eggs", qty: 1 }] }) });
    if (!r.ok) throw new Error("create session " + r.status);
    window.__aryaShow("express", { session: await r.json() });
  });
  await page.waitForSelector("#view-express #exp-items .exprow", { timeout: 8000 });
  const rows = () => page.$$("#view-express #exp-items .exprow");
  if ((await rows()).length !== 3) throw new Error("expected three rows");
  if (!(await page.textContent("#exp-store")).includes("Trip")) throw new Error("store chip");
  if ((await page.textContent("#exp-count")).trim() !== "0/3") throw new Error("count");
  if (!(await page.isDisabled("#exp-finish"))) throw new Error("finish should wait for the first tap");
  if (!(await page.$("#exp-items #exp-help:not([hidden])"))) throw new Error("help row missing under next item");

  // Names come back resolved ("Whole Milk 1 gal"), so read them off the rows.
  const names = await page.$$eval("#exp-items .exprow", rs => rs.map(r => r.getAttribute("data-exp-check")));
  const M = names.find(n => /milk/i.test(n)) || names[0];
  // The first tap starts the run and checks the row.
  await page.click(`#exp-items [data-exp-check="${M}"]`);
  await page.waitForFunction(() => document.querySelector("#exp-count").textContent.trim() === "1/3");
  if (await page.isDisabled("#exp-finish")) throw new Error("finish should be live");
  if (!(await page.getAttribute(`#exp-items [data-exp-check="${M}"]`, "aria-pressed")).includes("true")) throw new Error("row not pressed");
  // Tapping again unchecks.
  await page.click(`#exp-items [data-exp-check="${M}"]`);
  await page.waitForFunction(() => document.querySelector("#exp-count").textContent.trim() === "0/3");

  // Show me needs aisle pictures; no store ships with them (the
  // no-data case is pinned at the end).
  if (await page.isVisible("#exp-show")) throw new Error("Show me needs aisle pictures");

  // Not here? opens the Can't find sheet, then the report sheet.
  await page.click("#exp-nothere");
  await page.waitForSelector("#hunt-sheet [data-act=tell]");
  await page.click("#hunt-sheet [data-act=tell]");
  await page.waitForSelector("#spot-sheet [data-kind]");
  if ((await page.$$("#spot-sheet [data-kind]")).length !== 4) throw new Error("four report kinds");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector("#spot-sheet"));

  // More help.
  if (await page.isVisible("#exp-ask")) throw new Error("more help should start closed");
  await page.click("#exp-more");
  await page.waitForSelector("#exp-ask", { state: "visible" });
  await page.click("#exp-ask");
  await page.waitForSelector("#ask-sheet #ask-text");
  await page.keyboard.press("Escape");

  // Finish with items open: leave sheet, keep hunting, then check out.
  await page.click("#exp-finish");
  await page.waitForSelector("#hunt-sheet [data-act=checkout]");
  await page.click("#hunt-sheet [data-act=keep]");
  await page.waitForFunction(() => !document.querySelector("#hunt-sheet"));
  for (const n of names) {
    await page.click(`#exp-items [data-exp-check="${n}"]`);
    await page.waitForFunction(n => document.querySelector(`[data-exp-check="${n}"]`).getAttribute("aria-pressed") === "true", n);
  }
  if ((await page.textContent("#exp-count")).trim() !== "3/3") throw new Error("all checked");
  await page.click("#exp-finish");
  await page.waitForFunction(() => { const s = document.getElementById("view-finish"); return !!s; });

  // A store with no aisle pictures: Show me goes, the Snap the aisle
  // nudge comes, and the link opens the guided capture for that item.
  await page.evaluate(async () => {
    const r = await fetch("/api/quest/sessions", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ store: "Costco Wholesale", mode: "express", items: [{ name: "Paper Towels 6 ct", qty: 1 }] }) });
    if (!r.ok) throw new Error("create session " + r.status);
    window.__aryaShow("express", { session: await r.json() });
  });
  await page.waitForSelector("#exp-items #exp-nodata:not([hidden])", { timeout: 8000 });
  if (await page.isVisible("#exp-show")) throw new Error("Show me should be gone for an item with no data");
  if (!(await page.isVisible("#exp-nothere")) || !(await page.isVisible("#exp-find"))) throw new Error("Not here? and Find with camera stay");
  const nudge = (await page.textContent("#exp-nodata")).replace(/\s+/g, " ").trim();
  if (nudge !== "No photo of this aisle yet. Found it? Map this aisle so other Arya shoppers can find it.") throw new Error("nudge: " + nudge);
  await page.click("#exp-snap");
  await page.waitForSelector("#view-capture #cp-title");
  await page.waitForFunction(() => document.querySelector("#cp-title").textContent.startsWith("Snap the aisle with"));
  if (!(await page.isVisible("#cp-govideo"))) throw new Error("video option missing");
}
