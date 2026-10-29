/* Ask: empty prompts, a suggested question gets a reply, speaker toggles. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  await page.evaluate(() => window.__aryaShow("chat"));
  await page.waitForSelector("#view-chat #chat-empty");
  if (!(await page.isVisible("#chat-demo-note"))) throw new Error("demo note missing");
  await page.click("#btn-speak");
  if ((await page.getAttribute("#btn-speak", "aria-pressed")) !== "true") throw new Error("speaker did not toggle");
  await page.click("#btn-speak");
  await page.click('#chat-empty [data-ask]');
  await page.waitForSelector("#chat-log .bubble.me");
  await page.waitForSelector("#chat-log .bubble.arya", { timeout: 30000 });
  if (await page.$("#chat-empty")) throw new Error("empty prompt not removed");
  await page.fill("#chat-input", "What do we spend on coffee?");
  await page.click("#chat-send");
  await page.waitForFunction(() => document.querySelectorAll("#chat-log .bubble.me").length === 2);
}
