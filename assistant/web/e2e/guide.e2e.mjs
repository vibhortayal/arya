/* Arya guide (#154, owner's sections and no-links pass 2026-10-30):
 * opens from Settings on Lists; every card has numbered steps and
 * nothing links out (no Try it, no Practice Market, no Start my
 * group); Replay the tour is the last card's closing action; swipe
 * and keys move, Esc closes. Powers' "See how it works" opens the
 * guide at card 1, and a power's (i) sheet opens its own card. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  const lists = () => page.evaluate(() => fetch("/api/home").then(r => r.json()).then(h => JSON.stringify({ lists: h.lists, items: (h.list?.items || []).filter(i => i.on_list).map(i => i.item_id).sort() })));
  const before = await lists();
  const sent = [];
  page.on("request", r => { if (/\/api\//.test(r.url()) && r.method() !== "GET") sent.push(r.method() + " " + r.url()); });

  // Settings > Arya guide, above Arya's powers.
  await page.click('#tabs button[data-view="view-profile"]');
  await page.waitForSelector("#btn-guide");
  const order = await page.$$eval("#view-profile .navrow", rs => rs.map(r => r.id));
  if (order.indexOf("btn-guide") !== order.indexOf("btn-powers") - 1) throw new Error("Arya guide is not just above Arya's powers: " + order.join(","));
  // One help row (usability pass): no separate tour row, no Quest progress.
  for (const gone of ["btn-tour", "btn-quest-progress"]) if (order.includes(gone)) throw new Error(gone + " should be gone from Settings");
  if (!(await page.textContent("#btn-guide")).startsWith("Help and guide")) throw new Error("help row label");
  await page.click("#btn-guide");
  await page.waitForSelector('.gd[data-card="lists"]');
  if ((await page.textContent("#gd-count")) !== "Arya guide · 1 of 8") throw new Error("count: " + (await page.textContent("#gd-count")));
  if (await page.$("#gd-back")) throw new Error("Back on card 1");
  if (await page.$("#gd-tour")) throw new Error("Replay the tour on card 1");
  if (await page.$("#gd-try, .gd .try")) throw new Error("a Try it is still on card 1");
  if ((await page.$$(".gd ol.steps li")).length !== 3) throw new Error("card 1 steps");

  // Swipe left to card 2.
  const box = await page.$eval(".gd", el => { const r = el.getBoundingClientRect(); return { x: r.width / 2, y: r.height / 2 }; });
  await page.evaluate(({ x, y }) => {
    const el = document.querySelector(".gd");
    const touch = cx => new Touch({ identifier: 1, target: el, clientX: cx, clientY: y });
    el.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: [touch(x + 120)], changedTouches: [touch(x + 120)] }));
    el.dispatchEvent(new TouchEvent("touchend", { bubbles: true, touches: [], changedTouches: [touch(x - 120)] }));
  }, box);
  await page.waitForSelector('.gd[data-card="share"]');
  if ((await page.textContent("#gd-count")) !== "Arya guide · 2 of 8") throw new Error("swipe did not reach card 2");

  // Card 2 has its steps and no way out of the guide.
  if ((await page.$$(".gd ol.steps li")).length !== 3) throw new Error("household steps");
  if (await page.$("#gd-try, #gd-start-group, .gd-card a, .gd-card ol.steps button")) throw new Error("a link out on the household card");

  // Keys: right and left move, Esc closes.
  await page.keyboard.press("ArrowRight");
  await page.waitForSelector('.gd[data-card="maps"]');
  await page.keyboard.press("ArrowLeft");
  await page.waitForSelector('.gd[data-card="share"]');
  await page.click("#gd-close");
  await page.waitForSelector(".gd", { state: "detached" });

  // Nothing was sent, and the real lists are unchanged.
  if (sent.length) throw new Error("the guide sent requests: " + sent.join("; "));
  if ((await lists()) !== before) throw new Error("real lists changed");

  // Powers: See how it works opens the guide; a power's (i) opens its card.
  await page.click("#btn-powers");
  await page.waitForSelector("#pw-guide");
  await page.click("#pw-guide");
  await page.waitForSelector('.gd[data-card="lists"]');
  await page.keyboard.press("Escape");
  await page.waitForSelector(".gd", { state: "detached" });
  await page.click("#powers-body .pwgroup summary");
  await page.click('#powers-body .infobtn[data-info="compare"]');
  await page.click('#info-sheet [data-pw="guide"]');
  await page.waitForSelector('.gd[data-card="prices"]');
  if ((await page.textContent("#gd-count")) !== "Arya guide · 6 of 8") throw new Error("power link count");
  await page.click("#gd-close");
  await page.waitForSelector(".gd", { state: "detached" });
  await page.waitForSelector("#view-powers");

  // Every card keeps you on it: walk all eight, no link out, then Replay on the last.
  await page.evaluate(() => window.__aryaShow("profile"));
  await page.click("#btn-guide");
  for (let k = 0; k < 7; k++) {
    if (await page.$("#gd-try, .gd .try, .gd-card a, .gd-card ol.steps button")) throw new Error("link out on card " + (k + 1));
    if (!(await page.$(".gd ol.steps li"))) throw new Error("no steps on card " + (k + 1));
    await page.keyboard.press("ArrowRight");
  }
  await page.waitForSelector('.gd[data-card="ask"]');
  if ((await page.textContent("#gd-count")) !== "Arya guide · 8 of 8") throw new Error("last count");
  if ((await page.textContent("#gd-tour")) !== "Replay the tour") throw new Error("Replay the tour is not on the last card");
  if (sent.length) throw new Error("the guide sent requests: " + sent.join("; "));
}
