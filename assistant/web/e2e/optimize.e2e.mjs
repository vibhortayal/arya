/* Check the list: corrected undo/redo, a question, skip, continue. */
export default async function (page, base) {
  await page.goto(base + "/next/");
  await page.evaluate(() => fetch("/auth/demo", { method: "POST" }));
  await page.reload();
  await page.waitForSelector("#tabs");
  await page.evaluate(() => {
    const draft = {
      raw: [{ name: "mlk", qty: 1 }, { name: "bred", qty: 2 }, { name: "pasta", qty: 1 }],
      store: "Trader Joe's", storeId: null, pick: {}, fromList: null, fastMode: null,
      undone: {}, answers: {}, qQty: { pasta: 1 },
      opt: {
        items: [{ name: "Milk", qty: 1, group: "g:milk" }, { name: "Bread", qty: 2, group: "g:bread" }],
        report: {
          in: 3, merged: [{ name: "Bread", from: ["bred", "bread"], qty: 2 }],
          corrected: [{ from: "mlk", to: "Milk" }],
          questions: [{ item: "pasta", candidates: [{ name: "Penne" }, { name: "Spaghetti" }] }],
          unresolved: ["zzz"],
        },
      },
      baseItems: [{ name: "Milk", qty: 1, group: "g:milk" }, { name: "Bread", qty: 2, group: "g:bread" }],
    };
    window.__aryaShow("optimize", { draft });
  });
  await page.waitForSelector("#view-optimize #opt-body");
  const sum = await page.textContent("#opt-summary");
  if (sum !== "3 in · 1 merged · 1 corrected · 1 to ask · 1 kept as typed") throw new Error("summary: " + sum);
  if (!(await page.isVisible("#opt-skip"))) throw new Error("skip should show while a question is open");

  await page.click("[data-undo='0']");
  await page.waitForSelector("[data-redo='0']");
  if (!(await page.textContent("#opt-body")).includes("Kept as you typed it.")) throw new Error("undo not shown");
  await page.click("[data-redo='0']");
  await page.waitForSelector("[data-undo='0']");

  await page.click("[data-q='pasta'][data-ans='cand:Penne']");
  if ((await page.getAttribute("[data-q='pasta'][data-ans='cand:Penne']", "aria-pressed")) !== "true") throw new Error("answer not pressed");
  await page.waitForSelector("[data-qundo='pasta']");
  if (await page.isVisible("#opt-skip")) throw new Error("skip should hide when answered");
  await page.click("[data-qundo='pasta']");
  await page.waitForSelector("#opt-skip", { state: "visible" });

  await page.click("#opt-skip");
  await page.waitForSelector("#view-mode");
}
