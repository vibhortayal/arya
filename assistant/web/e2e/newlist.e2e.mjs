/* Quest plan: add an item, edit it, tick it, start. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  await page.evaluate(() => window.__aryaShow("newlist", { store: "Trader Joe's" }));
  await page.waitForSelector("#view-newlist");
  const title = await page.textContent("#nl-title");
  if (title !== "Your quest at Trader Joe's") throw new Error("title: " + title);
  // The plan loads and the bag opens.
  await page.waitForFunction(() => /Add an item to start|Start the quest ·/.test(document.querySelector("#nl-next")?.textContent || ""));
  for (const id of ["#nl-text", "#nl-mic", "#nl-add", "#nl-plan", "#nl-next"]) {
    if (!(await page.$(id))) throw new Error("missing " + id);
  }

  // Typed items become bag rows at once.
  await page.fill("#nl-text", "2x zzz oat milk");
  await page.click("#nl-add");
  await page.waitForSelector('#nl-plan [data-plan="zzz oat milk"]');
  if ((await page.getAttribute('#nl-plan [data-plan="zzz oat milk"]', "aria-pressed")) !== "true") throw new Error("new row is not ticked");
  if (!(await page.textContent(`#nl-plan [data-plan="zzz oat milk"] .packx`))?.includes("x2")) throw new Error("quantity chip missing");
  if (!/Start the quest · \d+ items? →/.test(await page.textContent("#nl-next"))) throw new Error("start label: " + (await page.textContent("#nl-next")));
  if ((await page.inputValue("#nl-text")) !== "") throw new Error("text box not cleared");

  // Edit sheet: more, note, done.
  await page.click('[data-packedit="zzz oat milk"]');
  await page.waitForSelector("#pack-sheet");
  await page.click('[data-edit="qty+"]');
  if ((await page.textContent("#pack-edit-qty")) !== "3") throw new Error("qty did not go up");
  await page.fill("#pack-edit-note", "unsweetened");
  await page.click('[data-edit="done"]');
  await page.waitForFunction(() => !document.querySelector("#pack-sheet"));
  const row = await page.textContent('#nl-plan [data-plan="zzz oat milk"]');
  if (!row.includes("x3") || !row.includes("unsweetened")) throw new Error("edit not shown: " + row);

  // Untick and tick.
  await page.click('#nl-plan [data-plan="zzz oat milk"]');
  if ((await page.getAttribute('#nl-plan [data-plan="zzz oat milk"]', "aria-pressed")) !== "false") throw new Error("untick failed");
  await page.click('#nl-plan [data-plan="zzz oat milk"]');
  if ((await page.getAttribute('#nl-plan [data-plan="zzz oat milk"]', "aria-pressed")) !== "true") throw new Error("tick failed");

  // Start runs the optimizer and leaves for the next step.
  await page.click("#nl-next");
  await page.waitForSelector("#view-mode, #view-optimize");
}
