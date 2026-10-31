/* Runs last (files run in name order): Sign out in Settings ends C's
 * session and goes back to the landing. */
export default async function (t) {
  const C = t.users.C;
  await C.getByRole("button", { name: "Settings", exact: true }).click();
  await C.click("#btn-signout2");
  await C.waitForSelector("#demo-btn", { timeout: 10000 });
  const after = await t.api(C, "/auth/me");
  if (after.status === 200 && after.json?.user) throw new Error("C is still signed in after Sign out");
}
