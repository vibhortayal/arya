/* One level and one streak (usability audit, owner-approved 2026-10-29):
 * the Quest home shows the same numbers as the account (Settings, Quest
 * progress), and the game's profile lives on the server. */
export default async function (page, base) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  const acct = await page.evaluate(async () => (await fetch("/api/quest/profile")).json());
  await page.evaluate(() => window.__aryaShow("community"));
  await page.waitForSelector("#view-community .qg-lvchip");
  const lv = await page.textContent("#view-community .qg-lvchip");
  if (lv !== `Lv ${acct.level}`) throw new Error(`Quest says ${lv}, account says level ${acct.level}`);
  const wk = await page.textContent("#view-community .qg-streak");
  if (wk !== `${acct.stats.streak_weeks} wk streak`) throw new Error(`Quest says ${wk}, account says ${acct.stats.streak_weeks} weeks`);
  const game = await page.evaluate(async () => (await fetch("/api/quest/game")).json());
  if (!Array.isArray(game.weeks)) throw new Error("no game doc");
}
