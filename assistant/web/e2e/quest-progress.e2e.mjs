/* Quest progress: Back link, section headings, badge shelf and stores group render; Back returns to Profile. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  // Reached from Profile, so Back returns there.
  await page.evaluate(() => window.__aryaShow("profile", { from: "home" }));
  await page.waitForSelector("#view-profile");
  await page.evaluate(() => window.__aryaShow("quest-progress"));
  await page.waitForSelector("#view-quest-progress");
  for (const sel of ["#pfq-back", "#pf-stats", "#pf-spots", "#pf-badges", "#pf-stores"])
    await page.waitForSelector(sel, { state: "attached" });
  const txt = await page.textContent("#view-quest-progress");
  for (const t of ["Quest progress", "Badge shelf", "Mapped by you"])
    if (!txt.includes(t)) throw new Error("missing text: " + t);
  await page.waitForFunction(() => document.querySelectorAll("#pf-badges .badgetile").length > 0
    || document.querySelector("#pf-stores") !== null);
  await page.click("#pfq-back");
  await page.waitForSelector("#view-profile");
  if (await page.$("#view-quest-progress")) throw new Error("quest-progress should be gone after Back");
}
