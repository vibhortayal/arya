/* Haul (haul.js + share.js): a settled trip goes Check your receipt ->
 * reveal -> haul card; a sticker hides; the post sheet and the share
 * card open; the Score's haul row and share buttons work. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  // A trip with two grabbed items and the sample receipt attached.
  const sess = await page.evaluate(async () => {
    const j = (u, b) => fetch(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then(r => r.json());
    const s = await j("/api/quest/sessions", { store: "Trader Joe's", mode: "quest", items: [{ name: "Milk", qty: 1 }, { name: "Bananas", qty: 1 }, { name: "Eggs", qty: 1 }] });
    await j(`/api/quest/sessions/${s.id}/state`, { state: "playing" });
    await j(`/api/quest/sessions/${s.id}/check`, { item: s.items[0].name, checked: true });
    await j(`/api/quest/sessions/${s.id}/check`, { item: s.items[1].name, checked: true });
    await j(`/api/quest/sessions/${s.id}/state`, { state: "finished" });
    return j(`/api/quest/sessions/${s.id}/sample-receipt`, {});
  });

  // Score -> Check your receipt (the haul row shows it once the view says the receipt was read).
  await page.evaluate(s => window.__aryaShow("score", { session: s }), sess);
  await page.waitForSelector('#view-score .hl-score [data-hl="card"]');
  for (const t of ["Make my haul card", "Replay the reveal", "See my album"])
    if (!(await page.textContent("#view-score .hl-btns")).includes(t)) throw new Error("haul row missing " + t);
  await page.waitForSelector('#view-score [data-hl="review"]:not([hidden])');
  await page.click('#view-score [data-hl="review"]');
  await page.waitForSelector("#view-rreview #rv-review h2");
  if ((await page.textContent("#rv-review h2")) !== "Check your receipt") throw new Error("review title");
  if (!(await page.textContent("#rv-review")).includes("Arya read")) throw new Error("review lines");
  // A fix chip toggles and offers Undo.
  const chip = await page.$("#rv-review .rv-fix");
  if (chip) {
    await chip.click();
    await page.waitForSelector('#toast:not([hidden]) .toastact');
    await page.waitForSelector('#rv-review .rv-fix[aria-pressed="true"]');
    await page.click("#toast .toastact");
    await page.waitForFunction(() => !document.querySelector('#rv-review .rv-fix[aria-pressed="true"]'));
  }
  await page.click("#view-rreview [data-act=looks-right]");

  // The reveal: tap anywhere lands on the final number.
  await page.waitForSelector("#view-reveal #rv-pts");
  await page.click("#view-reveal .rv-head");
  await page.waitForFunction(() => {
    const el = document.querySelector("#rv-pts");
    return el && el.textContent === el.dataset.target && Number(el.dataset.target) > 0;
  });
  if ((await page.$$("#rv-loot .rv-tile")).length < 1) throw new Error("no tiles");
  if ((await page.$$("#rv-loot .rv-tile.in")).length !== (await page.$$("#rv-loot .rv-tile")).length) throw new Error("tiles not shown");
  if (!(await page.textContent("#rv-pts-sr")).includes("points")) throw new Error("no announce");
  await page.click("#view-reveal [data-act=card]");

  // The haul card: hide a sticker, open the post sheet, open the share card.
  await page.waitForSelector("#view-haul .hl-card #hl-flat .hl-st");
  if ((await page.textContent("#hl-card-body .largetitle")) !== "Your haul card") throw new Error("card title");
  await page.click("#hl-flat .hl-st");
  await page.waitForSelector('#hl-flat .hl-st[aria-pressed="true"]');
  await page.click("#hl-flat .hl-st");
  await page.waitForFunction(() => !document.querySelector('#hl-flat .hl-st[aria-pressed="true"]'));
  await page.click('#view-haul [data-act="post"]');
  await page.waitForSelector('#hl-post-sheet [data-act="addfriend"], #hl-post-sheet [data-act="postgo"]');
  await page.click("#hl-post-x");
  await page.waitForFunction(() => !document.querySelector("#hl-post-sheet"));
  await page.click('#view-haul [data-act="save"]');
  await page.waitForSelector("#share-sheet #share-canvas:not([hidden])");
  if ((await page.textContent("#share-title")) !== "Share your haul") throw new Error("share title");
  if ((await page.textContent("#share-caption")) !== "My haul on Arya.") throw new Error("caption");
  await page.click('#share-size [data-size="post"]');
  await page.waitForFunction(() => document.querySelector("#share-canvas").height === 1350);
  await page.click("#share-close");
  await page.waitForFunction(() => !document.querySelector("#share-sheet"));
  await page.click('#view-haul [data-act="done"]');

  // The Score's share buttons.
  await page.waitForSelector("#view-score #share-haul");
  await page.click("#share-love");
  await page.waitForSelector("#share-sheet [data-pick]");
  if ((await page.textContent("#share-title")) !== "Loved something?") throw new Error("love title");
  await page.click("#share-sheet [data-pick]");
  await page.waitForSelector("#share-sheet #share-go:not([hidden])");
  if (!(await page.textContent("#share-caption")).includes("Found & loved at Trader Joe's")) throw new Error("love caption");
  if (!(await page.isHidden("#share-opts"))) throw new Error("opts on a love card");
  await page.click("#share-close");
  await page.click("#share-haul");
  await page.waitForSelector("#share-sheet #share-opts:not([hidden])");
  await page.click("#share-close");

  // Replay the reveal from the Score.
  await page.click('#view-score [data-hl="replay"]');
  await page.waitForSelector("#view-reveal #rv-loot");
  await page.click("#view-reveal [data-act=summary]");
  await page.waitForSelector("#view-score .scorehero");
}
