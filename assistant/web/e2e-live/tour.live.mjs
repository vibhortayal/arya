/* Tour: tester C (in no group; zz-signout signs C out after this) walks
 * every screen of the signed-in app: Today and each of its cards, Lists
 * (new list, typed adds, quantity, tick and untick, Clear, row ⋯ move /
 * also put on / remove, Select, list options, rename, Everything else,
 * the item page), Quest from a list up to the store and back, Ask (three
 * model calls at most), Help, every Settings row that only opens a
 * screen, the developer page and an unknown address.
 * Each step prints ok / FAIL / skip (a card the account has nothing for)
 * and the tour goes on after a failure; one error at the end lists them.
 * Never pressed: Delete account, Export, Sign out, groups, Send
 * (feedback, invites), waitlist, Google, camera, mic, photo, Map my store
 * scanning, making an agent code, Delete receipt.
 * Everything it adds is named with t.stamp and removed at the end. */
export default async function (t) {
  const C = t.users.C;
  const sid = t.stamp.slice("zz-e2e-".length);
  const mine = s => String(s || "").toLowerCase().includes(sid);
  const N = {
    list: t.stamp + "-list", other: t.stamp + "-other", renamed: t.stamp + "-renamed",
    a: t.stamp + "-apple", b: t.stamp + "-bread", c: t.stamp + "-rice", d: t.stamp + "-beans", ask: t.stamp + "-ask",
  };
  const fails = [], errs = [], added = [];
  const onErr = e => errs.push(e.message);
  C.on("pageerror", onErr);
  C.setDefaultTimeout(15000);

  /* ---- helpers ---- */
  const q = v => JSON.stringify(String(v)); // a CSS attribute value
  const loc = s => (typeof s === "string" ? C.locator(s) : s).first();
  const first = e => String((e && e.message) || e).split("\n")[0];
  async function see(s, what, ms) {
    await loc(s).waitFor({ state: "visible", timeout: ms }).catch(() => { throw new Error(what + " did not show"); });
  }
  async function leaves(s, what, ms) {
    await loc(s).waitFor({ state: "detached", timeout: ms }).catch(() => { throw new Error(what + " did not go away"); });
  }
  async function tap(s, what) {
    await loc(s).click().catch(e => { throw new Error("could not press " + what + ": " + first(e)); });
  }
  const there = async (s, ms = 2500) => loc(s).waitFor({ state: "visible", timeout: ms }).then(() => true, () => false);
  const show = (view, params) => C.evaluate(([v, p]) => window.__aryaShow(v, p), [view, params || {}]);
  async function tab(view) {
    await tap(`#tabs button[data-view="view-${view}"]`, "the " + view + " tab");
    await see(`#view-${view}`, "the " + view + " screen");
  }
  async function homeData() {
    const r = await t.api(C, "/api/home");
    if (r.status !== 200) throw new Error("/api/home answered " + r.status);
    return r.json;
  }
  const item = async id => (await homeData()).list.items.find(i => i.item_id === id);
  async function until(fn, what, ms = 10000) {
    for (const end = Date.now() + ms; ;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() > end) throw new Error(what);
      await C.waitForTimeout(400);
    }
  }
  async function app() {
    await C.goto(t.base + "/");
    await t.skipAsk(C);
    await see("#tabs", "the tab bar", 20000);
  }
  async function step(name, fn) {
    const before = errs.length;
    try {
      const skip = await fn();
      if (errs.length > before) throw new Error("page error: " + errs.slice(before).join("; "));
      console.log(typeof skip === "string" ? "skip " + name + ": " + skip : "ok   " + name);
    } catch (e) {
      fails.push(name + ": " + first(e));
      console.log("FAIL " + name + ": " + first(e));
      await C.keyboard.press("Escape").catch(() => {});
      await app().catch(() => {});
    }
  }
  const note = s => console.log("     " + s);
  // A Small Today card is one line; a tap opens it at Medium (nothing saved).
  async function openSmall(id) {
    const s = C.locator(`#today-small-${id} [data-small]`);
    if (await s.count()) await s.click();
  }
  async function listsHome() {
    await tab("list");
    if (await there("#list-page", 1500)) await tap("#list-back", "Back to lists");
    await see("#lists-home", "the Lists overview");
  }
  async function openList(id, what) {
    if (!id) throw new Error("no " + what + " to open (an earlier step failed)");
    await listsHome();
    await tap(`#list-cards [data-open-list=${q(id)}]`, what + "'s card");
    await see("#list-page", what + "'s page");
  }
  const row = id => `.listrow[data-row-id=${q(id)}]`;
  // The tour's own list page, opened again when an earlier step left it.
  async function tourList(...keys) {
    for (const k of keys) if (!ids[k]) throw new Error("the typed item " + N[k] + " is missing (an earlier step failed)");
    const title = (await there("#list-page", 500)) ? (await C.textContent("#lp-title")).toLowerCase() : "";
    if (!title.includes(N.list) && !title.includes(N.renamed)) await openList(listId, "the tour's list");
  }
  // Arya's first bubble after the newest question `text`, once it comes.
  async function answerTo(text) {
    await see(C.locator("#chat-log .bubble.me", { hasText: text }).last(), "the question in the chat");
    const a = await until(() => C.evaluate(text => {
      const all = [...document.querySelectorAll("#chat-log .bubble")];
      const i = all.map(b => b.classList.contains("me") && b.textContent.includes(text)).lastIndexOf(true);
      const b = all.slice(i + 1).find(b => b.classList.contains("arya") && !b.classList.contains("offer"));
      return i >= 0 && b ? { text: b.textContent.trim(), alert: b.getAttribute("role") === "alert" } : null;
    }, text), "no answer within 60 s", 60000);
    if (a.alert) throw new Error("Ask answered with an error: " + a.text);
    return a.text;
  }
  async function ask(text, chip) {
    if (chip) await tap(chip, "the chip");
    else {
      await C.fill("#chat-input", text);
      await tap("#chat-send", "Send");
    }
    return answerTo(text);
  }

  /* ---- what the tester had before, so the tour can put it back ---- */
  const settings0 = (await t.api(C, "/api/settings")).json || {};
  const before = new Set((await homeData()).list.items.filter(i => i.on_list).map(i => i.item_id));
  let listId = null, otherId = null, shopTouched = false;
  const ids = {};

  try {
    await step("Setup: a second list for Also put on (made in the API)", async () => {
      const r = await t.api(C, "/api/lists", { name: N.other });
      if (r.status !== 200 || !r.json?.id) throw new Error("/api/lists answered " + r.status + " " + JSON.stringify(r.json));
      otherId = r.json.id;
      await app();
    });

    /* ---------------- Today ---------------- */
    await step("Today: opens with the date line and its cards", async () => {
      await tab("home");
      await see("#today-dow:not(:empty)", "the date line", 20000);
      await see("#today-editbtn", "Today's Edit button");
      const cards = await C.$$eval("#view-home .tcard", els => els.filter(e => e.textContent.trim()).map(e => e.dataset.card));
      note("cards with something to show: " + (cards.join(", ") || "none"));
      if (await C.$("#today-getstarted")) note("the Get started card shows");
    });
    await step("Today: Running low Add puts an item on the list", async () => {
      await tab("home");
      await openSmall("low");
      const btn = C.locator("#today-low [data-low-add]").first();
      if (!(await btn.count())) return "no Running low item to add on this account";
      const id = await btn.getAttribute("data-low-add");
      await btn.click();
      await leaves(`#today-low [data-low-add=${q(id)}]`, "the Add button");
      if (!before.has(id)) added.push(id);
      await until(async () => (await item(id))?.on_list, "the item Add was pressed for is not on the list");
    });
    await step("Today: a Your lists card opens that list", async () => {
      await tab("home");
      await openSmall("lists");
      if (await there("#today-lists .listcard", 1500)) {
        await tap("#today-lists .listcard", "a Your lists card");
        await see("#view-list #list-page", "the list's page");
      } else if (await C.$("#today-emptylists")) {
        await tap("#today-emptylists", "the empty lists row");
        await see("#view-list #lists-home", "the Lists overview");
      } else return "no Your lists card on this account";
    });
    await step("Today: Use soon opens its sheet", async () => {
      await tab("home");
      await openSmall("expiry");
      if (await C.$("#today-expiry [data-ex-item]")) {
        await tap("#today-expiry [data-ex-item]", "a Use soon row");
        await see("#expiry-sheet #ex-done", "the Use soon sheet");
        await C.keyboard.press("Escape");
        await leaves("#expiry-sheet", "the Use soon sheet");
      } else if (await C.$("#perish-open")) {
        await tap("#perish-open", "the use-by row");
        await see("#perish-sheet", "the use-by sheet");
        await C.keyboard.press("Escape");
        await leaves("#perish-sheet", "the use-by sheet");
      } else return "no Use soon card on this account";
    });
    await step("Today: Still good? folds open and shut", async () => {
      await tab("home");
      await openSmall("checks");
      const fold = "#today-checks [data-checks-fold]";
      if (!(await C.$(fold))) return "nothing to check on this account";
      const was = await C.getAttribute(fold, "aria-expanded");
      await tap(fold, "Still good?");
      await until(async () => (await C.getAttribute(fold, "aria-expanded")) !== was, "Still good? did not fold");
      await tap(fold, "Still good?");
      await until(async () => (await C.getAttribute(fold, "aria-expanded")) === was, "Still good? did not fold back");
    });
    await step("Today: Spending details opens Spending", async () => {
      await tab("home");
      await openSmall("patterns");
      if (!(await C.$("#today-patterns-btn"))) return "no Spending card on this account";
      await tap("#today-patterns-btn", "Spending details");
      await see("#view-analysis", "Spending");
      await tap("#an-back", "Back");
      await see("#view-home", "Today");
    });
    await step("Today: Price watch opens Spending", async () => {
      await tab("home");
      await openSmall("watch");
      if (!(await C.$("#today-watch [data-watch]"))) return "Price watch is off or has nothing on this account";
      await tap("#today-watch [data-watch]", "a Price watch row");
      await see("#view-analysis", "Spending");
      await tap("#an-back", "Back");
      await see("#view-home", "Today");
    });
    await step("Today: Next trip opens its list", async () => {
      await tab("home");
      await openSmall("trip");
      if (!(await C.$("#today-trip-btn"))) return "Next trip is off or has nothing on this account";
      await tap("#today-trip-btn", "Next trip");
      await see("#view-list #list-page", "the list's page");
    });
    await step("Today: the Quest row opens Quest", async () => {
      await tab("home");
      if (!(await C.$("#today-quest"))) return "no Quest row on Today (it retires once Quest is opened)";
      await tap("#today-quest", "the Quest row");
      await see("#view-community .qg-home", "the Quest home", 20000);
    });
    await step("Today: store alerts and Cheaper elsewhere rows show", async () => {
      await tab("home");
      const n = await C.locator("#today-alerts .row, #today-cheaper .row").count();
      if (!n) return "no store alerts or price tips on this account";
    });
    await step("Today: Edit shows the cards and Done leaves it unchanged", async () => {
      await tab("home");
      const s0 = JSON.stringify([settings0.today_cards, settings0.today_sizes]);
      await tap("#today-editbtn", "Edit");
      await see("#today-edit", "the Edit Today list");
      if (!(await C.locator("#today-edit [data-tile], #view-home [data-add]").count())) throw new Error("Edit Today shows no cards");
      await tap("#today-editbtn", "Done");
      await leaves("#today-edit", "Edit Today");
      await see("#today-dow", "Today");
      const s = (await t.api(C, "/api/settings")).json;
      if (JSON.stringify([s.today_cards, s.today_sizes]) !== s0) throw new Error("opening Edit and pressing Done changed Today's cards");
    });

    /* ---------------- Lists ---------------- */
    await step("Lists: the overview shows the lists and New list", async () => {
      await listsHome();
      await see(`#list-cards [data-open-list=${q(otherId)}]`, "the tour's second list on the overview");
      await see("#list-new", "New list");
    });
    await step("Lists: New list makes a list and opens it", async () => {
      await listsHome();
      await tap("#list-new", "New list");
      await see("#list-sheet #ls-name", "the New list sheet");
      await C.fill("#ls-name", N.list);
      await tap('#list-sheet [data-ls="create"]', "Create list");
      await see("#list-page", "the new list's page");
      await until(async () => (await C.textContent("#lp-title")).toLowerCase().includes(N.list), "the page title is not the new list's name");
      await leaves("#list-sheet", "the New list sheet");
      const l = ((await t.api(C, "/api/lists")).json?.lists || []).find(x => x.name.toLowerCase() === N.list);
      if (!l) throw new Error("the new list is not in /api/lists");
      listId = l.id;
    });
    await step("Lists: typing four items adds them to the list", async () => {
      await openList(listId, "the tour's list");
      await C.fill("#add-text", [N.a, N.b, N.c, N.d].join(", "));
      await until(async () => (await C.locator("#add-split .spchip").count()) === 4, "the add box did not split the text into 4 items");
      await C.press("#add-text", "Enter");
      const h = await until(async () => {
        const d = await homeData();
        for (const k of ["a", "b", "c", "d"]) {
          // The app may re-case a typed name; the stamp and the word stay.
          const word = N[k].split("-").pop();
          const i = d.list.items.find(x => x.on_list && mine(x.name) && x.name.toLowerCase().endsWith(word));
          if (!i) return null;
          ids[k] = i.item_id;
        }
        return d;
      }, "not all four typed items reached the list");
      for (const k of ["a", "b", "c", "d"]) {
        if (h.list.items.find(x => x.item_id === ids[k]).list !== listId) throw new Error(N[k] + " went to another list");
        await see("#smart-list " + row(ids[k]), N[k] + "'s row");
      }
    });
    await step("Lists: the quantity button edits the amount", async () => {
      await tourList("a");
      await tap(`#smart-list [data-act="qty"][data-id=${q(ids.a)}]`, "the quantity button");
      await see(".qtyedit input[type=number]", "the quantity box");
      await C.fill(".qtyedit input[type=number]", "3");
      await C.press(".qtyedit input[type=number]", "Enter");
      await until(async () => /3/.test(await C.textContent(`#smart-list [data-act="qty"][data-id=${q(ids.a)}]`).catch(() => "")), "the row does not show the new amount");
      await until(async () => Number((await item(ids.a))?.qty) === 3, "the new amount was not saved");
    });
    await step("Lists: tick moves a row to checked off, untick brings it back", async () => {
      await tourList("a");
      await tap(`#smart-list ${row(ids.a)} [data-act="check"]`, "the tick");
      await see("#list-done .donetoggle", "the checked-off line");
      await leaves(`#smart-list ${row(ids.a)}`, "the ticked row");
      await until(async () => (await item(ids.a))?.checked, "the tick was not saved");
      if (!(await C.$(`#list-done ${row(ids.a)}`))) await tap("[data-done-toggle]", "the checked-off line");
      await tap(`#list-done ${row(ids.a)} [data-act="check"]`, "the tick in the checked-off section");
      await see(`#smart-list ${row(ids.a)}`, "the unticked row back on the list");
      await until(async () => !(await item(ids.a))?.checked, "the untick was not saved");
    });
    await step("Lists: Clear removes the checked-off items", async () => {
      await tourList("d");
      await tap(`#smart-list ${row(ids.d)} [data-act="check"]`, "the tick");
      await see("#list-done [data-done-clear]", "Clear");
      await tap("#list-done [data-done-clear]", "Clear");
      await leaves("#list-done .donetoggle", "the checked-off line");
      await until(async () => !(await item(ids.d))?.on_list, "Clear did not take the item off the list");
    });
    await step("Lists: Select picks a row and offers Move", async () => {
      await tourList("b");
      await tap("#lp-select", "Select");
      await see("#list-selbar", "the select bar");
      await tap(`#smart-list ${row(ids.b)}`, "a row");
      await until(async () => /^Move 1/.test(await C.textContent("#ls-move")), "Move does not count the picked row");
      await tap("#ls-move", "Move");
      await see("#list-sheet [data-ls-move]", "the Move sheet");
      await C.keyboard.press("Escape");
      await leaves("#list-sheet", "the Move sheet");
      if (await C.$("#list-selbar")) await tap("#lp-select", "Done");
      await leaves("#list-selbar", "the select bar");
      if ((await item(ids.b))?.list !== listId) throw new Error("only opening Move moved the item");
    });
    await step("Lists: row ⋯ Also put on adds an item to another list", async () => {
      await tourList("b");
      await tap(`#smart-list ${row(ids.b)} .morebtn`, "the row's ⋯");
      await see('#list-sheet [data-ls="row-also"]', "Also put on another list");
      await tap('#list-sheet [data-ls="row-also"]', "Also put on another list");
      await tap(`#list-sheet [data-ls-also=${q(otherId)}]`, "the tour's second list");
      await leaves("#list-sheet", "the sheet");
      await until(async () => ((await item(ids.b))?.also || []).includes(otherId), "the item is not also on the second list");
    });
    await step("Lists: row ⋯ Move sends an item to Everything else", async () => {
      await tourList("c");
      await tap(`#smart-list ${row(ids.c)} .morebtn`, "the row's ⋯");
      await tap('#list-sheet [data-ls="row-move"]', "Move to another list");
      await tap('#list-sheet [data-ls-move="else"]', "Everything else");
      await leaves("#list-sheet", "the sheet");
      await leaves(`#smart-list ${row(ids.c)}`, "the moved row");
      await until(async () => { const i = await item(ids.c); return i?.on_list && i.list !== listId; }, "the item did not move off the list");
    });
    await step("Lists: row ⋯ Remove takes an item off", async () => {
      await tourList("a");
      await tap(`#smart-list ${row(ids.a)} .morebtn`, "the row's ⋯");
      await tap('#list-sheet [data-ls="row-remove"]', "Remove");
      await leaves(`#smart-list ${row(ids.a)}`, "the removed row");
      await until(async () => !(await item(ids.a))?.on_list, "Remove did not take the item off the list");
    });
    await step("Lists: the item page opens from a row and Back returns", async () => {
      await tourList("b");
      await tap(`#smart-list ${row(ids.b)} .item-link`, "the item's name");
      await see("#view-item #item-detail .largetitle", "the item page", 20000);
      await see("#btn-add", "the item page's buttons");
      await tap("#item-back", "Back");
      await see("#list-page", "the list's page");
    });
    await step("Lists: list options opens and closes", async () => {
      await tourList();
      await tap("#lp-menu", "List options");
      for (const k of ["share", "stores", "delete"]) await see(`#list-sheet [data-ls="${k}"]`, "the " + k + " row");
      await tap('#list-sheet [data-ls="close"]', "Done");
      await leaves("#list-sheet", "List options");
    });
    await step("Lists: rename changes the list's name", async () => {
      await tourList();
      await tap("#lp-pen", "the pen");
      await see("#lp-name-input", "the name box");
      await C.fill("#lp-name-input", N.renamed);
      await C.press("#lp-name-input", "Enter");
      await until(async () => ((await C.textContent("#lp-name").catch(() => "")) || "").toLowerCase() === N.renamed, "the title does not show the new name");
      await until(async () => ((await t.api(C, "/api/lists")).json?.lists || []).some(l => l.id === listId && l.name.toLowerCase() === N.renamed), "the new name was not saved");
    });
    await step("Lists: Everything else opens with the moved item", async () => {
      await listsHome();
      await tap('#list-cards [data-open-list="else"]', "the Everything else card");
      await see("#list-page", "Everything else");
      if (!(await C.textContent("#lp-title")).includes("Everything else")) throw new Error("the title is not Everything else");
      await see("#smart-list " + row(ids.c), "the moved item");
    });
    await step("Lists: the second list shows the also-put item", async () => {
      await openList(otherId, "the tour's second list");
      await see("#smart-list " + row(ids.b), "the also-put item");
    });

    /* ---------------- Quest ---------------- */
    let openTrips = null;
    const trips = async () => {
      const r = (await t.api(C, "/api/quest/sessions")).json || {};
      return (r.sessions || []).filter(s => s.state !== "abandoned" && s.state !== "done").length;
    };
    await step("Quest: Start shopping on a list opens Quest", async () => {
      openTrips = await trips();
      await openList(listId, "the tour's list");
      if (settings0.shop_mode === "list") {
        note("this account shops with Just my list, so Quest opens from the list's address instead");
        await show("community", { listId });
      } else {
        await tap("#list-hunt", "Start shopping");
        const pick = C.locator('#shop-sheet [data-shop="quest"]');
        if (await there(pick, 3000)) {
          if (settings0.shop_mode == null) shopTouched = true;
          await pick.click();
        }
      }
      await see("#view-community .qg-home", "the Quest home", 20000);
      await see("#view-community .qg-cta", "Ready for a quest");
    });
    await step("Quest: the store picker lists stores", async () => {
      const v = C.locator("#view-community");
      await tap(v.locator(".qg-cta .qg-btn", { hasText: /real quest|Start a quest/ }).first(), "Start a quest");
      await see("#view-community .qg-pick", "Where are you shopping?");
      if (!(await there("#view-community .qg-stores .qg-store:not(.find)", 3000))) await tap("#view-community .qg-store.find", "Find another store");
      await see("#view-community .qg-stores .qg-store:not(.find)", "a store to pick", 15000);
    });
    await step("Quest: a store opens the trip, and Leave goes back home", async () => {
      await tap("#view-community .qg-stores .qg-store:not(.find)", "a store");
      await see('#view-community .qg[data-screen="play"]', "the trip", 30000);
      await until(async () => !(await C.$("#tabs")), "the tab bar stays over the trip");
      const go = C.locator("#view-community .qg-mission .qg-btn", { hasText: "Let's go" });
      if (await there(go, 10000)) await go.click();
      const drawn = await C.waitForSelector("#view-community canvas", { timeout: 20000 }).then(() => true, () => false);
      if (!(await there('[aria-label="Leave the quest"]', 5000))) {
        const text = await C.evaluate(() => (document.querySelector("#app-main")?.textContent || "").trim().length);
        throw new Error(text ? "the trip shows no Leave button" : "the store scene left a blank page with no way back" + (drawn ? "" : " (no canvas: WebGL?)"));
      }
      await tap('[aria-label="Leave the quest"]', "Leave the quest");
      await tap(C.locator("#view-community .qg-opts .qg-btn", { hasText: /^(End quest|Leave)$/ }).first(), "Leave");
      await see("#view-community .qg-home", "the Quest home");
      await see("#tabs", "the tab bar");
      if (!drawn) note("the store scene drew no canvas here (no WebGL?); Leave still worked");
      if ((await trips()) !== openTrips) throw new Error("a trip with nothing grabbed was saved");
    });
    await step("Quest: How to play opens and closes", async () => {
      await tab("community");
      await tap('#view-community [aria-label="How to play"]', "How to play");
      await see('[role=dialog][aria-label="How to play"]', "How to play");
      await tap('[role=dialog][aria-label="How to play"] .qg-x', "Close");
      await leaves('[role=dialog][aria-label="How to play"]', "How to play");
    });
    await step("Quest: Your trips opens", async () => {
      await tab("community");
      await tap(C.locator("#view-community .qg-store", { hasText: "Your trips" }).first(), "Your trips and receipts");
      await see("#view-trips .largetitle", "Your trips");
    });
    await step("Quest: Quest progress opens and Back returns", async () => {
      await tab("community");
      await tap("#qm-progress", "Quest progress");
      await see("#view-quest-progress", "Quest progress");
      await tap("#pfq-back", "Back");
      await see("#view-community .qg-home", "the Quest home");
    });
    await step("Quest: Map my store opens (no scan)", async () => {
      await tap("#qm-map-store", "Map my store");
      await see("#view-mapper h1", "Map my store");
      await tap("#view-mapper .qback", "Back");
      await leaves("#view-mapper", "Map my store");
    });
    await step("Quest: Friends opens (view only)", async () => {
      await show("friends");
      await see("#view-friends #fr-handle", "Friends");
      await see("#fr-list .row, #fr-list .empty", "the friends list", 15000);
      await tap("#view-friends .qback", "Back");
      await leaves("#view-friends", "Friends");
    });

    /* ---------------- Ask (three model calls) ---------------- */
    await step("Ask: suggestion chips and Map my store show", async () => {
      await tab("chat");
      await see("#chat-empty [data-ask]", "a suggested question");
      await see("#ask-map-store", "the Map my store chip");
    });
    await step("Ask: Edit opens and Done leaves", async () => {
      await tap("#ask-editbtn", "Edit");
      await see("#ask-edit", "Edit Ask");
      await tap("#ask-editbtn", "Done");
      await see("#chat-empty", "the suggested questions");
    });
    await step("Ask: a suggested question gets an answer", async () => {
      // The chips come from /api/home; before it answers there is one placeholder.
      await C.waitForFunction(() => document.querySelectorAll("#chat-empty [data-ask]").length > 1, null, { timeout: 5000 }).catch(() => {});
      const chips = await C.$$eval("#chat-empty [data-ask]", b => b.map(x => x.dataset.ask));
      // A question only: an "Add …" chip would put real items on the list.
      const pick = chips.find(c => /\?$/.test(c) && !/^add\b/i.test(c));
      if (pick) await ask(pick, `#chat-empty [data-ask=${q(pick)}]`);
      else await ask("What is on my list?");
    });
    await step("Ask: a plain statement acts on the list", async () => {
      await tab("chat");
      const said = await ask(`We just ran out of ${N.ask}.`);
      const got = await until(async () => (await homeData()).list.items.find(i => i.on_list && mine(i.name) && !Object.values(ids).includes(i.item_id)), "", 5000).catch(() => null);
      if (!got) throw new Error("Arya answered but nothing joined the list: " + said.slice(0, 120));
      if (!(await C.locator("#chat-log .bubble.actionchip").count())) throw new Error("the list changed but Ask shows no ✓ line for it");
    });

    /* ---------------- Help ---------------- */
    let topics = [];
    await step("Help: the ask box, sample questions and topics show", async () => {
      await tab("help");
      await see("#help-q", "the Help ask box");
      if (!(await C.locator("#view-help .help-chips button").count())) throw new Error("Help shows no sample questions");
      topics = await C.$$eval("#view-help [data-topic]", b => b.map(x => x.dataset.topic));
      if (!topics.length) throw new Error("Help lists no topics");
    });
    for (const id of topics) {
      await step(`Help: topic "${id}" shows its steps and its button opens a screen`, async () => {
        await tab("help");
        await tap(`#view-help [data-topic=${q(id)}]`, "the topic");
        await see("#help-back", "the topic");
        if (!(await C.locator("#view-help ol.steps li").count())) throw new Error("the topic has no steps");
        await see("#help-stuck", "Still stuck? Ask Arya");
        await tap("#help-open", "the topic's button");
        await leaves("#view-help", "Help");
        await until(async () => (await C.evaluate(() => (document.querySelector("#app-main .view")?.textContent || "").trim().length)) > 20, "the topic's button opened an empty screen");
      });
    }
    await step("Help: the full guide opens and closes", async () => {
      await tab("help");
      await tap("#help-guide", "Read the full guide");
      await see(".gd", "the guide");
      await tap("#gd-close", "Close");
      await leaves(".gd", "the guide");
    });
    await step("Help: the tour starts and Skip ends it", async () => {
      await tab("help");
      await tap("#help-tour", "Take the tour again");
      await see("#fr-tip-title", "the tour");
      await tap("#fr-tour-skip", "Skip");
      await leaves("#fr-tip-title", "the tour");
    });
    await step("Help: Arya's powers opens", async () => {
      await tab("help");
      await tap("#help-powers", "Arya's powers");
      await see("#view-powers #powers-body", "Arya's powers");
      await tap("#pw-back", "Back");
      await leaves("#view-powers", "Arya's powers");
    });
    await step("Help: a question asked in Help is answered in Ask", async () => {
      await tab("help");
      const text = "Where are my receipts?";
      await C.fill("#help-q", text);
      await tap("#help-ask button[type=submit]", "Ask");
      await see("#view-chat", "Ask");
      await answerTo(text);
    });

    /* ---------------- Settings ---------------- */
    await step("Settings: the profile card and account rows show", async () => {
      await tab("profile");
      await until(async () => (await C.textContent("#pf-handle")).startsWith("@"), "the profile card shows no @handle");
      if (!(await C.textContent("#profile-account")).includes("Signed in as")) throw new Error("no Signed in as row");
      for (const s of ["#btn-signout2", "#btn-del-account"]) await see(s, s); // shown, never pressed
    });
    await step("Settings: the avatar editor opens and closes", async () => {
      await tab("profile");
      await tap("#av-edit-label", "Edit avatar");
      await see("#av-panel", "the avatar editor");
      await tap("#av-edit-label", "Done");
      await C.waitForSelector("#av-panel", { state: "hidden" }).catch(() => { throw new Error("the avatar editor did not close"); });
    });
    await step("Settings: currency, language and shop mode pickers show (unchanged)", async () => {
      await tab("profile");
      const langs = await C.$$eval("#pf-language option", o => o.map(e => e.value));
      for (const l of ["auto", "en"]) if (!langs.includes(l)) throw new Error("the language picker lacks " + l + " (has " + langs + ")");
      if ((await C.inputValue("#pf-language")) !== (settings0.language || "auto")) throw new Error("the language picker does not show the saved language");
      if ((await C.locator("#pf-currency option").count()) < 2) throw new Error("the currency picker has no choices");
      await see("#pf-shopmode-select", "the shop mode picker");
    });
    await step("Settings: the group row opens Join a group (view only)", async () => {
      await tab("profile");
      await see("#pf-group:not([hidden])", "the group row");
      if (!(await C.$('[data-g="join"]'))) return "this account is in a group (group.live.mjs owns groups)";
      await tap('[data-g="join"]', "Join with a code");
      await see("#view-group-join #gj-code", "Join a group");
      await tap("#gj-back", "Back");
      await see("#view-profile", "Settings");
    });
    await step("Settings: Stores opens My stores and Find stores", async () => {
      await tab("profile");
      await tap("#pf-data-head + .group > .navrow:first-child", "Stores");
      await see("#view-stores-mine", "My stores");
      await see("#sm-list .row, #sm-list .empty", "the store list");
      await tap(C.locator("#view-stores-mine .navrow", { hasText: "Find stores" }), "Find stores");
      await see("#view-stores-find #sf-q", "Find stores");
      await see("#sf-results .row, #sf-results .empty", "store results");
      await tap("#view-stores-find .qback", "Back");
      await see("#view-stores-mine", "My stores");
      await tap("#view-stores-mine .qback", "Back");
      await see("#view-profile", "Settings");
    });
    await step("Settings: Receipts opens", async () => {
      await tab("profile");
      await tap("#btn-receipts", "Receipts");
      await see("#view-receipts #rc-archive", "Receipts");
      await see("#rc-archive .sessrow, #rc-archive .empty", "the receipt list");
    });
    await step("Settings: a receipt's detail opens and Back returns", async () => {
      if (!(await C.$("#view-receipts"))) { await tab("profile"); await tap("#btn-receipts", "Receipts"); }
      await see("#rc-archive .sessrow, #rc-archive .empty", "the receipt list");
      if (!(await C.$("#rc-archive [data-receipt]"))) return "no receipts filed on this account";
      await tap("#rc-archive [data-receipt]", "a receipt");
      await see("#view-receipt #rc-body .largetitle", "the receipt", 20000);
      if (!(await C.textContent("#rc-body")).includes("Total")) throw new Error("the receipt has no Total row");
      if (await C.$("#rc-view-btn")) {
        await tap("#rc-view-btn", "View receipt");
        await see("#rc-view-img", "the receipt photo");
        await tap("#rc-view-btn", "View receipt");
      }
      await tap("#rcd-back", "Back");
      await see("#view-receipts", "Receipts");
      await tap("#rc-back", "Back");
      await see("#view-profile", "Settings");
    });
    await step("Settings: Spending opens", async () => {
      await tab("profile");
      await tap("#btn-analysis", "Spending");
      await see("#view-analysis", "Spending");
      await see("#an-none:not([hidden]), #an-data:not([hidden])", "Spending's body");
      if (await C.isVisible("#an-data")) {
        await see("#an-spend .bignum", "the spend total");
        if (await C.$("#an-prices .infobtn")) {
          await tap("#an-prices .infobtn", "an (i) button");
          await see("#info-sheet", "the (i) sheet");
          await tap("#info-sheet [data-pw=close]", "Close");
          await leaves("#info-sheet", "the (i) sheet");
        }
      } else note("Spending shows its no-receipts card");
      await tap("#an-back", "Back");
      await see("#view-profile", "Settings");
    });
    await step("Settings: Help and guide opens the guide", async () => {
      await tab("profile");
      await tap("#btn-guide", "Help and guide");
      await see(".gd", "the guide");
      await tap("#gd-close", "Close");
      await leaves(".gd", "the guide");
    });
    for (const [btn, view, sel, back, what] of [
      ["#btn-powers", "powers", "#powers-body", "#pw-back", "Arya's powers"],
      ["#btn-display", "display", "#display-text", "#display-back", "Display"],
      ["#btn-usage", "usage", "#us-mine", "#us-back", "Usage"],
      ["#btn-feedback", "feedback", "#fb-text", "#fb-back", "Feedback (nothing sent)"],
      ["#btn-about", "about", "#view-about a[target=_blank]", "#pfa-back", "About"],
    ]) {
      await step(`Settings: ${what} opens and Back returns`, async () => {
        await tab("profile");
        await tap(btn, what);
        await see(`#view-${view} ${sel}`, what, 15000);
        await tap(back, "Back");
        await see("#view-profile", "Settings");
      });
    }
    await step("Settings: Connect an AI agent opens (no code made)", async () => {
      await tab("profile");
      await tap("#btn-muse", "Connect an AI agent");
      await see("#view-muse [data-copy-prompt]", "Connect an AI agent");
      await C.waitForSelector("#view-muse #profile-token-row", { state: "attached" }).catch(() => { throw new Error("the agent code row is missing"); });
    });
    await step("Settings: the developer page opens from Connect an AI agent", async () => {
      if (!(await C.$("#view-muse"))) { await tab("profile"); await tap("#btn-muse", "Connect an AI agent"); }
      await tap('#view-muse a[href="/developers"]', "the developer page link");
      await C.waitForURL(/\/developers\/?$/).catch(() => { throw new Error("the link did not open /developers"); });
      await see(".devsec", "the developer page");
      await app();
    });

    /* ---------------- Unknown address ---------------- */
    await step("Unknown address: answers 404 and the app comes back", async () => {
      const r = await C.goto(t.base + "/this-page-does-not-exist");
      if (r.status() !== 404) throw new Error("an unknown address answered " + r.status());
      if ((await C.textContent("body")).trim().startsWith("{")) note("the unknown address shows raw JSON (known issue)");
      await app();
      const me = await t.api(C, "/auth/me");
      if (me.status !== 200) throw new Error("the tester is not signed in after the unknown address (/auth/me " + me.status + ")");
    });
  } finally {
    await step("Clean up: the tour's items and lists are gone", async () => {
      for (const i of (await homeData()).list.items)
        if (i.on_list && (mine(i.name) || added.includes(i.item_id))) await t.api(C, "/api/list/remove", { item_id: i.item_id });
      for (const l of (await t.api(C, "/api/lists")).json?.lists || [])
        if (mine(l.name)) await t.api(C, "/api/lists/delete", { id: l.id });
      // A first Start shopping saves a shop mode; "ask" acts as none did.
      if (shopTouched) await t.api(C, "/api/settings", { shop_mode: settings0.shop_mode || "ask" });
      const left = (await homeData()).list.items.filter(i => i.on_list && (mine(i.name) || added.includes(i.item_id))).map(i => i.name);
      const lists = ((await t.api(C, "/api/lists")).json?.lists || []).filter(l => mine(l.name)).map(l => l.name);
      if (left.length || lists.length) throw new Error("still there: " + [...left, ...lists].join(", "));
      await app();
    });
    C.off("pageerror", onErr);
    C.setDefaultTimeout(30000);
  }
  if (fails.length) throw new Error(fails.length + " tour step(s) failed: " + fails.join("; "));
}
