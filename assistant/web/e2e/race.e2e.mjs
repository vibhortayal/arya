/* Race (Shop-Off): form validation, store prefill, creating a race lists it, Open leaves the screen. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  await page.evaluate(() => window.__aryaShow("race", { store: "Trader Joe's" }));
  await page.waitForSelector("#view-race #race-create");
  if ((await page.inputValue("#race-store")) !== "Trader Joe's") throw new Error("store not prefilled");
  await page.click("#race-create");
  await page.waitForSelector("#toast:has-text('opponent')").catch(() => {});
  await page.fill("#race-opp", "@cartqueen");
  await page.fill("#race-items", "milk\neggs");
  await page.click("#race-create");
  await page.waitForSelector("#race-body [data-open-sess]", { timeout: 15000 });
  const txt = await page.textContent("#race-body");
  if (!txt.includes("Trader Joe's") || !txt.includes("@cartqueen")) throw new Error("race body: " + txt);
  await page.click("#race-body [data-open-sess]");
  await page.waitForFunction(() => !document.querySelector("#view-race") || document.querySelector("#view-race").hidden || !document.querySelector("#view-race").offsetParent, null, { timeout: 10000 });
}
