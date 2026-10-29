/* Guided scan: pan, never tap. A canvas stands in for the camera; the
 * scan route is stubbed. Arya's read shows as coaching and outlines,
 * a frame full of people pauses, and Done shows what was found. */
export default async function (page, base) {
  await page.addInitScript(() => {
    const c = document.createElement("canvas"); c.width = 640; c.height = 480;
    const g = c.getContext("2d");
    let n = 0;
    setInterval(() => {   // busy shelves: sharp edges, decent light
      n++;
      g.fillStyle = "#9a9a9a"; g.fillRect(0, 0, 640, 480);
      for (let i = 0; i < 40; i++) { g.fillStyle = i % 2 ? "#202020" : "#f0f0f0"; g.fillRect((i * 16 + n * 4) % 640, 0, 8, 480); }
    }, 50);
    const stream = c.captureStream(20);
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => stream } });
  });
  let calls = 0;
  await page.route("**/api/storemap/scan**", route => {
    calls++;
    const body = calls === 2 ? { paused: "people", kept: false, frames_left: 100 } : {
      kept: true, label: "Aisle 4", segment: "aisle-4:both", created: true, sign: "Aisle 4 Dairy",
      items: ["Milk", "Eggs"], prices: [], people: 1, frames_left: 100,
      boxes: { shelf: [[0.05, 0.3, 0.6, 0.5]], sign: [[0.2, 0.05, 0.7, 0.15]] },
      reward: { points: 10, new_section: calls === 1 } };
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  await page.evaluate(() => window.__aryaShow("capture", { store: "E2E Store", prompt: {
    kind: "walk", segment: "", teach: true, est_seconds: 30, title: "Walk your store", steps: [] } }));
  await page.waitForSelector("#cp-prices");
  await page.click("#cp-go");
  await page.waitForSelector("#cp-coach");
  await page.waitForFunction(() => /I see Aisle 4: Milk, Eggs/.test(document.querySelector("#cp-coach")?.textContent || ""), null, { timeout: 15000 });
  if (!(await page.$(".cp-mark.sign span"))) throw new Error("sign outline missing");
  await page.waitForFunction(() => /clear view/.test(document.querySelector("#cp-coach")?.textContent || ""), null, { timeout: 15000 });
  await page.click("#cp-go");   // Done
  await page.waitForSelector("#cp-result .cp-extra");
  const txt = await page.textContent("#cp-result");
  if (!/Aisle 4 Dairy/.test(txt) || !/person blurred, none kept/.test(txt)) throw new Error("summary: " + txt);
}
