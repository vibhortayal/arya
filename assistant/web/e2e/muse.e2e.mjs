/* Connect an AI agent: link code make/copy/revoke, setup prompt, Back to Profile.
 * The demo may not hold a connector token (/auth/token answers 401 for a
 * demo session, and the old app then leaves the row empty), so the demo
 * check comes first; the make/copy/revoke flow then runs against a
 * stand-in for a signed-in account's /auth/token (GET/POST/DELETE). */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  // Reached from Profile's "Connect an AI agent" row, as in the old app.
  await page.evaluate(() => window.__aryaShow("about"));
  await page.waitForSelector("#btn-muse");
  if (!(await page.textContent("#btn-muse")).includes("Use Arya in another AI app")) throw new Error("profile row text");
  const demoGet = page.waitForResponse(r => r.url().endsWith("/auth/token") && r.request().method() === "GET");
  await page.evaluate(() => window.__aryaShow("about"));
  await page.click("#btn-muse");
  await page.waitForSelector("#view-muse");
  if ((await page.textContent("#view-muse h1")) !== "Use Arya in another AI app") throw new Error("title");
  if ((await demoGet).status() !== 401) throw new Error("demo should not read a token");
  await page.waitForTimeout(100);
  // No code buttons in the demo; one line says why (retest 2026-10-31 #24).
  if ((await page.$$("#profile-token-row button")).length) throw new Error("demo row should have no code buttons");
  if (!(await page.$("#muse-demo"))) throw new Error("demo line missing");
  await page.click("[data-copy-prompt]");
  await page.waitForFunction(() => document.body.textContent.includes("Setup prompt copied."));

  // A signed-in account: the server's token routes, held in memory.
  const calls = [];
  let has = false;
  await page.route("**/auth/token", route => {
    const m = route.request().method();
    calls.push(m);
    if (m === "GET") return route.fulfill({ json: { has_token: has } });
    if (m === "POST") { has = true; return route.fulfill({ json: { token: "arya_e2e_token", note: "Shown once." } }); }
    if (m === "DELETE") { has = false; return route.fulfill({ json: { ok: true, has_token: false } }); }
    return route.fulfill({ status: 405, json: {} });
  });
  await page.click("#pfm-back");
  await page.waitForSelector("#view-about");
  await page.evaluate(() => window.__aryaShow("about"));
  await page.click("#btn-muse");
  await page.waitForSelector("#profile-token-row button[data-mint]");
  if (!(await page.textContent("#profile-token-row")).includes("No code yet.")) throw new Error("no-token row");
  if (await page.$("#profile-token-row button[data-revoke]")) throw new Error("revoke without a token");
  await page.click("#profile-token-row button[data-mint]");
  await page.waitForSelector("#profile-token-row [data-token-value]");
  if ((await page.inputValue("#profile-token-row [data-token-value]")) !== "arya_e2e_token") throw new Error("minted token not shown");
  await page.click("#profile-token-row button[data-copy]");
  await page.waitForFunction(() => document.body.textContent.includes("Code copied."));
  // Back to About Arya; reopening repaints with an active code that can be revoked.
  await page.click("#pfm-back");
  await page.waitForSelector("#view-about");
  await page.evaluate(() => window.__aryaShow("about"));
  await page.click("#btn-muse");
  await page.waitForSelector("#profile-token-row button[data-revoke]");
  if (!(await page.textContent("#profile-token-row")).includes("Your code is on.")) throw new Error("active row");
  await page.click("#profile-token-row button[data-revoke]");
  await page.waitForFunction(() => document.body.textContent.includes("Code turned off."));
  await page.waitForSelector("#profile-token-row button[data-mint]");
  const t = await page.textContent("#profile-token-row");
  if (!t.includes("No code yet.")) throw new Error("revoke did not reset: " + t);
  const want = "GET,POST,GET,DELETE,GET";
  if (calls.join() !== want) throw new Error(`token calls ${calls.join()} != ${want}`);
}
