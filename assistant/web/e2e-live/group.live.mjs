/* Three households: A starts a group, B joins it with the invite code
 * in the app, C stays outside.
 * - A's add shows on B's open Lists screen without a reload (live sync).
 * - B's tick shows for A.
 * - C sees none of it and a wrong code is refused.
 * - B leaves and keeps a copy; A's later adds no longer reach B.
 * Everything it adds is named with t.stamp and removed at the end;
 * A and B leave any group they were in before it starts. */
async function items(t, page) {
  const r = await t.api(page, "/api/home");
  if (r.status !== 200) throw new Error("/api/home answered " + r.status);
  return r.json.list.items;
}

// Names can be re-cased by the app, so match on the run's stamp.
const has = (list, name) => list.find(i => i.name.toLowerCase() === name.toLowerCase());

async function onList(t, page, name) {
  const i = has(await items(t, page), name);
  return i && i.on_list ? i : null;
}

async function leaveAnyGroup(t, page) {
  const g = await t.api(page, "/api/group");
  if (!g.json?.enabled) throw new Error("groups are off on this site");
  if (g.json.group) await t.api(page, "/api/group/leave", {});
}

export default async function (t) {
  const { A, B, C } = t.users;
  // Plain made-up names, so the app cannot link them to a known item.
  const shared = t.stamp + "-shared";
  const later = t.stamp + "-later";
  for (const p of [A, B, C]) await leaveAnyGroup(t, p);

  try {
    // A starts the group and makes a code.
    const made = await t.api(A, "/api/group", { name: "E2E " + t.stamp.slice(-5) });
    if (made.status !== 200) throw new Error("A could not start a group: " + made.status + " " + JSON.stringify(made.json));
    const inv = await t.api(A, "/api/group/invite", {});
    const code = inv.json?.code;
    if (!code) throw new Error("no invite code: " + JSON.stringify(inv.json));

    // B joins in the app.
    await B.evaluate(() => window.__aryaShow("group-join"));
    await B.waitForSelector("#gj-code");
    await B.fill("#gj-code", code);
    await B.waitForSelector("#gj-go:not([disabled])", { timeout: 10000 });
    await B.click("#gj-go");
    await B.waitForFunction(async () => (await (await fetch("/api/group")).json()).group, null, { timeout: 10000, polling: 500 });
    const members = (await t.api(A, "/api/group")).json.group.members;
    if (members.length !== 2) throw new Error("A's group has " + members.length + " members, expected 2");

    // B watches Lists while A adds. Live sync reloads B's open app (or
    // repaints it) within seconds; either counts.
    await B.evaluate(() => window.__aryaShow("list"));
    await B.waitForSelector("#lists-home, #list-cards");
    const synced = Promise.any([
      B.waitForEvent("load", { timeout: 15000 }),
      B.waitForFunction(s => document.body.textContent.toLowerCase().includes(s), shared.toLowerCase(), { timeout: 15000 }),
    ]);
    const add = await t.api(A, "/api/list/add", { name: shared });
    if (add.status !== 200) throw new Error("A's add answered " + add.status);
    await synced.catch(() => { throw new Error("B's open app did not change within 15 s of A's add (live sync)"); });

    // B ticks it; A sees the tick.
    const item = await onList(t, B, shared);
    if (!item) throw new Error("B's list data lacks " + shared);
    await t.api(B, "/api/list/check", { item_id: item.item_id, checked: true });
    const seen = (await items(t, A)).find(i => i.item_id === item.item_id);
    if (!seen?.checked) throw new Error("A does not see B's tick");

    // C sees nothing of the group and cannot use a wrong code.
    if (has(await items(t, C), shared)) throw new Error("C (outside the group) sees the group's item");
    const wrong = await t.api(C, "/api/group/preview?code=ZZZZZZ");
    if (wrong.status !== 404) throw new Error("a wrong code answered " + wrong.status);

    // B leaves: keeps a copy, stops getting A's adds.
    await t.api(B, "/api/group/leave", {});
    if (!has(await items(t, B), shared)) throw new Error("B lost the shared item on leaving (it should keep a copy)");
    await t.api(A, "/api/list/add", { name: later });
    if (await onList(t, B, later)) throw new Error("B still gets A's adds after leaving");
  } finally {
    // Clean up: our items off every tester's list, A and B out of groups.
    for (const p of [A, B]) {
      for (const i of await items(t, p))
        if (i.name.toLowerCase().startsWith(t.stamp) && i.on_list) await t.api(p, "/api/list/remove", { item_id: i.item_id });
      await leaveAnyGroup(t, p);
    }
  }
}
