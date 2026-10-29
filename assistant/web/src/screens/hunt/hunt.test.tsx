import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { NavProvider, useNav } from "../../app/nav";
import { ToastProvider } from "../../ui/Toast";
import { Hunt, WALK_MS, followHold, walkStart, walkStop } from "../Hunt";
import { Express } from "../Express";
import { applyLeave, applyRestore } from "./menu";
import { Q, qCurrentIndex, qNextIndex, qProgress, qRetarget, type Session } from "./model";

/* The hunt's navigation, as the plain-JS app's node harnesses ran it
 * (tests/test_hunt_nav.py DRIVER and DRIVER_ANYORDER), against the
 * React port: the one list in route order, GRAB any stop in any order,
 * put back in place, the marker tap, no automatic route into Finish,
 * the walk and the manual hold, Express rows as checks, and a
 * finished hunt opening on its Score. The browser run of the same
 * screen is web/e2e/hunt.e2e.mjs. */

vi.mock("../../app/session", () => ({ useSession: () => ({ demo: false }), clearOnSignOut: () => {} }));

type Scene = { onTapStop: ((i: number) => void) | null; glides: number; next: number };
let scene: Scene;
let posts: { url: string; body: any }[];
let sessions: Session[];
let reports: { session_id: string; item: string; item_group: string }[];
let checkGate: Promise<void> | null;
let netDown: boolean;

const mkSess = (names: string[], mode = "quest", state = "playing"): Session => ({
  id: "s1", store: "Trader Joe's", mode, state,
  items: names.map(n => ({ name: n, qty: 1, checked: false, group: "name:" + n.toLowerCase() })),
});

function stub(sess: () => Session) {
  posts = [];
  const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = init && init.body ? JSON.parse(String(init.body)) : null;
    if (netDown && init && init.method === "POST") throw new TypeError("Failed to fetch");
    if (init && init.method === "POST") posts.push({ url, body });
    const s = sess();
    if (url.endsWith("/check") && s) {
      if (checkGate) await checkGate;
      const it = s.items.find(i => i.name === body.item);
      return json({ ...s, items: s.items.map(i => (i === it ? { ...i, checked: body.checked } : i)) });
    }
    if (url.endsWith("/leave") && s) { const c = JSON.parse(JSON.stringify(s)); applyLeave(c, body.entries); return json(c); }
    if (url.endsWith("/restore") && s) { const c = JSON.parse(JSON.stringify(s)); applyRestore(c, body.item); return json(c); }
    if (url.endsWith("/withdraw-report") && s) { reports = reports.filter(r => r.item !== body.item); return json(s); }
    if (url.endsWith("/state") && s) return json({ ...s, state: body.state });
    if (url === "/api/quest/sessions") return json({ sessions });
    if (url.includes("/reports")) return json({ reports });
    return json({});
  }));
}

let nav!: ReturnType<typeof useNav>;
function Probe() { nav = useNav(); return null; }

function mount(sess: Session, View = Hunt) {
  stub(() => Q.current || sess);
  (window as any).createSceneView = () => {
    const d = { onTapStop: null, glides: 0, next: -1, setStops() {}, setNext(i: number) { d.next = i; }, glideTo() { d.glides++; }, destroy() {} };
    scene = d as unknown as Scene;
    return d;
  };
  return render(
    <ToastProvider>
      <NavProvider initial={View === Hunt ? "hunt" : "express"}>
        <Probe />
        <SetParams sess={sess} View={View} />
      </NavProvider>
    </ToastProvider>,
  );
}
/* The screen reads nav.params.session, as Mode passes it. */
function SetParams({ sess, View }: { sess: Session; View: typeof Hunt }) {
  const n = useNav();
  if (!n.params.session && (n.view === "hunt" || n.view === "express")) { n.replace(n.view, { session: sess }); return null; }
  return n.view === "hunt" || n.view === "express" ? <View /> : null;
}

const $ = (sel: string) => document.querySelector(sel) as HTMLButtonElement | null;
const checks = () => posts.filter(p => p.url.endsWith("/check")).map(p => [p.body.item, p.body.checked]);
const grab = async (i: number) => {
  const n = checks().length;
  fireEvent.click($(`[data-grab="${i}"]`)!);
  await waitFor(() => expect(checks().length).toBe(n + 1));
  await waitFor(() => expect(Q.grabbing.size).toBe(0));
};

