/* The hunt: how-to sheet, full-screen chrome, start, grab, put back,
 * the row menu, Forgot something, a wild find, Ask Arya, Find it for me
 * (the scan opens and closes), the leave sheet on Done, and Back. */
export default async function (page, base) {
  await page.goto(base + "/next/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  await page.evaluate(async () => {
    try { localStorage.removeItem("arya-howto-seen"); localStorage.removeItem("arya-outbox"); } catch (e) { /* fresh */ }
    const r = await fetch("/api/quest/sessions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ store: "Trader Joe's", mode: "quest", driver: "photo",
        items: [{ name: "Milk", qty: 1 }, { name: "Bread", qty: 2 }, { name: "Bananas", qty: 1 }] }),
    });
    if (!r.ok) throw new Error("create session " + r.status);
    window.__aryaShow("hunt", { session: await r.json() });
  });
  const text = sel => page.$eval(sel, e => e.textContent.trim());
  const waitText = (sel, re) => page.waitForFunction(([s, r]) => {
    const e = document.querySelector(s); return !!e && new RegExp(r).test(e.textContent || "");
  }, [sel, re.source], { timeout: 8000 });
  const rows = () => page.$$eval("#hunt-list .huntrow", r => r.length);

  // First Quest hunt on this device: How to play opens once.
  await page.waitForSelector("#howto-sheet");
  await page.click("#howto-go");
  await page.waitForSelector("#howto-sheet", { state: "detached" });
  if (await page.$("#tabs")) throw new Error("tab bar should hide during a hunt");
  if (!(await page.$eval("body", b => b.classList.contains("hunting")))) throw new Error("body.hunting missing");

  if ((await rows()) !== 3) throw new Error("expected 3 rows, got " + (await rows()));
  if (!/Trader Joe's · Quest/.test(await text("#hunt-store"))) throw new Error("store chip: " + (await text("#hunt-store")));
  if ((await text("#btn-collect")) !== "Start the hunt") throw new Error("collect: " + (await text("#btn-collect")));
  if (!(await page.$eval("#btn-finish", b => b.disabled))) throw new Error("Done should wait for the start");

  // Start, then grab the suggested stop.
  await page.click("#btn-collect");
  await waitText("#btn-collect", /^Grab/);
  await page.click("#btn-collect");
  await waitText("#hunt-count", /^1 of 3$/);
  await waitText("#hunt-pts", /^10 pts$/);
  await page.waitForSelector("#hunt-list .huntrow.got");

  // The New sticker card (#stk-card) shows when /check returns a first-time
  // sticker for the grab; then the "in your cart" toast stays away. If the
  // demo session yields no new sticker the card stays hidden and the toast
  // shows instead, so both outcomes are checked.
  {
    const card = await page.$eval("#stk-card", e => ({ hidden: e.hidden, text: e.textContent || "" }));
    const toastText = await page.$eval("#toast", e => (e.hidden ? "" : e.textContent || ""));
    if (!card.hidden) {
      if (!/New sticker/.test(card.text) || !/Undo/.test(card.text)) throw new Error("stk-card text: " + card.text);
      if (/in your cart/.test(toastText)) throw new Error("toast should not show while the sticker card is open");
    } else {
      console.log("hunt e2e: demo grab gave no new sticker; #stk-card stayed hidden");
      if (!/in your cart/.test(toastText)) throw new Error("expected the in-your-cart toast, got: " + toastText);
    }
  }

  // Put it back from its row.
  await page.click("#hunt-list .huntcheck.got");
  await waitText("#hunt-count", /^0 of 3$/);

  // Row menu, then "It moved" in place.
  await page.click("#hunt-list [data-more]");
  await page.waitForSelector("#hunt-sheet .hm-opt[data-act='moved']");
  await page.click("#hunt-sheet .hm-opt[data-act='moved']");
  await waitText("#hm-title", /^Can't find/);
  await page.keyboard.press("Escape");
  await page.waitForSelector("#hunt-sheet", { state: "detached" });

  // Not here? opens the same "Can't find it?" sheet; Tell opens the report sheet.
  await page.click("#btn-nothere");
  await page.waitForSelector("#hunt-sheet [data-act='tell']");
  await page.click("#hunt-sheet [data-act='tell']");
  await page.waitForSelector("#spot-sheet [data-kind='cant_tell']");
  await page.keyboard.press("Escape");
  await page.waitForSelector("#spot-sheet", { state: "detached" });

  // Forgot something adds a row.
  await page.fill("#hm-add-input", "2x tortillas");
  await page.click("#hm-add-btn");
  await page.waitForFunction(() => document.querySelectorAll("#hunt-list .huntrow").length === 4, null, { timeout: 8000 });

  // A wild find lands in the haul, collected.
  await page.click("#btn-wild");
  await page.fill("#wild-name", "oat milk chocolate");
  await page.click("#wild-add");
  await page.waitForFunction(() => document.querySelectorAll("#hunt-list .huntrow").length === 5, null, { timeout: 8000 });
  if (!(await page.isHidden("#wild-form"))) throw new Error("wild form should close");

  // Ask Arya opens its sheet.
  await page.click("#hunt-askbar");
  await page.waitForSelector("#ask-sheet #ask-text");
  await page.keyboard.press("Escape");
  await page.waitForSelector("#ask-sheet", { state: "detached" });

  // Find it for me opens the scan; the close button takes it down.
  await page.click("#btn-findit");
  await page.waitForSelector("#scan-overlay:not([hidden])");
  await page.click("#scan-close");
  await page.waitForSelector("#scan-overlay[hidden]", { state: "attached" });

  // Done with items still open asks first.
  await page.click("#btn-finish");
  await page.waitForSelector("#hunt-sheet [data-act='checkout']");
  await page.click("#hunt-sheet [data-act='keep']");
  await page.waitForSelector("#hunt-sheet", { state: "detached" });

  // Pause and resume.
  await page.click("#btn-pause");
  await page.waitForSelector("#btn-pause[aria-label='Resume']");
  await page.click("#btn-pause");
  await page.waitForSelector("#btn-pause[aria-label='Pause']");

  // Back leaves the hunt and the chrome returns.
  await page.click(".hudback");
  await page.waitForSelector("#tabs");
  if (await page.$eval("body", b => b.classList.contains("hunting"))) throw new Error("body.hunting left behind");
}
