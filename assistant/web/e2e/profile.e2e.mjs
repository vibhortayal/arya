/* Profile (Settings tab): avatar editor, account rows, currency, nav rows, delete box, sign out. */
export default async function (page, base) {
  await page.goto(base + "/next/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  await page.evaluate(() => window.__aryaShow("profile"));
  await page.waitForSelector("#view-profile");
  // Opened as a tab (no params.from): no Back link.
  if (await page.$("#pf-back")) throw new Error("Back link should be hidden on the Settings tab");
  for (const sel of ["#pf-avatar", "#av-edit-btn", "#profile-account", "#pf-currency", "#btn-receipts", "#btn-signout2"])
    await page.waitForSelector(sel, { state: "attached" });
  const acct = await page.textContent("#profile-account");
  if (!acct.includes("Signed in as") || !acct.includes("demo")) throw new Error("account rows wrong: " + acct);
  // Avatar editor opens and closes.
  await page.click("#av-edit-label");
  await page.waitForSelector("#av-panel", { state: "visible" });
  if ((await page.textContent("#av-edit-label")) !== "Done") throw new Error("edit label should read Done");
  await page.click("#av-edit-btn");
  await page.waitForSelector("#av-panel", { state: "hidden" });
  // Delete box toggles.
  await page.click("#btn-del-account");
  await page.waitForSelector("#del-account-box", { state: "visible" });
  await page.click("#btn-del-account");
  await page.waitForSelector("#del-account-box", { state: "hidden" });
  // Row opens another screen, then Back-less return via the nav stack.
  await page.click("#btn-about");
  await page.waitForFunction(() => document.querySelector("#view-about") && !document.querySelector("#view-profile"));
  await page.click("#pfa-back");
  await page.waitForSelector("#view-profile");
  // From the avatar: Back is shown and returns.
  await page.evaluate(() => window.__aryaShow("home"));
  await page.waitForSelector("#view-home");
  await page.click("#avatar-btn");
  await page.waitForSelector("#pf-back");
  await page.click("#pf-back");
  await page.waitForFunction(() => !document.querySelector("#view-profile"));
}
