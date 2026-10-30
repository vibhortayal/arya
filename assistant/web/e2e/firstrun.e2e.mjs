/* First run (#153, #163): a new account sees the welcome, walks the
 * five-step tour to Done, and never sees the welcome again; Lists
 * shows only the first-list card and Today shows Get started.
 * Needs the API started with ARYA_REGISTRATION_OPEN=1: each run signs
 * up a fresh account and deletes it at the end. */
export default async function (page, base) {
  const user = "fr" + Date.now().toString(36);
  const password = "first-run-pass-1";
  await page.goto(base + "/");
  const r = await page.evaluate(b => fetch("/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then(x => x.status), { username: user, password });
  if (r !== 200) throw new Error("register: HTTP " + r + " (start the API with ARYA_REGISTRATION_OPEN=1)");
  try {
    await page.reload();
    await page.waitForSelector("#tabs");

    // Welcome sheet, with Get started behind it.
    await page.waitForSelector("#fr-welcome");
    const title = await page.textContent("#fr-welcome-title");
    if (title !== "Hi, I'm Arya") throw new Error("welcome title: " + title);
    if ((await page.$$("#fr-welcome .fr-three > div")).length !== 3) throw new Error("welcome tiles");
    await page.waitForSelector("#today-getstarted");
    await page.click("#fr-tour-start");
    await page.waitForFunction(() => !document.querySelector("#fr-welcome"));

    // Five steps, each around its tab, focus on Next, Done at the end.
    const want = ["today", "lists", "ask", "quest", "settings"];
    for (let k = 0; k < want.length; k++) {
      await page.waitForSelector(`.fr-tour[data-tour-step="${want[k]}"] .fr-hole`);
      if ((await page.evaluate(() => document.activeElement?.id)) !== "fr-tour-next") throw new Error("focus not on Next at " + want[k]);
      const on = await page.$$eval(".fr-pips i", is => is.findIndex(i => i.classList.contains("on")));
      if (on !== k) throw new Error("pip " + on + " at step " + k);
      const label = await page.textContent("#fr-tour-next");
      if (label !== (k === want.length - 1 ? "Done" : "Next")) throw new Error("button at step " + k + ": " + label);
      // Only the last step offers the Arya guide (#154); Done does not open it.
      if (!!(await page.$("#fr-tour-more")) !== (k === want.length - 1)) throw new Error("guide link at step " + k);
      await page.click("#fr-tour-next");
    }
    await page.waitForFunction(() => !document.querySelector(".fr-tour"));
    if (await page.$(".gd")) throw new Error("Done opened the guide");

    // Reload: no welcome; Get started on Today with nothing done.
    await page.reload();
    await page.waitForSelector("#today-getstarted");
    await page.waitForTimeout(400);
    if (await page.$("#fr-welcome")) throw new Error("welcome came back after reload");
    const kick = await page.textContent("#today-getstarted .fr-k");
    if (!/Get started · 0 of 4/i.test(kick)) throw new Error("kicker: " + kick);
    for (const id of ["#today-quest", "#today-tip .tipline", "#today-expiry .sectrow"]) {
      if (await page.$(id)) throw new Error("should be hidden on a new Today: " + id);
    }

    // Lists: only the first-list card.
    await page.click('#tabs button[data-view="view-list"]');
    await page.waitForSelector("#list-empty");
    if (await page.$("#list-new")) throw new Error("New list button should be hidden");
    if (await page.$('[data-open-list="else"]')) throw new Error("Everything else should be hidden");

    // The Esc key closes a tour replayed from Settings > Help and guide.
    await page.click('#tabs button[data-view="view-profile"]');
    if (await page.$("#btn-tour")) throw new Error("tour replay should live inside the guide");
    await page.click("#btn-guide");
    for (let k = 0; k < 7; k++) await page.keyboard.press("ArrowRight");
    await page.click("#gd-tour");
    await page.waitForSelector(".gd", { state: "detached" });
    await page.waitForSelector('.fr-tour[data-tour-step="today"]');
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector(".fr-tour"));

    // Step 1 opens the new-list flow; a list ticks it on Today.
    await page.click('#tabs button[data-view="view-home"]');
    await page.click('[data-gs="list"]');
    await page.waitForSelector("#list-sheet #ls-name");
    await page.fill("#ls-name", "Trader Joe's");
    await page.click('[data-ls="create"]');
    await page.waitForFunction(() => !document.querySelector("#list-sheet"));
    await page.click('#tabs button[data-view="view-home"]');
    // A list named for a store may tick step 2 (Pick your store) too.
    await page.waitForFunction(() => /[12] of 4/.test(document.querySelector("#today-getstarted .fr-k")?.textContent || ""));
    if (!(await page.$('#today-getstarted li.done [data-gs="list"]'))) throw new Error("step 1 not ticked");
    // Exactly one step is lit as next.
    if ((await page.$$("#today-getstarted li.next")).length !== 1) throw new Error("one next step expected");

    // The x closes the card for good.
    await page.click("#gs-dismiss");
    await page.reload();
    // The new list is empty: it folds into one row, and the Quest nudge
    // waits until a list has something to shop for.
    await page.waitForSelector("#today-emptylists");
    if (await page.$("#today-quest")) throw new Error("Quest nudge with nothing to shop for");
    if (await page.$("#today-getstarted")) throw new Error("Get started came back after closing");
  } finally {
    await page.evaluate(pw => fetch("/auth/account/delete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: pw }) }), password).catch(() => {});
  }
}
