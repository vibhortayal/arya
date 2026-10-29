/* Add a store: screen renders, typing works, Back works. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  await page.evaluate(() => window.__aryaShow("stores-add"));
  await page.waitForSelector("#view-stores-add");
  const h = await page.textContent("#view-stores-add h2.largetitle");
  if (h !== "Add a store") throw new Error("title: " + h);
  await page.fill("#sa-q", "Cos");
  if ((await page.inputValue("#sa-q")) !== "Cos") throw new Error("input");
  await page.keyboard.press("Escape");
  if (!(await page.isHidden("#sa-results"))) throw new Error("drop should be hidden");
  await page.click("#view-stores-add .qback");
  await page.waitForFunction(() => !document.querySelector("#view-stores-add"));
}
