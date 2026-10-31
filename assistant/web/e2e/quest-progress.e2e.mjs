/* Quest progress: opened from the Quest tab's home (usability pass);
 * Back link, section headings, badge shelf and stores group render;
 * Back returns to Quest. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  // Settings no longer carries it; the Quest tab's home does.
  await page.click('#tabs button[data-view="view-profile"]');
  await page.waitForSelector("#btn-about");
  if (await page.$("#btn-quest-progress")) throw new Error("Quest progress should have left Settings");
  await page.click('#tabs button[data-view="view-community"]');
  await page.waitForSelector("#qm-progress", { timeout: 20000 });
  await page.click("#qm-progress");
  await page.waitForSelector("#view-quest-progress");
  for (const sel of ["#pfq-back", "#pf-stats", "#pf-spots", "#pf-badges", "#pf-stores"])
    await page.waitForSelector(sel, { state: "attached" });
  const txt = await page.textContent("#view-quest-progress");
  for (const t of ["Quest progress", "Badge shelf", "Mapped by you"])
    if (!txt.includes(t)) throw new Error("missing text: " + t);
  await page.waitForFunction(() => document.querySelectorAll("#pf-badges .badgetile").length > 0
    || document.querySelector("#pf-stores") !== null);
  await page.click("#pfq-back");
  await page.waitForSelector("#view-community #qm-progress");
  if (await page.$("#view-quest-progress")) throw new Error("quest-progress should be gone after Back");
}
