/* Adaptive Lists home (#156): 12 lists show the dense view with search,
 * Recent and A to Z; deleting down to 11 keeps it dense (hysteresis),
 * 10 goes back to tiles; the Cards | List switch overrides and sticks.
 * Today shows four tiles and "See all 12 lists".
 * Needs the API started with ARYA_REGISTRATION_OPEN=1: each run signs
 * up a fresh account and deletes it at the end. */
const NAMES = ["Trader Joe's", "Costco", "Safeway", "Whole Foods", "Target", "Patel Brothers", "H Mart",
  "Farmers market", "Walgreens", "Sprouts", "Aldi", "BBQ Sunday"];

export default async function (page, base) {
  const user = "ad" + Date.now().toString(36);
  const password = "adaptive-pass-1";
  await page.goto(base + "/");
  const r = await page.evaluate(b => fetch("/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then(x => x.status), { username: user, password });
  if (r !== 200) throw new Error("register: HTTP " + r + " (start the API with ARYA_REGISTRATION_OPEN=1)");
  try {
    const ids = await page.evaluate(async names => {
      const j = (url, body) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(x => x.json());
      // Skip the welcome and Get started: this test is about the lists.
      await j("/api/settings", { onboarded: true, get_started_dismissed: true });
      const out = [];
      for (let i = 0; i < names.length; i++) out.push((await j("/api/lists", { name: names[i], stores: i === 1 ? ["Costco Wholesale"] : [] })).id);
      const it = await j("/api/list/add", { name: "zzz adaptive eggs" });
      await j("/api/list/move", { item_id: it.item_id, list_id: out[3] });
      return out;
    }, NAMES);
    const lists = async () => {
      await page.reload();
      await page.waitForSelector("#tabs");
      await page.evaluate(() => window.__aryaShow("list"));
      await page.waitForSelector("#list-cards[data-mode], #list-cards .listcard");
      if (await page.$("#fr-welcome")) await page.keyboard.press("Escape");
    };
    const mode = () => page.getAttribute("#list-cards", "data-mode");
    const del = id => page.evaluate(id => fetch("/api/lists/delete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) }), id);

    // 12 lists: dense, with search, Recent and A to Z.
    await lists();
    if ((await mode()) !== "dense") throw new Error("12 lists: mode " + (await mode()));
    const ph = await page.getAttribute("#list-search", "placeholder");
    if (ph !== "Search 12 lists") throw new Error("placeholder: " + ph);
    const heads = await page.$$eval("#list-cards .sect", hs => hs.map(h => h.textContent));
    if (heads.join("|") !== "Recent|All lists, A to Z") throw new Error("sections: " + heads.join("|"));
    if ((await page.$$("#list-cards .group:first-of-type .navrow")).length !== 5) throw new Error("Recent is not 5 rows");
    const az = await page.$$eval("#list-cards .group:last-of-type .navrow .name", ns => ns.map(n => n.textContent));
    if (az[0] !== "Aldi" || az.length !== 12) throw new Error("A to Z: " + az.join(", "));
    const wf = await page.textContent('#list-cards .group:last-of-type [data-open-list="' + ids[3] + '"] .lv-count');
    if (wf !== "1") throw new Error("open count: " + wf);
    if (await page.$("#list-view-list[aria-pressed=true]") === null) throw new Error("switch does not show List");

    // Search: name or store, any case; one group while searching.
    await page.fill("#list-search", "WHOLESALE");
    await page.waitForFunction(() => document.querySelectorAll("#list-cards .group").length === 1);
    const hit = await page.$$eval("#list-cards .navrow .name", ns => ns.map(n => n.textContent));
    if (hit.join() !== "Costco") throw new Error("store search: " + hit.join());
    await page.fill("#list-search", "Ma"); // H Mart, Farmers market
    await page.waitForFunction(() => document.querySelectorAll("#list-cards .navrow").length === 2);
    if ((await page.$$("#list-cards .sect")).length) throw new Error("section titles while searching");
    await page.fill("#list-search", "");
    await page.waitForFunction(() => document.querySelectorAll("#list-cards .group").length === 2);

    // Opening a list puts it first in Recent.
    await page.click('#list-cards .group:last-of-type [data-open-list="' + ids[10] + '"]');
    await page.waitForSelector("#list-page");
    await page.click("#list-back");
    await page.waitForSelector("#list-cards[data-mode=dense]");
    const first = await page.textContent("#list-cards .group:first-of-type .navrow .name");
    if (first !== "Aldi") throw new Error("Recent first: " + first);

    // Down to 11: still dense. Down to 10: tiles.
    await del(ids[11]);
    await lists();
    if ((await mode()) !== "dense") throw new Error("11 lists after 12: mode " + (await mode()));
    await del(ids[10]);
    await lists();
    if ((await mode()) !== "tiles") throw new Error("10 lists: mode " + (await mode()));
    if (await page.$("#list-search")) throw new Error("search shows in tiles");
    if ((await page.$$("#list-cards .listcard")).length !== 10) throw new Error("tiles: not 10");
    const cnt = await page.textContent('#list-cards [data-open-list="' + ids[3] + '"] .lc-count');
    if (cnt !== "1 item") throw new Error("tile count: " + cnt);

    // The switch: List overrides tiles and sticks across a reload.
    await page.click("#list-view-list");
    await page.waitForSelector("#list-cards[data-mode=dense]");
    await lists();
    if ((await mode()) !== "dense") throw new Error("List choice did not stick");
    await page.click("#list-view-cards");
    await page.waitForSelector("#list-cards[data-mode=tiles]");

    // Today: four tiles, See all 10 lists, no second link.
    await page.evaluate(() => window.__aryaShow("home"));
    await page.waitForSelector("#today-seeall");
    if ((await page.$$("#today-lists .listcard")).length !== 4) throw new Error("Today tiles: not 4");
    const see = await page.textContent("#today-seeall");
    if (!see.includes("See all 10 lists")) throw new Error("See all: " + see);
    if (await page.isVisible("#today-listline")) throw new Error("Open Lists link still shows");
    await page.click("#today-seeall");
    await page.waitForSelector("#list-cards[data-mode=tiles]");
  } finally {
    await page.evaluate(pw => fetch("/auth/account/delete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: pw }) }), password).catch(() => {});
  }
}
