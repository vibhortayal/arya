/* Tiny e2e runner: every e2e/*.e2e.mjs exports default async (page, base)
 * and throws on failure. Each gets a fresh phone-sized context.
 * Needs the API running (ARYA_URL, default http://localhost:8000) and
 * a build at /next/. friends and race need a second account to add or
 * race: ARYA_DATA_DIR=<dir> python -c "from api import auth; auth.create_user('cartqueen', 'cartqueen-pass-1')".
 * Usage: npm run e2e [-- name ...] */
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = process.env.ARYA_URL || "http://localhost:8000";
const dir = new URL("./", import.meta.url);
const only = process.argv.slice(2);
const files = readdirSync(dir).filter(f => f.endsWith(".e2e.mjs") && (!only.length || only.some(o => f.startsWith(o))));

const browser = await chromium.launch();
let failed = 0;
for (const f of files) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  try {
    await (await import(new URL(f, dir))).default(page, BASE);
    if (errors.length) throw new Error("page errors: " + errors.join("; "));
    console.log("ok   " + f);
  } catch (e) {
    failed++;
    console.log("FAIL " + f + "\n     " + (e && e.message));
  }
  await ctx.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
