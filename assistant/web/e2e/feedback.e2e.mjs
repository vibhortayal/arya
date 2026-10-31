/* Feedback in the demo: no form; Send from Finish demo opens the end-of-demo
 * sheet, the demo's one feedback door (retest 2026-10-31 #14). Back works. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  await page.evaluate(() => window.__aryaShow("feedback"));
  await page.waitForSelector("#view-feedback");
  if (await page.$("#fb-text")) throw new Error("the demo should not show a form it cannot send");
  if (!(await page.textContent("#fb-status")).includes("Finish demo")) throw new Error("demo status");
  await page.click("#fb-send");
  await page.waitForSelector("#ed-text");
  await page.keyboard.press("Escape");
  await page.click("#fb-back");
  await page.waitForFunction(() => !document.querySelector("#view-feedback"));
}
