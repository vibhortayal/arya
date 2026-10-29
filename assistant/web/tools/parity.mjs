/* Screenshot parity: the same screen in the current app (/) and the
 * new one (/next/), on one demo session at 390x844, compared pixel by
 * pixel. A straight port must match; that replaces a wireframe
 * (PORTING.md). Usage:
 *   npm run build && npm run parity -- home list    (default: login + every ported screen)
 * Env: ARYA_URL (default http://localhost:8000), PARITY_MAX (percent
 * of pixels allowed to differ, default 0.5). Writes old/new/diff
 * PNGs to parity-out/ and exits 1 when any screen is over. */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = process.env.ARYA_URL || "http://localhost:8000";
const MAX = Number(process.env.PARITY_MAX || 0.5);
const OUT = new URL("../parity-out/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

function portedViews() {
  const src = readFileSync(new URL("../src/screens/registry.tsx", import.meta.url), "utf8");
  const body = src.split("const PORTED")[1].split("};")[0];
  return [...body.matchAll(/^\s*"?([a-z-]+)"?\s*:/gm)].map(m => m[1]);
}

/* Screens that need an id: how to find one on the demo, and how
 * each app opens the screen with it. */
const SPECIAL = {
  item: {
    id: () => fetch("/api/home").then(r => r.json()).then(h => (h.list?.items || [])[0]?.item_id),
    old: id => `renderItem(${JSON.stringify(id)})`,
    new: id => `window.__aryaShow("item", { id: ${JSON.stringify(id)} })`,
  },
  receipt: {
    id: () => fetch("/api/quest/receipts").then(r => r.json()).then(r => (r.receipts || [])[0]?.receipt_id),
    old: id => `openReceipt(${JSON.stringify(id)})`,
    new: id => `window.__aryaShow("receipt", { receipt_id: ${JSON.stringify(id)} })`,
  },
  // No id: these only need the old app's real entry function.
  "stores-mine": { old: () => `questGo("view-stores-mine")`, new: () => `window.__aryaShow("stores-mine")` },
  mapper: { old: () => `questGo("view-mapper")`, new: () => `window.__aryaShow("mapper")` },
  "stores-find": { old: () => `questGo("view-stores-find")`, new: () => `window.__aryaShow("stores-find")` },
  "stores-add": { old: () => `questGo("view-stores-add")`, new: () => `window.__aryaShow("stores-add")` },
  store: { old: () => `qStartNewHunt(null)`, new: () => `window.__aryaShow("store")` },
  newlist: {
    old: () => `qStartNewHunt(null).then(() => { document.querySelector("#st-name").value = "Trader Joe's"; qPickStore(); })`,
    new: () => `window.__aryaShow("newlist", { store: "Trader Joe's" })`,
  },
  album: { old: () => `questGo("view-album")`, new: () => `window.__aryaShow("album")` },
  race: { old: () => `questGo("view-race")`, new: () => `window.__aryaShow("race")` },
  friends: { old: () => `questGo("view-friends")`, new: () => `window.__aryaShow("friends")` },
  // Trip screens: a fresh demo session (the "id" is the session itself).
  hunt: { id: () => paritySession("quest"), old: s => `openHunt(${JSON.stringify(s)})`, new: s => `window.__aryaShow("hunt", { session: ${JSON.stringify(s)} })` },
  express: { id: () => paritySession("express"), old: s => `openExpress(${JSON.stringify(s)})`, new: s => `window.__aryaShow("express", { session: ${JSON.stringify(s)} })` },
  finish: { id: () => paritySession("quest"), old: s => `openFinish(${JSON.stringify(s)})`, new: s => `window.__aryaShow("finish", { session: ${JSON.stringify(s)} })` },
  score: { id: () => paritySession("quest", "finished"), old: s => `openScore(${JSON.stringify(s)})`, new: s => `window.__aryaShow("score", { session: ${JSON.stringify(s)} })` },
  // The haul screens (haul.js): a closed trip with two items grabbed.
  // The reveal counts up for about a second, so both wait it out.
  reveal: {
    id: () => paritySession("quest", "finished", 2),
    old: s => `HaulUI.openReveal(${JSON.stringify(s)}).then(() => new Promise(r => setTimeout(r, 1500)))`,
    new: s => `(window.__aryaShow("reveal", { session: ${JSON.stringify(s)} }), new Promise(r => setTimeout(r, 2000)))`,
  },
  rreview: {
    id: () => paritySession("quest", "finished", 2, true),
    old: s => `HaulUI.openReview(${JSON.stringify(s)})`,
    new: s => `window.__aryaShow("rreview", { session: ${JSON.stringify(s)} })`,
  },
  haul: {
    id: () => paritySession("quest", "finished", 2, true),
    old: s => `HaulUI.openCard(${JSON.stringify(s)})`,
    new: s => `window.__aryaShow("haul", { session: ${JSON.stringify(s)} })`,
  },
};

/* Runs in the page: a demo trip at Trader Joe's, optionally with the
 * first `grab` items collected, moved to a state, and settled with the
 * sample receipt. */
const PARITY_SESSION = `async function paritySession(mode, state, grab, settle) {
  const j = (u, b) => fetch(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then(r => r.json());
  let s = await j("/api/quest/sessions", { store: "Trader Joe's", mode, items: [{ name: "Milk", qty: 1 }, { name: "Bread", qty: 2 }, { name: "Eggs", qty: 1 }] });
  if (grab) {
    await j("/api/quest/sessions/" + s.id + "/state", { state: "playing" });
    for (const it of s.items.slice(0, grab)) await j("/api/quest/sessions/" + s.id + "/check", { item: it.name, checked: true });
  }
  if (state) s = await j("/api/quest/sessions/" + s.id + "/state", { state });
  if (settle) s = await j("/api/quest/sessions/" + s.id + "/sample-receipt", {});
  return s;
}`;

/* Screens that only exist mid-flow (a draft or a capture prompt from
 * the screen before): checked by their e2e files, not parity. */
const FLOW_ONLY = new Set(["capture", "optimize", "mode"]);

const views = process.argv.slice(2).length ? process.argv.slice(2) : ["login", ...portedViews()];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
// Freeze motion and the Add to Home Screen nudge so frames are stable.
await ctx.addInitScript(() => {
  try { localStorage.setItem("arya.a2hs", JSON.stringify({ dismissed: Date.now() })); } catch (e) { /* private */ }
  addEventListener("DOMContentLoaded", () => {
    const s = document.createElement("style");
    s.textContent = "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}";
    document.head.appendChild(s);
  });
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));

/* Screens whose store view glides to the first stop (up to 1.9 s in
 * scene.js) settle longer before the frame is taken. */
const SETTLE = { hunt: 2600, express: 2600 };

async function shot(url, open, file, settle = 600) {
  await page.goto(BASE + url);
  await page.waitForLoadState("networkidle");
  if (open) {
    await page.waitForFunction(url === "/" ? "!document.querySelector('#app-main').hidden" : "typeof window.__aryaShow === 'function'");
    await page.evaluate(open);
    await page.waitForLoadState("networkidle");
  }
  await page.waitForTimeout(settle);
  await page.screenshot({ path: OUT + file });
  return PNG.sync.read(await page.screenshot());
}

let failed = 0;
for (const v of views) {
  if (FLOW_ONLY.has(v)) { console.log(`skip ${v.padEnd(16)} mid-flow screen, see e2e/${v}.e2e.mjs`); continue; }
  if (page.url() === "about:blank") await page.goto(BASE + "/");
  if (v !== "login" && !(await page.evaluate(() => fetch("/auth/me").then(r => (r.ok ? r.json() : {})).then(m => !!(m && m.user))))) {
    await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  }
  const sp = SPECIAL[v];
  const id = sp && sp.id ? await page.evaluate(`(async () => { ${PARITY_SESSION}; return (${sp.id.toString()})(); })()`) : null;
  if (sp && sp.id && id == null) { console.log(`skip ${v.padEnd(16)} no id on the demo`); continue; }
  const oldImg = await shot("/", sp ? sp.old(id) : v === "login" ? null
    // Open through the screen's real entry button when it has one (it may set state), else show().
    // Tabs and screens with an entry button open through it (it may set state), else show().
    : `{ const b = document.querySelector('#tabs button[data-view="view-${v}"]') || document.querySelector("#btn-${v}");
         if (b) b.click(); else { show("view-${v}"); refresh("view-${v}"); } }`, `${v}-old.png`, SETTLE[v]);
  const newImg = await shot("/next/", sp ? sp.new(id) : v === "login" ? null : `window.__aryaShow("${v}")`, `${v}-new.png`, SETTLE[v]);
  const { width, height } = oldImg;
  const diff = new PNG({ width, height });
  const n = newImg.height === height ? pixelmatch(oldImg.data, newImg.data, diff.data, width, height, { threshold: 0.1 }) : width * height;
  writeFileSync(OUT + `${v}-diff.png`, PNG.sync.write(diff));
  const pct = (100 * n) / (width * height);
  const ok = pct <= MAX;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${v.padEnd(16)} ${pct.toFixed(2)}% differ`);
}
if (errors.length) { console.log("page errors:\n" + errors.join("\n")); failed++; }
await browser.close();
process.exit(failed ? 1 : 0);
