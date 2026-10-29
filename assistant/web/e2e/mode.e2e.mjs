/* Mode picker: a store with no aisle pictures (every store, since the
 * old Trader Joe's walk was removed) offers Express only, and a Quest
 * ask falls back to Express; fastMode skips the picker. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  const show = (fastMode) => page.evaluate((fastMode) => {
    const draft = { raw: [], store: "Trader Joe's", storeId: null, pick: {}, fromList: null, fastMode,
      undone: {}, answers: {}, opt: null, baseItems: [],
      finalItems: [{ name: "Milk", qty: 1 }, { name: "Bread", qty: 2 }] };
    window.__aryaShow("mode", { draft });
  }, fastMode);
  const shown = (v) => page.waitForFunction(v => {
    const s = document.getElementById("view-" + v); return s && !s.hidden && s.offsetParent !== null;
  }, v, { timeout: 8000 });

  await show(null);
  await page.waitForSelector("#view-mode .modecard[data-mode='express']");
  if (!(await page.$eval("#view-mode .modecard[data-mode='quest']", b => b.hidden))) throw new Error("Quest needs aisle pictures");
  const created = page.waitForResponse(r => r.url().includes("/api/quest/sessions") && r.request().method() === "POST");
  await page.click("#view-mode .modecard[data-mode='express']");
  const r = await created;
  if (!r.ok()) throw new Error("create session " + r.status());
  if (JSON.parse(r.request().postData()).mode !== "express") throw new Error("wrong mode posted");
  await shown("express");

  await show("quest");
  await shown("express");
}
