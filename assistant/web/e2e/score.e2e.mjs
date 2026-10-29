/* Score: a skipped receipt shows No receipt yet; Add the receipt settles it; the Race link stays hidden. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  const sess = await page.evaluate(async () => {
    const r = await fetch("/api/quest/sessions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ store: "Trader Joe's", mode: "quest", items: [{ name: "Milk", qty: 1 }] }),
    });
    const s = await r.json();
    // The sample receipt lists collected items only, so grab one first.
    const it = s.items[0].name;
    await fetch(`/api/quest/sessions/${s.id}/state`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: "playing" }) });
    await fetch(`/api/quest/sessions/${s.id}/check`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item: it, checked: true }) });
    return (await fetch(`/api/quest/sessions/${s.id}/state`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: "finished" }),
    })).json();
  });
  await page.evaluate(s => window.__aryaShow("score", { session: s }), sess);
  await page.waitForSelector("#view-score #score-addreceipt");
  const k = await page.textContent(".hero-k");
  if (!k.includes("No receipt yet")) throw new Error("hero: " + k);
  if (!(await page.textContent(".haul-wait")).includes("+50")) throw new Error("haul-wait missing");
  await page.click("#score-addreceipt");
  await page.waitForSelector("#ar-sheet #ar-sample");
  await page.click("#ar-sample");
  // Add the receipt goes on through haul.js afterFinish: check, reveal, Trip summary.
  await page.waitForSelector("#view-rreview [data-act=looks-right], #view-reveal [data-act=summary]");
  if (await page.$("#view-rreview")) await page.click("#view-rreview [data-act=looks-right]");
  await page.click("#view-reveal [data-act=summary]");
  await page.waitForFunction(() => /Receipt added/.test(document.querySelector("#view-score .hero-k")?.textContent || ""));
  const k2 = await page.textContent(".hero-k");
  if (!k2.includes("Receipt added")) throw new Error("hero after: " + k2);
  await page.waitForSelector("#score-body .badgepop, #score-body h3.sect");
  // Race is hidden until cross-account races work (labels audit).
  if (await page.$("#score-challenge")) throw new Error("Race challenge shows");
}
