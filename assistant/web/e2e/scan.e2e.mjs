/* Map my store walk (owner, 2026-10-30): full screen, coaching only,
 * nothing read while walking. A canvas stands in for the camera and the
 * background-scan routes are stubbed. Done saves the walk on the phone,
 * sends it, and Map my store shows "Building your map", then "Your map
 * is ready" with the sections to check. */
export default async function (page, base) {
  await page.addInitScript(() => {
    const c = document.createElement("canvas"); c.width = 640; c.height = 480;
    const g = c.getContext("2d");
    let n = 0;
    setInterval(() => {   // busy shelves: sharp edges, decent light, moving
      n++;
      g.fillStyle = "#9a9a9a"; g.fillRect(0, 0, 640, 480);
      for (let i = 0; i < 40; i++) { g.fillStyle = i % 2 ? "#202020" : "#f0f0f0"; g.fillRect((i * 16 + n * 6) % 640, 0, 8, 480); }
    }, 50);
    const stream = c.captureStream(20);
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => stream } });
  });
  let live = 0, frames = 0, committed = false, reads = 0;
  await page.route("**/api/storemap/scan**", route => { live++; route.fulfill({ status: 500, body: "{}" }); });
  await page.route("**/api/storemap/jobs**", route => {
    const r = route.request(), url = r.url();
    const json = body => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (r.method() === "POST" && /\/jobs$/.test(url.split("?")[0])) return json({ id: "j1", total: JSON.parse(r.postData()).frames, status: "uploading" });
    if (r.method() === "PUT") { frames++; return json({ id: "j1" }); }
    if (/commit$/.test(url)) { committed = true; return json({ id: "j1", status: "queued" }); }
    if (/seen$/.test(url)) return json({ id: "j1", seen: true });
    if (!committed) return json({ jobs: [] });
    reads++;
    const ready = reads > 1;
    return json({ jobs: [{ id: "j1", store: "E2E Store", source: "scan", status: ready ? "ready" : "reading", total: frames,
      done: ready ? frames : 1, received: frames, seen: false, at: "2026-10-30T23:00:00",
      result: ready ? { found: [{ segment: "aisle-4:both", label: "Aisle 4", created: true, fresh: true },
        { segment: "produce:both", label: "Produce", created: false, fresh: false }],
        signs: ["Aisle 4 Dairy"], prices: [], people: 1, skipped: 2, pts: 13, title: null } : null }] });
  });
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  await page.evaluate(() => window.__aryaShow("capture", { store: "E2E Store", prompt: {
    kind: "walk", segment: "", teach: true, est_seconds: 30, title: "Walk your store", steps: [] } }));
  await page.waitForSelector("#cp-prices");
  await page.click("#cp-go");
  await page.waitForSelector(".cp-cam.full #cp-done");
  if (await page.$("#tabs")) throw new Error("the tab bar should hide while scanning");
  const box = await page.$eval(".cp-cam.full", el => { const r = el.getBoundingClientRect(); return [r.width, r.height]; });
  if (box[0] < 380 || box[1] < 800) throw new Error("camera is not full screen: " + box);
  await page.waitForFunction(() => /Good, keep going|slower|steady/i.test(document.querySelector("#cp-coach")?.textContent || ""), null, { timeout: 10000 });
  await page.waitForTimeout(7000);              // a few 2 s buckets
  await page.click("#cp-done");
  await page.waitForSelector("#ms-status", { timeout: 15000 });
  await page.waitForSelector("#mp-check", { timeout: 30000 });
  if (live) throw new Error("the walk must not read frames live");
  if (frames < 2) throw new Error("expected the walk's frames to be sent, got " + frames);
  await page.click("#mp-check");
  const txt = await page.textContent(".ms-check");
  if (!/Aisle 4/.test(txt) || !/Aisle 4 Dairy/.test(txt) || !/person blurred, none kept/.test(txt)) throw new Error("check sheet: " + txt);
  await page.click("#ms-check-done");
  await page.waitForSelector(".ms-check", { state: "detached" });
}
