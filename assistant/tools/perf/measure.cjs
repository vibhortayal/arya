// Frontend baseline: cold and warm loads on emulated slow 4G + 4x CPU slowdown.
// usage: node measure.cjs <baseUrl> [out.json]   (demo account; no model calls)
const { chromium } = require("playwright");
const base = process.argv[2], out = process.argv[3];
const NET = { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 };
const INIT = () => {
  window.__m = { lcp: 0, cls: 0, longMs: 0 };
  new PerformanceObserver(l => { for (const e of l.getEntries()) window.__m.lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__m.cls += e.value; }).observe({ type: "layout-shift", buffered: true });
  new PerformanceObserver(l => { for (const e of l.getEntries()) window.__m.longMs += Math.max(0, e.duration - 50); }).observe({ type: "longtask", buffered: true });
};
async function session(browser, throttle) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const stats = { bytes: 0, reqs: 0, js: 0, api: [] };
  cdp.on("Network.loadingFinished", e => { stats.bytes += e.encodedDataLength; stats.reqs++; });
  cdp.on("Network.responseReceived", e => { if (e.response.url.includes("/api/")) stats.api.push([e.response.url.replace(/^https?:\/\/[^/]+/, ""), Math.round(e.response.timing ? e.response.timing.receiveHeadersEnd : 0)]); });
  await cdp.send("Network.enable");
  if (throttle) { await cdp.send("Network.emulateNetworkConditions", NET); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 }); }
  return { ctx, page, cdp, stats };
}
const m = p => p.evaluate(() => ({ ...window.__m, fcp: (performance.getEntriesByName("first-contentful-paint")[0] || {}).startTime || 0 }));
const rnd = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "number" ? Math.round(v * 1000) / 1000 : v]));
(async () => {
  const browser = await chromium.launch();
  const res = {};
  { // logged-out landing, cold
    const s = await session(browser, true);
    const t0 = Date.now(); await s.page.goto(base + "/", { waitUntil: "load" }); await s.page.waitForTimeout(1500);
    res.landing_cold = rnd({ ...(await m(s.page)), kb: Math.round(s.stats.bytes / 1024), reqs: s.stats.reqs, loadMs: Date.now() - t0 });
    await s.ctx.close();
  }
  { // demo: Today cold, Today warm, then tabs
    const s = await session(browser, false);
    await s.ctx.request.post(base + "/auth/demo");
    await s.cdp.send("Network.emulateNetworkConditions", NET); await s.cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const t0 = Date.now(); await s.page.goto(base + "/", { waitUntil: "load" }); await s.page.waitForSelector("#tabs", { timeout: 60000 }); await s.page.waitForTimeout(1500);
    res.today_cold = rnd({ ...(await m(s.page)), kb: Math.round(s.stats.bytes / 1024), reqs: s.stats.reqs, readyMs: Date.now() - t0 });
    for (const v of ["list", "chat", "community", "profile"]) {
      const b0 = s.stats.bytes, r0 = s.stats.reqs, t1 = Date.now();
      await s.page.click(`#tabs [data-view=view-${v}]`);
      await s.page.waitForSelector(`#view-${v}`, { state: "attached", timeout: 30000 });
      await s.page.waitForTimeout(1200);
      res["tab_" + v] = { extraKb: Math.round((s.stats.bytes - b0) / 1024), reqs: s.stats.reqs - r0, ms: Date.now() - t1 - 1200 };
    }
    s.stats.bytes = 0; s.stats.reqs = 0;
    const t2 = Date.now(); await s.page.reload({ waitUntil: "load" }); await s.page.waitForSelector("#tabs"); await s.page.waitForTimeout(1500);
    res.today_warm = rnd({ ...(await m(s.page)), kb: Math.round(s.stats.bytes / 1024), reqs: s.stats.reqs, readyMs: Date.now() - t2 });
    await s.ctx.close();
  }
  await browser.close();
  console.log(JSON.stringify(res, null, 1));
  if (out) require("fs").writeFileSync(out, JSON.stringify(res, null, 1));
})();
