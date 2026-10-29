/* Feedback: kinds toggle, counter, demo send is disabled, Back works. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  await page.evaluate(() => window.__aryaShow("feedback"));
  await page.waitForSelector("#view-feedback");
  const pressed = async k => page.getAttribute(`#fb-kinds [data-kind="${k}"]`, "aria-pressed");
  if ((await pressed("idea")) !== "true") throw new Error("idea not pressed by default");
  await page.click('#fb-kinds [data-kind="bug"]');
  if ((await pressed("bug")) !== "true" || (await pressed("idea")) !== "false") throw new Error("kind toggle failed");
  await page.fill("#fb-text", "hello");
  if ((await page.textContent("#fb-count")).trim() !== "5 / 1000") throw new Error("counter");
  if (!(await page.isDisabled("#fb-send"))) throw new Error("send should be disabled in the demo");
  if (!(await page.textContent("#fb-status")).includes("Sign in with a real account")) throw new Error("demo status");
  await page.click("#fb-back");
  await page.waitForFunction(() => !document.querySelector("#view-feedback"));
}
