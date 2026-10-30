/* Item: detail renders for a real item, action buttons answer, back link leaves. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  const id = await page.evaluate(async () => {
    const h = await (await fetch("/api/home")).json().catch(() => ({}));
    const it = ((h.list && h.list.items) || [])[0];
    return it ? it.item_id : null;
  });
  if (!id) throw new Error("demo list has no item to open");
  await page.evaluate(i => window.__aryaShow("item", { id: i }), id);
  await page.waitForSelector("#view-item");
  await page.waitForSelector("#item-detail .largetitle");
  for (const s of ["#btn-add", "#btn-never", "#btn-expired"]) await page.waitForSelector(s);
  await page.click("#btn-add");
  await page.waitForFunction(() => document.querySelector("#flag-result").textContent === "Added to your list.");
  await page.click("#item-back");
  await page.waitForFunction(() => !document.querySelector("#view-item"));
}
