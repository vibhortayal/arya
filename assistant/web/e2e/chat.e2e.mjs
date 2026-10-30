/* Ask: empty prompts, a suggested question gets a reply, no speaker toggle. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  await page.evaluate(() => window.__aryaShow("chat"));
  await page.waitForSelector("#view-chat #chat-empty");
  // The demo banner says it once; Ask has no note of its own (2026-10-30).
  if (await page.$("#chat-demo-note")) throw new Error("demo note should be gone");
  // Starter chips come from the demo's data; Map my store always follows.
  await page.waitForFunction(() => [...document.querySelectorAll("#chat-empty [data-ask]")].some(b => /^Do I need /.test(b.textContent || "")));
  if (!(await page.$("#ask-map-store"))) throw new Error("Map my store chip missing");
  // Spoken replies were removed with the Talk and Photo chips (2026-10-30).
  if (await page.$("#btn-speak")) throw new Error("the speaker toggle is back");
  await page.click('#chat-empty [data-ask]');
  await page.waitForSelector("#chat-log .bubble.me");
  await page.waitForSelector("#chat-log .bubble.arya", { timeout: 30000 });
  if (await page.$("#chat-empty")) throw new Error("empty prompt not removed");
  await page.fill("#chat-input", "What do we spend on coffee?");
  await page.click("#chat-send");
  await page.waitForFunction(() => document.querySelectorAll("#chat-log .bubble.me").length === 2);
}