beforeEach(() => {
  window.scrollTo = (() => {}) as typeof window.scrollTo;
  try {
    localStorage.clear();
    localStorage.setItem("arya-howto-seen", "1");
    localStorage.setItem("arya-hunt-ui", JSON.stringify({ v: 1, s: [] })); // no combo carried between tests
  } catch { /* jsdom has it */ }
  HTMLCanvasElement.prototype.getContext = (() => null) as any; // jsdom has no canvas; the confetti skips
  Q.combo = 0;
  sessions = []; reports = []; checkGate = null; netDown = false;
  Q.current = null; Q.focusIdx = -1; Q.storeReports = []; Q.followHold = false; Q.found = {}; Q.uiSid = "";
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); walkStop(); });

describe("the hunt list", () => {
  test("rows in route order; GRAB on open rows, put back on collected rows", async () => {
    const s = mkSess(["A", "B", "C", "D"]);
    s.items[0].checked = true;
    mount(s);
    await waitFor(() => expect($("#hunt-list")).not.toBeNull());
    const names = [...document.querySelectorAll("#hunt-list .huntrow .name")].map(e => e.textContent);
    expect(names).toEqual(["A", "B", "C", "D"]);
    expect($('[data-putback="0"]')).not.toBeNull();
    expect($('[data-grab="0"]')).toBeNull();
    expect($('[data-grab="1"]')).not.toBeNull();
    expect($('[data-grab="3"]')).not.toBeNull();
  });

  test("a paused hunt disables GRAB", async () => {
    mount(mkSess(["A", "B"], "quest", "paused"));
    await waitFor(() => expect($('[data-grab="1"]')).not.toBeNull());
    expect($('[data-grab="1"]')!.disabled).toBe(true);
  });
});

describe("any-order collect", () => {
  test("grab stop 4 while 1 is current: only D checks, and the hunt aims past it", async () => {
    const s = mkSess(["A", "B", "C", "D", "E"]);
    mount(s);
    await waitFor(() => expect($('[data-grab="3"]')).not.toBeNull());
    expect(qCurrentIndex(Q.current)).toBe(0);
    await grab(3);
    expect(checks()).toEqual([["D", true]]);
    const it = Q.current!.items;
    expect(it[3].checked && !it[0].checked && !it[4].checked).toBe(true);
    expect(qCurrentIndex(Q.current)).toBe(4);
    expect(Q.focusIdx).toBe(4);
    // The list offers a GRAB on every stop still open.
    for (const i of [0, 1, 2, 4]) expect($(`[data-grab="${i}"]`)).not.toBeNull();
    expect($('[data-grab="3"]')).toBeNull();
    expect($('[data-putback="3"]')).not.toBeNull();
    // The last stop wraps current to the first one left.
    await grab(4);
    expect(qCurrentIndex(Q.current)).toBe(0);
    await grab(2);
    expect(qCurrentIndex(Q.current)).toBe(0);
    await grab(0);
    expect(qCurrentIndex(Q.current)).toBe(1);
    await grab(1);
    expect(Q.current!.items.every(i => i.checked)).toBe(true);
    expect(qNextIndex(Q.current!)).toBe(-1);
    expect(qCurrentIndex(Q.current)).toBe(-1);
    // N of N: the done note, and no jump to Finish.
    await waitFor(() => expect($("#hunt-done-note")!.hidden).toBe(false));
    expect($("#hunt-pop")!.hidden).toBe(true);
    expect(nav.view).toBe("hunt");
  });

  test("sequential play with the big GRAB is unchanged", async () => {
    mount(mkSess(["A", "B", "C"]));
    await waitFor(() => expect($("#btn-collect")!.textContent).toBe("Grab · A"));
    fireEvent.click($("#btn-collect")!);
    await waitFor(() => expect($("#btn-collect")!.textContent).toBe("Grab · B"));
    fireEvent.click($("#btn-collect")!);
    await waitFor(() => expect($("#btn-collect")!.textContent).toBe("Grab · C"));
    expect(checks()).toEqual([["A", true], ["B", true]]);
  });

  test("put back: the same row, the count follows, no new walk", async () => {
    const s = mkSess(["A", "B"]);
    mount(s);
    await waitFor(() => expect($('[data-grab="0"]')).not.toBeNull());
    await grab(0);
    await grab(1);
    await waitFor(() => expect($("#hunt-count")!.textContent).toBe("2 of 2"));
    posts.length = 0;
    const glides = scene.glides;
    fireEvent.click($('[data-putback="0"]')!);
    await waitFor(() => expect(checks()).toEqual([["A", false]]));
    await waitFor(() => expect($("#hunt-count")!.textContent).toBe("1 of 2"));
    expect(qCurrentIndex(Q.current)).toBe(0);
    expect(qProgress(Q.current!).done).toBe(1);
    expect(scene.glides).toBe(glides);
    expect($('[data-grab="0"]')).not.toBeNull();
  });

  test("a marker tap presents a stop; a second tap grabs it; a checked stop is a no-op", async () => {
    mount(mkSess(["A", "B", "C", "D"]));
    await waitFor(() => expect(scene && scene.onTapStop).toBeTruthy());
    act(() => scene.onTapStop!(2));
    expect(Q.focusIdx).toBe(2);
    expect(qCurrentIndex(Q.current)).toBe(2);
    expect(checks()).toEqual([]);
    act(() => scene.onTapStop!(2));
    await waitFor(() => expect(Q.current!.items[2].checked).toBe(true));
    expect(qCurrentIndex(Q.current)).toBe(3);
    act(() => scene.onTapStop!(2));
    expect(qCurrentIndex(Q.current)).toBe(3);
    expect(checks()).toEqual([["C", true]]);
  });

  test("Express keeps first-uncollected semantics", () => {
    const es = mkSess(["X", "Y"], "express");
    Q.focusIdx = 1;
    expect(qCurrentIndex(es)).toBe(0);
    expect(qRetarget(mkSess(["A", "B"]), 1)).toBe(0);
  });
});

