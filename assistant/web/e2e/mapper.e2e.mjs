/* Teach Arya your store: store chips, coverage, walk start, aisles,
 * add an aisle, and opening the capture screen. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  await page.evaluate(() => window.__aryaShow("mapper"));
  await page.waitForSelector("#view-mapper h2");
  await page.waitForSelector("#mp-walkstart");
  if (!(await page.$$("#mp-stores [data-mstore]")).length) throw new Error("no store chips");
  if ((await page.$$eval("#mp-stores [aria-pressed=true]", e => e.length)) !== 1) throw new Error("one store should be selected");
  if (!(await page.textContent("#mp-cover"))) throw new Error("cover empty");
  await page.waitForSelector("#mp-segs .row, #mp-segs .empty");

  // Add-aisle lives in the closed "Fine-tune" disclosure (as in the old
  // app): open it, then an empty name toasts and a real one is added.
  if (await page.isVisible("#mp-add")) throw new Error("fine-tune should start closed");
  await page.click("#view-mapper details summary");
  await page.waitForSelector("#mp-add", { state: "visible" });
  await page.click("#mp-add");
  await page.waitForFunction(() => /Name the aisle first/.test(document.getElementById("toast")?.textContent || ""));
  await page.click("#mp-side [data-side=left]");
  if ((await page.getAttribute("#mp-side [data-side=left]", "aria-pressed")) !== "true") throw new Error("side chip");
  await page.fill("#mp-label", "E2E Aisle " + (Date.now() % 100000));
  await page.click("#mp-add");
  await page.waitForFunction(() => /Added|already has/.test(document.getElementById("toast")?.textContent || ""));
  await page.waitForFunction(() => document.getElementById("mp-label").value === "");

  // Focus toggle flips Mine/+.
  const f = await page.$("#mp-segs [data-mfocus]");
  if (f) {
    const before = await f.getAttribute("aria-pressed");
    await f.click();
    await page.waitForFunction(b => document.querySelector("#mp-segs [data-mfocus]").getAttribute("aria-pressed") !== b, before);
  }

  // The walk opens the capture screen.
  await page.click("#mp-walkstart");
  await page.waitForSelector("#view-capture", { state: "attached" });
  await page.waitForFunction(() => !document.getElementById("view-mapper") || document.getElementById("view-mapper").hidden || !document.querySelector("#view-mapper h2"));
}
