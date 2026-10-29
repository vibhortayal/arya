import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { NavProvider, useNav } from "../../app/nav";
import { ToastProvider } from "../../ui/Toast";
import { Hunt, WALK_MS, followHold, walkStart, walkStop } from "../Hunt";
import { Express } from "../Express";
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

const mkSess = (names: string[], mode = "quest", state = "playing"): Session => ({
  id: "s1", store: "Trader Joe's", mode, state,
  items: names.map(n => ({ name: n, qty: 1, checked: false, group: "name:" + n.toLowerCase() })),
});

function stub(sess: () => Session) {
  posts = [];
  const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = init && init.body ? JSON.parse(String(init.body)) : null;
    if (init && init.method === "POST") posts.push({ url, body });
    const s = sess();
    if (url.endsWith("/check") && s) {
      const it = s.items.find(i => i.name === body.item);
      return json({ ...s, items: s.items.map(i => (i === it ? { ...i, checked: body.checked } : i)) });
    }
    if (url.endsWith("/state") && s) return json({ ...s, state: body.state });
    if (url === "/api/quest/sessions") return json({ sessions });
    if (url.includes("/reports")) return json({ reports: [] });
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
  try { localStorage.clear(); localStorage.setItem("arya-howto-seen", "1"); } catch { /* jsdom has it */ }
  sessions = [];
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
