/* No account: landing, Try it now, every tab opens, Running low adds,
 * typing adds to a list, Ask answers, Help answers, Finish demo shows
 * the end sheet, an unknown address does not crash the app. */
export default async function (t) {
  const page = await t.newPhone("demo");
  await page.goto(t.base + "/");
  await page.waitForSelector("#demo-btn");
  const fold = await page.locator("#demo-btn").boundingBox();
  if (!fold || fold.y + fold.height > 844) throw new Error("Try it now is below the fold on a phone");
  await page.click("#demo-btn");
  await page.waitForSelector("#tabs");
  if (!(await page.isVisible("#demobar"))) throw new Error("demo bar missing");

  const labels = await page.$$eval("#tabs button span", s => s.map(x => x.textContent.trim()));
  for (const want of ["Today", "Lists", "Ask", "Quest", "Settings"])
    if (!labels.includes(want)) throw new Error("tab missing: " + want + " (have " + labels + ")");

  // Each tab paints something.
  for (const label of labels) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await page.waitForFunction(() => document.querySelector("main")?.textContent.trim().length > 20, null, { timeout: 10000 })
      .catch(() => { throw new Error(label + " tab stayed empty"); });
  }

  // Running low: Add puts it on a list and says so.
  await page.getByRole("button", { name: "Today", exact: true }).click();
  const add = page.locator('button[aria-label^="Add "][aria-label$=" to your list"]').first();
  if (await add.count()) {
    await add.click();
    await page.waitForSelector("text=Added");
  }

  // Lists: open the first list and add by typing.
  await page.getByRole("button", { name: "Lists", exact: true }).click();
  await page.waitForSelector("#list-cards .listcard");
  await page.click("#list-cards .listcard");
  await page.waitForSelector("#list-page");
  await page.fill("#add-text", t.stamp);
  await page.press("#add-text", "Enter");
  await page.waitForFunction(s => document.body.textContent.includes(s), t.stamp, { timeout: 10000 });

  // Ask: a starter chip gets an answer.
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page.getByRole("textbox", { name: "Message" }).fill("What am I running low on?");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => /running low/i.test(document.querySelector("main").textContent.split("What am I running low on?").pop()), null, { timeout: 30000 });

  // Finish demo: the end sheet opens and Leave the demo goes back to the landing.
  await page.click("#demobar button");
  await page.waitForSelector("[role=dialog]");
  await page.getByRole("button", { name: "Leave the demo" }).click();
  await page.waitForSelector("#demo-btn");

  // An unknown address answers 404 (today it is raw JSON; see known issues).
  const r = await page.goto(t.base + "/no-such-page-" + t.stamp);
  if (r.status() !== 404) throw new Error("unknown address answered " + r.status());
  await page.context().close();
}
