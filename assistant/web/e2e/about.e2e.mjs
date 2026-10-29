/* About: text renders, Back returns to Profile. */
export default async function (page, base) {
  await page.goto(base + "/next/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  await page.evaluate(() => window.__aryaShow("profile"));
  await page.waitForSelector("#view-profile");
  await page.evaluate(() => window.__aryaShow("about"));
  await page.waitForSelector("#view-about");
  const txt = await page.textContent("#view-about");
  if (!txt.includes("Vibhor Tayal") || !txt.includes("Muse Image")) throw new Error("about text: " + txt);
  const href = await page.getAttribute("#view-about a[target=_blank]", "href");
  if (!href.includes("linkedin.com")) throw new Error("link: " + href);
  await page.click("#pfa-back");
  await page.waitForSelector("#view-profile");
}