describe("Finish is never automatic", () => {
  test("Done with all collected opens Finish; the last GRAB does not", async () => {
    mount(mkSess(["A"]));
    await waitFor(() => expect($('[data-grab="0"]')).not.toBeNull());
    await grab(0);
    expect(nav.view).toBe("hunt");
    await waitFor(() => expect($("#btn-finish")!.textContent).toBe("Done. Add receipt"));
    fireEvent.click($("#btn-finish")!);
    await waitFor(() => expect(nav.view).toBe("finish"));
    // Back is a stack: Finish's Back returns to the live hunt.
    act(() => nav.back());
    expect(nav.view).toBe("hunt");
  });

  test("a finished or closed hunt on the rail opens its Score", async () => {
    const fin = { ...mkSess(["A"]), id: "s2", state: "finished" };
    sessions = [mkSess(["A"]), fin];
    mount(mkSess(["A"]));
    await waitFor(() => expect($('[data-rail="s2"]')).not.toBeNull());
    fireEvent.click($('[data-rail="s2"]')!);
    expect(nav.view).toBe("score");
  });

  test("Express: rows toggle in any order, all checked stays on the run", async () => {
    const es = mkSess(["X", "Y"], "express");
    mount(es, Express);
    await waitFor(() => expect($('[data-exp-check="Y"]')).not.toBeNull());
    fireEvent.click($('[data-exp-check="Y"]')!);
    await waitFor(() => expect(checks().length).toBe(1));
    fireEvent.click($('[data-exp-check="X"]')!);
    await waitFor(() => expect(checks().length).toBe(2));
    expect(checks()).toEqual([["Y", true], ["X", true]]);
    await waitFor(() => expect($('[data-exp-check="X"]')!.getAttribute("aria-pressed")).toBe("true"));
    expect(nav.view).toBe("express");
  });
});

describe("the walk (Discussion 35/36)", () => {
  test("travel, arrive, the manual hold, and leaving stops the walk", async () => {
    const old = WALK_MS.quest;
    WALK_MS.quest = 25;
    try {
      Q.current = mkSess(["A", "B"]);
      Q.followHold = false;
      walkStart(0);
      expect(Q.arrived).toBe(false);
      await new Promise(r => setTimeout(r, 70));
      expect(Q.arrived).toBe(true);
      walkStart(0);
      followHold();
      expect(Q.arrived).toBe(true);
      expect(Q.walkTimer).toBe(0);
      Q.followHold = false;
      walkStart(0);
      expect(Q.walkTimer).not.toBe(0);
      walkStop();
      expect(Q.walkTimer).toBe(0);
    } finally { WALK_MS.quest = old; }
  });

  test("the hunt screen stops the walk when it closes", async () => {
    const r = mount(mkSess(["A", "B"]));
    await waitFor(() => expect($("#hunt-list")).not.toBeNull());
    r.unmount();
    expect(Q.walkTimer).toBe(0);
  });
});

