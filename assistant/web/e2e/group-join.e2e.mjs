/* Join a group: field formats the code, Join stays off until a valid
 * preview, Back returns to Profile. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  await page.evaluate(() => window.__aryaShow("group-join"));
  await page.waitForSelector("#view-group-join #gj-code");
  if (!(await page.isDisabled("#gj-go"))) throw new Error("Join should start disabled");
  await page.fill("#gj-code", "abc-def");
  const v = await page.inputValue("#gj-code");
  if (v !== "ABC DEF" && v !== "abc-def") throw new Error("code value: " + v);
  await page.fill("#gj-code", "ZZZZZZ");
  await page.waitForFunction(() => document.querySelector("#gj-preview").textContent.trim().length > 0, null, { timeout: 5000 });
  if (!(await page.isDisabled("#gj-go"))) throw new Error("Join should stay disabled without a group");
  if (!(await page.textContent("#view-group-join")).includes("You can leave any time from Profile.")) throw new Error("footer text");
  await page.click("#gj-back");
  await page.waitForSelector("#view-profile");
}
