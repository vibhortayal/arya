/* Profile (Settings tab): avatar editor, account rows, currency, nav rows, delete box, sign out. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  await page.evaluate(() => window.__aryaShow("profile"));
  await page.waitForSelector("#view-profile");
  // Opened as a tab (no params.from): no Back link.
  if (await page.$("#pf-back")) throw new Error("Back link should be hidden on the Settings tab");
  for (const sel of ["#pf-avatar", "#av-edit-label", "#profile-account", "#pf-currency", "#btn-receipts", "#btn-signout2"])
    await page.waitForSelector(sel, { state: "attached" });
  const acct = await page.textContent("#profile-account");
  if (!acct.includes("Signed in as") || !acct.includes("demo")) throw new Error("account rows wrong: " + acct);
  // Avatar editor opens and closes.
  await page.click("#av-edit-label");
  await page.waitForSelector("#av-panel", { state: "visible" });
  if ((await page.textContent("#av-edit-label")) !== "Done") throw new Error("edit label should read Done");
  // One edit control (usability pass): no pencil on the picture.
  if (await page.$("#av-edit-btn")) throw new Error("second avatar edit control");
  await page.click("#av-edit-label");
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
  // No floating avatar on the tabs (usability pass): Settings is a tab.
  await page.evaluate(() => window.__aryaShow("home"));
  await page.waitForSelector("#view-home");
  if (await page.$("#avatar-btn")) throw new Error("floating avatar should be gone");
  // Sign out lands on the Login screen without a reload.
  await page.evaluate(() => window.__aryaShow("profile"));
  await page.waitForSelector("#btn-signout2");
  await page.click("#btn-signout2");
  await page.waitForSelector("#view-login");
  if (await page.$("#tabs")) throw new Error("tabs should be gone after sign out");
}
