/* Arya guide (#154): opens from Settings, swipes to card 2, Try it
 * adds an item to the sample list, closes; the real lists are the
 * same as before (Try it saves nothing). Keys move and Esc closes on
 * a desktop keyboard. Powers' "See how it works" opens the guide at
 * card 1, and a power's (i) sheet opens its own card. */
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
  await page.waitForSelector('.gd[data-card="what"]');
  if ((await page.textContent("#gd-count")) !== "Arya guide · 1 of 8") throw new Error("count: " + (await page.textContent("#gd-count")));
  if (await page.$("#gd-back")) throw new Error("Back on card 1");
  if ((await page.textContent("#gd-tour")) !== "Replay the tour") throw new Error("Replay the tour on card 1");

  // Swipe left to card 2.
  const box = await page.$eval(".gd", el => { const r = el.getBoundingClientRect(); return { x: r.width / 2, y: r.height / 2 }; });
  await page.evaluate(({ x, y }) => {
    const el = document.querySelector(".gd");
    const touch = cx => new Touch({ identifier: 1, target: el, clientX: cx, clientY: y });
    el.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: [touch(x + 120)], changedTouches: [touch(x + 120)] }));
    el.dispatchEvent(new TouchEvent("touchend", { bubbles: true, touches: [], changedTouches: [touch(x - 120)] }));
  }, box);
  await page.waitForSelector('.gd[data-card="lists"]');
  if ((await page.textContent("#gd-count")) !== "Arya guide · 2 of 8") throw new Error("swipe did not reach card 2");

  // Try it: a sample Trader Joe's list; add two items.
  await page.click("#gd-try");
  await page.waitForSelector("#gd-try-sheet .samp");
  const sheetText = await page.textContent("#gd-try-sheet");
  for (const want of ["Trader Joe's", "Sample", "Try it here. Nothing is saved."]) if (!sheetText.includes(want)) throw new Error("try sheet missing: " + want);
  await page.fill("#gd-list-input", "oat milk, bananas");
  await page.click("#gd-list-add");
  await page.waitForSelector("#gd-list-items .samp.new");
  const names = await page.$$eval("#gd-list-items .row .name", ns => ns.map(n => n.textContent));
  if (names.slice(0, 2).join() !== "Oat milk,Bananas") throw new Error("added items not on top: " + names.join());
  const aisle = await page.textContent("#gd-list-items .row .sub");
  if (aisle !== "Dairy · aisle 4") throw new Error("aisle: " + aisle);
  await page.click("#gd-try-sheet .sheethead .linkbtn");
  await page.waitForSelector("#gd-try-sheet", { state: "detached" });

  // Keys: right and left move, Esc closes.
  await page.keyboard.press("ArrowRight");
  await page.waitForSelector('.gd[data-card="usesoon"]');
  await page.keyboard.press("ArrowLeft");
  await page.waitForSelector('.gd[data-card="lists"]');
  await page.click("#gd-close");
  await page.waitForSelector(".gd", { state: "detached" });

  // Nothing was sent, and the real lists are unchanged.
  if (sent.length) throw new Error("Try it sent requests: " + sent.join("; "));
  if ((await lists()) !== before) throw new Error("real lists changed");

  // Powers: See how it works opens the guide; a power's (i) opens its card.
  await page.click("#btn-powers");
  await page.waitForSelector("#pw-guide");
  await page.click("#pw-guide");
  await page.waitForSelector('.gd[data-card="what"]');
  await page.keyboard.press("Escape");
  await page.waitForSelector(".gd", { state: "detached" });
  await page.click("#powers-body .pwgroup summary");
  await page.click('#powers-body .infobtn[data-info="compare"]');
  await page.click('#info-sheet [data-pw="guide"]');
  await page.waitForSelector('.gd[data-card="prices"]');
  if ((await page.textContent("#gd-count")) !== "Arya guide · 5 of 8") throw new Error("power link count");
  await page.click("#gd-close");
  await page.waitForSelector(".gd", { state: "detached" });
  await page.waitForSelector("#view-powers");

  // Make my real list: the guide closes and the real new-list sheet opens.
  await page.evaluate(() => window.__aryaShow("profile"));
  await page.click("#btn-guide");
  await page.click("#gd-next");
  await page.click("#gd-try");
  await page.click("#gd-real-list");
  await page.waitForSelector("#list-sheet #ls-name");
  if (await page.$(".gd")) throw new Error("guide still open over the real list");
  await page.keyboard.press("Escape");
  await page.waitForSelector("#list-sheet", { state: "detached" });

  // Quest's Try it opens the game's Practice Market.
  await page.evaluate(() => window.__aryaShow("profile"));
  await page.click("#btn-guide");
  for (let k = 0; k < 6; k++) await page.keyboard.press("ArrowRight");
  await page.waitForSelector('.gd[data-card="quest"]');
  await page.click("#gd-try");
  await page.waitForSelector('.qg[data-screen="play"]', { timeout: 20000 });
}
