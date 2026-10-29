/* Capture: shows the prompt, steps, time; Open camera falls back to the
 * file input when there is no camera; a photo upload shows the result;
 * Back leaves the screen. */
export default async function (page, base) {
  await page.goto(base + "/next/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  await page.evaluate(() => window.__aryaShow("capture", { store: "E2E Store", prompt: {
    kind: "photo", segment: "aisle-1", teach: false, est_seconds: 12, title: "Photo of Aisle 1",
    why: "Show Arya this shelf.", steps: ["Stand back a step.", "Hold still."] } }));
  await page.waitForSelector("#view-capture");
  const title = await page.textContent("#cp-title");
  if (title !== "Photo of Aisle 1") throw new Error("title: " + title);
  const steps = await page.$$eval("#cp-steps li", l => l.map(x => x.textContent));
  if (steps.join("|") !== "Stand back a step.|Hold still.") throw new Error("steps: " + steps);
  if ((await page.textContent("#cp-time")) !== "About 12 seconds.") throw new Error("time");
  if ((await page.textContent("#cp-go")) !== "Open camera") throw new Error("go label");
  if (!(await page.isVisible("#cp-outdated"))) throw new Error("outdated button missing");
  if (await page.isVisible("#cp-cam")) throw new Error("camera should be hidden");
  // Without a camera the button falls back to the system file picker.
  await page.evaluate(() => { try { Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true }); } catch {} });
  const chooser = page.waitForEvent("filechooser", { timeout: 5000 });
  await page.click("#cp-go");
  await chooser;
  // Pick-the-aisle prompt (no segment yet) shows the aisle chooser,
  // read from this store's map. Re-opening capture replaces the one on
  // top, so one Back still leaves the screen.
  const mapRead = page.waitForRequest(r => r.url().includes("/api/storemap?store=E2E%20Store"));
  await page.evaluate(() => window.__aryaShow("capture", { store: "E2E Store", prompt: {
    kind: "photo", segment: "", teach: false, title: "Photo of a shelf", steps: [] } }));
  await page.waitForFunction(() => { const r = document.querySelector("#cp-result"); return r && !r.hidden; });
  await mapRead;
  if (await page.isVisible("#cp-controls")) throw new Error("controls should be hidden while picking an aisle");
  if (await page.isVisible("#cp-outdated")) throw new Error("outdated should be hidden without a segment");
  await page.click("#view-capture .qback");
  await page.waitForFunction(() => !document.querySelector("#view-capture"));
}
