/* End a quest you do not want to resume (owner 2026-10-29): End this
 * quest under Resume, End on every open row, and a quest with nothing
 * on it is never "your next action". */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  const ids = await page.evaluate(async () => {
    const mk = async (items) => {
      const r = await fetch("/api/quest/sessions", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store: "Trader Joe's", mode: "quest", items }) });
      return (await r.json()).id;
    };
    const full = await mk([{ name: "Milk", qty: 1 }]);
    const empty = await mk([]);
    return { full, empty };
  });
  await page.evaluate(() => window.__aryaShow("trips"));
  await page.waitForSelector("#today-hero .herocard");
  const hero = await page.getAttribute("#today-hero [data-hero]", "data-hero");
  if (hero === ids.empty) throw new Error("an empty quest must not be the next action");
  // Every open row can be ended, the newest included.
  for (const id of [ids.full, ids.empty])
    if (!(await page.$(`#quest-sessions [data-abandon="${id}"]`))) throw new Error("no End on " + id);
  page.once("dialog", d => d.accept());
  await page.click(`#today-hero [data-hero-end="${hero}"]`);
  await page.waitForFunction(h => !document.querySelector(`[data-sess="${h}"]`), hero);
}
