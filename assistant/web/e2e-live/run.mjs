/* Live e2e runner: checks the deployed site the way real users would,
 * with three tester accounts at once (group sharing, live sync, privacy
 * between households). Every e2e-live/*.live.mjs exports default
 * async (t) and throws on failure; t carries signed-in pages.
 *
 * No password lives here. Passwords come from the environment (GitHub
 * Actions secrets of the same names in CI):
 *   ARYA_TESTER_A_PASSWORD  ARYA_TESTER_B_PASSWORD  ARYA_TESTER_C_PASSWORD
 * Optional overrides:
 *   ARYA_BASE_URL            default https://arya.teamnightshift.org
 *   ARYA_TESTER_A_EMAIL      default tester-a@test.arya (B and C alike)
 * Each tester signs in once per run through /team (the password form):
 * the API locks an IP out for 15 minutes after 8 wrong passwords, so a
 * bad secret fails fast instead of retrying.
 * ARYA_LIVE_KNOWN=1 also runs known-issues.live.mjs (checks for bugs
 * found on 2026-10-31 that are expected to fail until fixed).
 * Usage: node e2e-live/run.mjs [name ...] */
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = (process.env.ARYA_BASE_URL || "https://arya.teamnightshift.org").replace(/\/$/, "");
const dir = new URL("./", import.meta.url);
const only = process.argv.slice(2);
const files = readdirSync(dir)
  .filter(f => f.endsWith(".live.mjs"))
  .filter(f => process.env.ARYA_LIVE_KNOWN === "1" || f !== "known-issues.live.mjs")
  .filter(f => !only.length || only.some(o => f.startsWith(o)))
  .sort();

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const browser = await chromium.launch();
const errors = [];

function watch(page, who) {
  page.on("pageerror", e => errors.push(who + ": " + e.message));
  return page;
}

async function newPhone(who) {
  const ctx = await browser.newContext(PHONE);
  return watch(await ctx.newPage(), who);
}

function testerEmail(key) {
  return process.env[`ARYA_TESTER_${key}_EMAIL`] || `tester-${key.toLowerCase()}@test.arya`;
}

// Signs one tester in through the /team password form; returns the page.
// A new account gets the one Today question as a sheet over the app.
// Skip it, as a user can, so it does not cover the tabs.
async function skipAsk(page) {
  const sheet = page.locator("#today-ask");
  if (!(await sheet.waitFor({ state: "visible", timeout: 4000 }).then(() => true, () => false))) return;
  await sheet.getByRole("button", { name: "Skip", exact: true }).click();
  await sheet.waitFor({ state: "hidden" });
}

async function signIn(key) {
  const user = testerEmail(key);
  const pass = process.env[`ARYA_TESTER_${key}_PASSWORD`];
  if (!pass) throw new Error(`ARYA_TESTER_${key}_PASSWORD must be set`);
  const page = await newPhone("tester " + key);
  await page.goto(BASE + "/team");
  await page.waitForSelector("#login-user");
  await page.fill("#login-user", user);
  await page.fill("#login-pass", pass);
  await page.click("#login-btn");
  const done = await Promise.race([
    page.waitForSelector("#tabs", { timeout: 20000 }).then(() => "in"),
    page.waitForFunction(() => document.querySelector("#login-error")?.textContent.trim(), null, { timeout: 20000 }).then(() => "error"),
  ]);
  // The page's own message only; never the address or password.
  if (done !== "in") throw new Error(`tester ${key} could not sign in: ` + await page.textContent("#login-error"));
  if (new URL(page.url()).pathname !== "/") throw new Error(`tester ${key}: address after sign-in is ${page.url()}, not /`);
  await skipAsk(page);
  return page;
}

// JSON call made from inside a page, so it carries that tester's session.
async function api(page, path, body) {
  return page.evaluate(async ([path, body]) => {
    const r = await fetch(path, body === undefined ? {} : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    let json = null;
    try { json = await r.json(); } catch { }
    return { status: r.status, json };
  }, [path, body]);
}

const t = { base: BASE, testerEmail, api, newPhone, skipAsk, stamp: "zz-e2e-" + Date.now().toString(36), users: {} };
let failed = 0;
try {
  if (files.some(f => !["demo.live.mjs", "known-issues.live.mjs"].includes(f))) {
    for (const k of ["A", "B", "C"]) t.users[k] = await signIn(k);
    console.log("ok   sign in as testers A, B and C");
  }
  for (const f of files) {
    errors.length = 0;
    try {
      await (await import(new URL(f, dir))).default(t);
      if (errors.length) throw new Error("page errors: " + errors.join("; "));
      console.log("ok   " + f);
    } catch (e) {
      failed++;
      console.log("FAIL " + f + "\n     " + (e && e.message));
    }
  }
} catch (e) {
  failed++;
  console.log("FAIL setup\n     " + (e && e.message));
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
