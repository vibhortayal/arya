/* Language: the Settings row saves, and Ask offers the user's language
 * once on Auto. /api/chat is stubbed with a Spanish reply, so the test
 * needs no model key; the settings calls are real. */
const REPLY = { reply: "Te falta leche, huevos y pan.", applied: [], skipped: [] };
const lang = page => page.evaluate(() => fetch("/api/settings").then(r => r.json()).then(s => s.language));

async function ask(page, base, q) {
  await page.evaluate(() => window.__aryaShow("chat"));
  await page.waitForSelector("#chat-form");
  const n = await page.locator("#chat-log .bubble.arya:not(.offer)").count();
  await page.fill("#chat-input", q);
  await page.click("#chat-send");
  await page.waitForFunction(k => document.querySelectorAll("#chat-log .bubble.arya:not(.offer)").length > k, n);
}

export default async function (page, base) {
  await page.route("**/api/chat", r => r.fulfill({ json: REPLY }));
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.evaluate(() => { try { localStorage.removeItem("arya-lang-offer-no"); } catch { /* ignore */ } });
  await page.reload();
  await page.waitForSelector("#tabs");

  // Settings: the row sits under Currency with the four options.
  await page.evaluate(() => window.__aryaShow("profile"));
  await page.waitForSelector("#pf-language");
  const order = await page.$$eval("#profile-account select", s => s.map(e => e.id));
  if (order.join() !== "pf-currency,pf-language") throw new Error("Language row should follow Currency: " + order);
  const opts = await page.$$eval("#pf-language option", o => o.map(e => e.value + "=" + e.textContent));
  if (opts.join() !== "auto=Auto,en=English,es=Español,hi=हिन्दी") throw new Error("options wrong: " + opts);
  if ((await page.inputValue("#pf-language")) !== "auto") throw new Error("default should be auto");
  await page.selectOption("#pf-language", "es");
  await page.waitForFunction(() => document.querySelector("#toast")?.textContent?.includes("Arya now answers in Español."));
  if ((await lang(page)) !== "es") throw new Error("language not saved");
  await page.selectOption("#pf-language", "auto");
  await page.waitForFunction(() => document.querySelector("#toast")?.textContent?.includes("the language you use"));
  if ((await lang(page)) !== "auto") throw new Error("auto not saved");

  // English on Auto: no offer.
  await ask(page, base, "What's running low?");
  if (await page.$("#lang-offer")) throw new Error("offer shown for English");

  // Spanish on Auto: the offer; Yes sets Español.
  await ask(page, base, "¿Qué nos falta para la semana?");
  await page.waitForSelector("#lang-offer");
  const card = await page.textContent("#lang-offer");
  if (!card.includes("Reply in Español from now on?") || !card.includes("Yes, Español")) throw new Error("offer text: " + card);
  await page.click("#lang-offer-yes");
  await page.waitForSelector("#lang-offer", { state: "detached" });
  if ((await lang(page)) !== "es") throw new Error("Yes did not set es");
  await page.evaluate(() => fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ language: "auto" }) }));

  // A new session: offered again; No hides it, and it stays gone after a reload.
  await page.reload();
  await page.waitForSelector("#tabs");
  await ask(page, base, "Se acabó la leche");
  await page.waitForSelector("#lang-offer");
  await page.click("#lang-offer-no");
  await page.waitForSelector("#lang-offer", { state: "detached" });
  if ((await lang(page)) !== "auto") throw new Error("No should not change the setting");
  await page.reload();
  await page.waitForSelector("#tabs");
  await ask(page, base, "¿Cuánto gastamos en café?");
  await page.waitForTimeout(300);
  if (await page.$("#lang-offer")) throw new Error("offer came back after No");
}
