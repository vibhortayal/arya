/* Finish: the receipt step closes the hunt and goes on to the receipt check / reveal, then its Score. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  const sess = await page.evaluate(async () => {
    const r = await fetch("/api/quest/sessions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ store: "Trader Joe's", mode: "quest", items: [{ name: "Milk", qty: 1 }, { name: "Eggs", qty: 1 }] }),
    });
    const s = await r.json();
    // The sample receipt lists collected items only, so grab one first.
    const it = s.items[0].name;
    await fetch(`/api/quest/sessions/${s.id}/state`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: "playing" }) });
    await fetch(`/api/quest/sessions/${s.id}/check`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item: it, checked: true }) });
    return (await fetch(`/api/quest/sessions/${s.id}`)).json();
  });
  await page.evaluate(s => window.__aryaShow("finish", { session: s }), sess);
  await page.waitForSelector("#view-finish #fin-sample");
  const sub = await page.textContent("#fin-sub");
  if (!sub.includes("Trader Joe's")) throw new Error("fin-sub: " + sub);
  if (!(await page.isVisible("#fin-skip"))) throw new Error("skip missing");
  if (await page.isVisible("#view-finish .real-only")) throw new Error("e-receipt door open in demo");
  await page.click("#fin-sample");
  // haul.js afterFinish: a receipt Arya read goes to Check your receipt,
  // then the reveal; its Trip summary is the Score.
  await page.waitForSelector("#view-rreview [data-act=looks-right], #view-reveal [data-act=summary]");
  if (await page.$("#view-rreview")) await page.click("#view-rreview [data-act=looks-right]");
  await page.waitForSelector("#view-reveal [data-act=summary]");
  await page.click("#view-reveal [data-act=summary]");
  await page.waitForSelector("#view-score #score-body .scorehero");
  const hero = await page.textContent(".hero-k");
  if (!hero.includes("Receipt added")) throw new Error("hero: " + hero);
  await page.waitForSelector("#haul-photo", { state: "attached" });
  // Race is hidden until cross-account races work (labels audit).
  if (await page.$("#score-challenge")) throw new Error("Race challenge shows");
  const hunt = await page.textContent("#score-body");
  if (!hunt.includes("Items found")) throw new Error("rows missing");
  await page.waitForFunction(() => Number(document.querySelector("#haul-n").textContent) > 0);
}
