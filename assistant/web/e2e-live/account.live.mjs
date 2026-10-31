/* Signed-in basics for each tester: the right account, Settings shows
 * the group row (not in the demo), and a reload keeps you signed in.
 * Sign out is tested last, in zz-signout.live.mjs. */
export default async function (t) {
  for (const [k, page] of Object.entries(t.users)) {
    const me = await t.api(page, "/auth/me");
    const want = t.testerEmail(k).toLowerCase();
    const got = JSON.stringify(me.json).toLowerCase();
    if (me.status !== 200 || !got.includes(want.split("@")[0])) throw new Error(`tester ${k}: /auth/me is ${me.status} ${got}`);
    await page.reload();
    await page.waitForSelector("#tabs");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.waitForSelector("#pf-group:not([hidden])", { timeout: 10000 })
      .catch(() => { throw new Error(`tester ${k}: no group row in Settings`); });
  }
}
