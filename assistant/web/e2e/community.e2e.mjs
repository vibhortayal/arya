/* Quest tab: title, new hunt, crew rows navigate, Teach Arya your store. */
export default async function (page, base) {
  await page.goto(base + "/next/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  const show = async () => {
    await page.evaluate(() => window.__aryaShow("community"));
    await page.waitForSelector("#view-community #btn-new-hunt");
  };
  await show();
  const title = await page.textContent("#view-community .largetitle");
  if (title !== "Quest") throw new Error("title: " + title);
  for (const sel of ["#btn-map-store", "#view-community [data-qnav=view-race]", "#view-community [data-qnav=view-friends]", "#album-nav-sub"])
    if (!(await page.isVisible(sel))) throw new Error("missing " + sel);
  await page.click("#btn-new-hunt");
  await page.waitForSelector("#view-store");
  await page.evaluate(() => window.__aryaShow("community"));
  await page.waitForSelector("#view-community");
  await page.click('#view-community [data-qnav=view-race]');
  await page.waitForFunction(() => !document.querySelector("#view-community"));
  await show();
  await page.click("#btn-map-store");
  await page.waitForFunction(() => !document.querySelector("#view-community"));
  await show();
  if (await page.isVisible("#comm-fastest")) {
    await page.click('#comm-scopes [data-scope="friends"]');
    await page.waitForSelector("#comm-board .samplepill");
  }
}