describe("How to play", () => {
  test("opens on the first Quest hunt only, and Skip remembers it", async () => {
    localStorage.removeItem("arya-howto-seen");
    mount(mkSess(["A"]));
    await waitFor(() => expect($("#howto-sheet")).not.toBeNull());
    fireEvent.click($("#howto-skip")!);
    await waitFor(() => expect($("#howto-sheet")).toBeNull());
    expect(localStorage.getItem("arya-howto-seen")).toBe("1");
    fireEvent.click($("#btn-howto")!);
    await waitFor(() => expect($("#howto-sheet")).not.toBeNull());
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect($("#howto-sheet")).toBeNull());
  });

  test("Express stays quiet", async () => {
    localStorage.removeItem("arya-howto-seen");
    mount(mkSess(["A"], "express"));
    await waitFor(() => expect($("#hunt-list")).not.toBeNull());
    expect($("#howto-sheet")).toBeNull();
  });
});

/* The hunt menu on the hunt screen (tests/test_hunt_menu.py
 * MENU_DRIVER and the screen half of QUEST_DRIVER). */
describe("the hunt menu and the row", () => {
  const sheetText = () => document.getElementById("hunt-sheet")?.textContent || "";
  const toastText = () => document.getElementById("toast")!.textContent || "";
  const ready = () => waitFor(() => expect($("#hunt-list")).not.toBeNull());

  test("Done with items open asks first; Check out leaves them in one call, then Finish", async () => {
    const s = mkSess(["A", "B", "C"]);
    s.items[1].checked = true;
    mount(s);
    await ready();
    expect($("#btn-finish")!.textContent).toBe("I'm done shopping");
    expect($("#btn-finish")!.className).toContain("secondary");
    fireEvent.click($("#btn-finish")!);
    await waitFor(() => expect(sheetText()).toContain("Leave 2 for next time?"));
    for (const t of ["Nothing is lost. Saved items come first on your next trip.", "Keep hunting", "Check out", "Next trip", "Drop"])
      expect(sheetText()).toContain(t);
    expect(sheetText().toLowerCase()).not.toContain("incomplete");
    const rows = [...document.querySelectorAll("#hunt-sheet .hm-leaverow .name")].map(e => e.textContent);
    expect(rows).toEqual(["A", "C"]);
    expect(nav.view).toBe("hunt");
    fireEvent.click($('#hunt-sheet [data-act="how"][data-k="1"][data-how="dropped"]')!);
    posts.length = 0;
    fireEvent.click($('#hunt-sheet [data-act="checkout"]')!);
    await waitFor(() => expect(nav.view).toBe("finish"));
    expect(posts.map(p => p.url.split("/").pop())).toEqual(["leave"]);
    expect(posts[0].body.entries).toEqual([{ item: "A", how: "saved" }, { item: "C", how: "dropped" }]);
    expect(Q.current!.items.length).toBe(1);
    expect(Q.current!.left!.length).toBe(2);
    expect($("#hunt-sheet")).toBeNull();
    expect(toastText()).toContain("2 left for next time.");
    expect(toastText()).toContain("Undo");
  });

  test("reported rows alone do not ask; Done then opens Finish", async () => {
    const s = mkSess(["A", "B"]);
    s.items[0].checked = true;
    reports = [{ session_id: "s1", item: "B", item_group: "name:b" }];
    mount(s);
    await waitFor(() => expect($('[data-foundit="1"]')).not.toBeNull());
    expect($("#btn-finish")!.textContent).toBe("Done. Add receipt");
    expect($("#btn-finish")!.className).toContain("primary");
    fireEvent.click($("#btn-finish")!);
    await waitFor(() => expect(nav.view).toBe("finish"));
  });

  test("the leave sheet lists reported rows too; Keep hunting changes nothing", async () => {
    reports = [{ session_id: "s1", item: "B", item_group: "name:b" }];
    mount(mkSess(["A", "B", "C"]));
    await waitFor(() => expect($('[data-foundit="1"]')).not.toBeNull());
    fireEvent.click($("#btn-finish")!);
    await waitFor(() => expect(sheetText()).toContain("Leave 3 for next time?"));
    expect(sheetText()).toContain("Reported missing");
    fireEvent.click($('#hunt-sheet [data-act="keep"]')!);
    await waitFor(() => expect($("#hunt-sheet")).toBeNull());
    expect(Q.current!.items.length).toBe(3);
  });

  test("Not here: the moved sheet first; nothing is reported until Tell", async () => {
    const s = mkSess(["A", "B"]);
    s.items[0].checked = true;
    s.items[1].shelf_label = "Aisle 4"; s.items[1].shelf_u = 0.5;
    mount(s);
    await ready();
    posts.length = 0;
    fireEvent.click($("#btn-nothere")!);
    await waitFor(() => expect(sheetText()).toContain("Can't find B?"));
    for (const t of ["Last seen: Aisle 4. Check the end caps too.", "Find it for me", "Tell other shoppers it is gone", "Keep looking"])
      expect(sheetText()).toContain(t);
    expect(posts).toEqual([]);
    fireEvent.click($('#hunt-sheet [data-act="tell"]')!);
    await waitFor(() => expect($("#spot-sheet")).not.toBeNull());
    expect($("#hunt-sheet")).toBeNull();
    expect($("#spot-item")!.textContent).toBe("At the stop for B — what do you see?");
    expect(posts).toEqual([]);
  });

  test("an unplaced stop says so; Find it for me aims the scan at it", async () => {
    mount(mkSess(["A", "B"]));
    await ready();
    fireEvent.click($('[data-more="1"]')!);
    await waitFor(() => expect($('#hunt-sheet [data-act="moved"]')).not.toBeNull());
    for (const a of ["find", "swap", "moved", "save", "drop", "edit"]) expect($(`#hunt-sheet [data-act="${a}"]`)).not.toBeNull();
    fireEvent.click($('#hunt-sheet [data-act="moved"]')!);
    await waitFor(() => expect(sheetText()).toContain("Last seen: not placed on the map yet. Check the end caps too."));
    fireEvent.click($('#hunt-sheet [data-act="find"]')!);
    await waitFor(() => expect(Q.scanTarget).toBe("B"));
  });

  test("a reported row's menu saves it for next trip or drops it, nothing else", async () => {
    reports = [{ session_id: "s1", item: "B", item_group: "name:b" }];
    mount(mkSess(["A", "B"]));
    await waitFor(() => expect($('[data-foundit="1"]')).not.toBeNull());
    fireEvent.click($('[data-more="1"]')!);
    await waitFor(() => expect($('#hunt-sheet [data-act="save"]')).not.toBeNull());
    expect($('#hunt-sheet [data-act="drop"]')).not.toBeNull();
    for (const a of ["find", "swap", "edit"]) expect($(`#hunt-sheet [data-act="${a}"]`)).toBeNull();
    expect(sheetText()).toContain("You told other shoppers it is gone.");
    expect(sheetText()).toContain("Your report stays.");
    posts.length = 0;
    fireEvent.click($('#hunt-sheet [data-act="save"]')!);
    await waitFor(() => expect(Q.current!.left!.length).toBe(1));
    expect(posts.map(p => p.url.split("/").pop())).toEqual(["leave"]);
    expect(posts[0].body.entries).toEqual([{ item: "B", how: "saved" }]);
    expect(Q.current!.items.length).toBe(1);
  });

  test("Found it after all withdraws the report, then grabs", async () => {
    reports = [{ session_id: "s1", item: "B", item_group: "name:b" }];
    mount(mkSess(["A", "B"]));
    await waitFor(() => expect($('[data-foundit="1"]')).not.toBeNull());
    const r = $('[data-foundit="1"]')!.closest(".huntrow")!;
    expect(r.querySelector("[data-grab]")).toBeNull();
    expect(r.querySelector('[data-more="1"]')).not.toBeNull();
    expect(r.textContent).toContain("Reported missing");
    posts.length = 0;
    fireEvent.click($('[data-foundit="1"]')!);
    await waitFor(() => expect(Q.current!.items[1].checked).toBe(true));
    expect(posts.map(p => p.url.split("/").pop())).toEqual(["withdraw-report", "check"]);
    expect(posts[0].body.item).toBe("B");
    expect(posts[1].body).toEqual({ item: "B", checked: true });
  });

  test("Found it after all with no signal says so calmly", async () => {
    reports = [{ session_id: "s1", item: "B", item_group: "name:b" }];
    mount(mkSess(["A", "B"]));
    await waitFor(() => expect($('[data-foundit="1"]')).not.toBeNull());
    netDown = true;
    fireEvent.click($('[data-foundit="1"]')!);
    await waitFor(() => expect(toastText()).toContain("No signal. Tap it again when you are back online."));
    expect(Q.current!.items[1].checked).toBe(false);
  });

  test("the grab toast carries Undo, which puts the item back", async () => {
    mount(mkSess(["A", "B"]));
    await ready();
    await grab(0);
    await waitFor(() => expect(toastText()).toContain("A in your cart"));
    posts.length = 0;
    fireEvent.click(document.querySelector("#toast .toastact")!);
    await waitFor(() => expect(checks()).toEqual([["A", false]]));
  });

  test("a grab announces itself (arya:grabbed) and a put back too (arya:putback)", async () => {
    const s = mkSess(["A", "B", "C"]);
    s.boss = { name: "B", group: "name:b", reports: 2 };
    mount(s);
    await ready();
    await waitFor(() => expect(scene && scene.onTapStop).toBeTruthy());
    const seen: { type: string; detail: any }[] = [];
    const on = (e: Event) => seen.push({ type: e.type, detail: (e as CustomEvent).detail });
    document.addEventListener("arya:grabbed", on);
    document.addEventListener("arya:putback", on);
    try {
      act(() => scene.onTapStop!(1));
      await grab(1);
      expect(seen[0].type).toBe("arya:grabbed");
      expect(seen[0].detail).toMatchObject({ sid: "s1", name: "B", qty: 1, group: "name:b", boss: true, idx: 1, wasSuggested: true });
      await grab(0); // the hunt aims at C now, so A is not the suggested stop
      expect(seen[1].detail).toMatchObject({ name: "A", wasSuggested: false, boss: false });
      fireEvent.click($('[data-putback="0"]')!);
      await waitFor(() => expect(seen.length).toBe(3));
      expect(seen[2].type).toBe("arya:putback");
      expect(seen[2].detail.name).toBe("A");
    } finally {
      document.removeEventListener("arya:grabbed", on);
      document.removeEventListener("arya:putback", on);
    }
  });

  test("the combo: suggested grabs add one, put back never lowers it, out of order keeps it", async () => {
    mount(mkSess(["A", "B", "C", "D"]));
    await ready();
    await waitFor(() => expect(scene && scene.onTapStop).toBeTruthy());
    fireEvent.click($("#btn-collect")!);
    await waitFor(() => expect(Q.combo).toBe(1));
    await waitFor(() => expect(Q.grabbing.size).toBe(0));
    const realNow = Date.now;
    Date.now = () => realNow() + 10 * 60 * 1000;
    try {
      fireEvent.click($("#btn-collect")!);
      await waitFor(() => expect(Q.combo).toBe(2)); // ten minutes later still counts
    } finally { Date.now = realNow; }
    await waitFor(() => expect(Q.grabbing.size).toBe(0));
    await waitFor(() => expect($("#hunt-combo")!.hidden).toBe(false));
    expect($("#hunt-combo")!.textContent).toBe("Combo x2");
    fireEvent.click($('[data-putback="1"]')!);
    await waitFor(() => expect(checks().slice(-1)).toEqual([["B", false]]));
    expect(Q.combo).toBe(2);
    act(() => scene.onTapStop!(3));
    await grab(2);
    expect(Q.combo).toBe(2);
  });

  test("a double tap posts one check and counts once", async () => {
    mount(mkSess(["A", "B"]));
    await ready();
    const evs: string[] = [];
    const on = (e: Event) => evs.push(e.type);
    document.addEventListener("arya:grabbed", on);
    let letGo!: () => void;
    checkGate = new Promise(r => { letGo = r; });
    const b = $('[data-grab="0"]')!;
    fireEvent.click(b);
    fireEvent.click(b);
    letGo(); checkGate = null;
    await waitFor(() => expect(Q.current!.items[0].checked).toBe(true));
    await waitFor(() => expect(Q.grabbing.size).toBe(0));
    document.removeEventListener("arya:grabbed", on);
    expect(checks()).toEqual([["A", true]]);
    expect(Q.combo).toBe(1);
    expect(evs).toEqual(["arya:grabbed"]);
    fireEvent.click($('[data-putback="0"]')!);
    await waitFor(() => expect($('[data-grab="0"]')).not.toBeNull());
    await grab(0);
    expect(Q.current!.items[0].checked).toBe(true);
  });

  test("row markup: quantity, note, badges, the pinned finder line", async () => {
    const s = mkSess(["Open", "Got", "Pair", "Boss", "New"]);
    s.items[1].checked = true;
    s.items[2].qty = 2; s.items[2].note = "ripe";
    s.boss = { name: "Boss", group: "name:boss", reports: 2 };
    s.items[4].added_mid_hunt = true;
    mount(s);
    await ready();
    Q.found = { Open: { line: "Spotted 2:14 pm - Aisle 3", at: "x" } };
    act(() => { Q.repaint?.(); });
    const row = (n: string) => [...document.querySelectorAll("#hunt-list .huntrow")].find(r => r.querySelector(".name")!.textContent!.startsWith(n))!;
    const open = row("Open");
    expect(open.querySelector('[data-more="0"]')!.getAttribute("aria-label")).toBe("More for Open");
    expect(open.querySelector('[data-grab="0"]')!.getAttribute("aria-label")).toBe("Grab Open");
    expect(open.querySelector("[data-putback]")).toBeNull();
    expect(open.querySelector(".findline")!.textContent).toContain("Spotted 2:14 pm - Aisle 3");
    expect(open.querySelector('[data-unfind="0"]')).not.toBeNull();
    expect(open.querySelector("img.rowface")).not.toBeNull();
    const got = row("Got");
    expect(got.querySelector('[data-putback="1"] svg')).not.toBeNull();
    expect(got.querySelector("[data-more]")).toBeNull();
    expect(got.querySelector("[data-grab]")).toBeNull();
    const pair = row("Pair");
    expect(pair.querySelector(".hqty")!.textContent).toBe("x2");
    expect(pair.querySelector('[data-grab="2"]')!.getAttribute("aria-label")).toBe("Grab x2 Pair");
    expect(pair.textContent).toContain("ripe");
    expect(row("Boss").querySelector(".hunt-badge.boss")!.textContent).toBe("Boss");
    expect(row("New").textContent).toContain("Just added");
    expect(/[←-⇿☀-➿\u{1F000}-\u{1FAFF}]/u.test($("#hunt-list")!.textContent!)).toBe(false);
    fireEvent.click($('[data-unfind="0"]')!);
    expect(row("Open").querySelector(".findline")).toBeNull();
  });

  test("an empty list with items left says Done is ready", async () => {
    const s = mkSess([]);
    s.left = [{ name: "X", qty: 1, how: "saved" }];
    mount(s);
    await ready();
    expect($("#hunt-list")!.textContent).toContain("Tap Done when you are ready.");
    expect($("#hunt-left")!.textContent).toContain("Left for next time (1)");
  });

  test("the start card names the boss; the count includes what was left", async () => {
    const s = mkSess(["A", "B", "C"], "quest", "not_started");
    s.boss = { name: "B", group: "name:b", reports: 2 };
    s.left = [{ name: "Z", qty: 1, how: "saved" }];
    mount(s);
    await ready();
    expect($("#pop-body")!.textContent).toContain("Boss item: B. Reported missing on 2 earlier trips. Find it for +40.");
    expect($("#hunt-count")!.textContent).toBe("1 of 4"); // the item left is handled
  });

  test("a cold open with items in the cart says welcome back, once", async () => {
    const s = mkSess(["A", "B", "C", "D", "E", "F", "G", "H", "I"]);
    s.id = "cold1";
    s.items[0].checked = s.items[1].checked = s.items[2].checked = true;
    const r = mount(s);
    await waitFor(() => expect(toastText()).toContain("Welcome back. 3 of 9 in your cart."));
    r.unmount();
    mount(s);
    await ready();
    expect(toastText()).not.toContain("Welcome back");
  });
});
