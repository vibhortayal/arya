import CASES from "./menu-cases.json";
import { qComboAfter } from "./fx";
import { applyEdit, applyForgot, applyLeave, applyRestore, huntSubstitutes, submitForgot } from "./menu";
import {
  Q, QPTS, qBossStatus, qCheck, qCurrentIndex, qFlushOutbox, qHandled, qHaulPoints, qHuntUiLoad, qHuntUiSave,
  qIsReportedByMe, qNextIndex, qOutbox, qOutboxSave, qPinFound, qProgress, type Session,
} from "./model";
import { toastMs } from "../../ui/Toast";

/* The hunt's pure helpers, the offline outbox and the hunt menu's
 * mirrors of api/hunt.py, as the plain-JS app's node harnesses ran
 * them (tests/test_hunt_menu.py QUEST_DRIVER, OUTBOX_DRIVER,
 * MENU_DRIVER, MIRROR_DRIVER; tests/test_offline_hunt.py), against the
 * port. The menu sheets on the hunt screen run in hunt.test.tsx. */

vi.mock("../../app/session", () => ({ useSession: () => ({ demo: false }), clearOnSignOut: () => {} }));

const mk = (names: string[], extra: Partial<Session> = {}): Session => ({
  id: "s1", store: "TJ", mode: "quest", state: "playing",
  items: names.map(n => ({ name: n, qty: 1, checked: false, group: "name:" + n.toLowerCase() })), ...extra,
});
const rep = (sid: string, name: string) => ({ session_id: sid, item: name, item_group: "name:" + name.toLowerCase() });
const setup = (s: Session) => { Q.current = s; Q.storeReports = []; Q.focusIdx = -1; Q.combo = 0; Q.found = {}; };

/* A fetch that answers like the server: ops apply through the same mirrors. */
type Sent = [string, any];
let sent: Sent[];
let online: boolean;
let refuse: (body: any) => boolean;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
function stubServer(answer?: (op: string, body: any) => unknown) {
  sent = []; online = true; refuse = () => false;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (!online) throw new TypeError("Failed to fetch");
    const body = init && init.body ? JSON.parse(String(init.body)) : null;
    const op = url.split("/").slice(-1)[0];
    if (init && init.method === "POST") {
      if (refuse(body)) return json({ detail: "hunt is closed" }, 409);
      sent.push([op, body]);
    }
    if (answer) { const a = answer(op, body); if (a !== undefined) return json(a); }
    const c = JSON.parse(JSON.stringify(Q.current || {}));
    if (op === "check") { const it = c.items.find((i: any) => i.name === body.item); if (it) it.checked = body.checked; }
    if (op === "leave") applyLeave(c, body.entries);
    if (op === "restore") applyRestore(c, body.item);
    if (op === "edit") applyEdit(c, body.item, body.qty, body.note);
    if (op === "forgot") applyForgot(c, body.name, body.qty, body.note);
    return json(c);
  }));
}
const setOnline = (on: boolean) => Object.defineProperty(navigator, "onLine", { value: on, configurable: true });

beforeEach(() => { localStorage.clear(); setOnline(true); stubServer(); });
afterEach(() => { vi.unstubAllGlobals(); setOnline(true); });

describe("one fixture, two implementations (api/hunt.py and hunt/menu.ts)", () => {
  test.each(CASES as any[])("$id", c => {
    const sess = { items: JSON.parse(JSON.stringify(c.items)), left: JSON.parse(JSON.stringify(c.left)) } as Session;
    const a = c.args;
    const run = () => {
      if (c.op === "leave") applyLeave(sess, a.entries);
      if (c.op === "restore") applyRestore(sess, a.name);
      if (c.op === "edit") applyEdit(sess, a.name, a.qty, a.note);
      if (c.op === "forgot") applyForgot(sess, a.name, a.qty === undefined ? 1 : a.qty, a.note || "");
    };
    if (c.error) { expect(run).toThrow(); return; }
    run();
    expect(sess.items.map(i => [i.name, i.qty, !!i.checked, i.note || ""])).toEqual(c.expect.items);
    expect((sess.left || []).map(e => [e.name, e.how, e.idx])).toEqual(c.expect.left);
    if (c.expect.added) expect(sess.items.filter(i => i.added_mid_hunt).map(i => i.name)).toEqual(c.expect.added);
  });

  test("applyLeave returns what moved, with its place", () => {
    const moved = applyLeave(mk(["Eggs", "Bread"]), [{ item: "Bread", how: "dropped" }]);
    expect(moved.length).toBe(1);
    expect(moved[0].idx).toBe(1);
  });
});

describe("reported rows, progress and points", () => {
  test("a reported row is handled, not open", () => {
    const s = mk(["A", "B", "C"]); setup(s);
    Q.storeReports = [rep("s1", "A")];
    expect(qIsReportedByMe(s, s.items[0]) && !qIsReportedByMe(s, s.items[1])).toBe(true);
    expect(qIsReportedByMe(mk(["A"], { id: "other" }), s.items[0])).toBe(false);
    expect(qNextIndex(s)).toBe(1);
    expect(qCurrentIndex(s)).toBe(1);
    Q.focusIdx = 0;
    expect(qCurrentIndex(s)).toBe(1); // a stale focus on a reported row falls back
    Q.focusIdx = -1;
    s.items[1].checked = true; s.items[2].checked = true;
    expect(qNextIndex(s)).toBe(-1);
    expect(qHandled(s)).toEqual({ handled: 3, total: 3 });
  });

  test("an honest report never costs the full haul (mirrors social.hunt_points)", () => {
    let s = mk(["A", "B", "C", "D"]); setup(s);
    Q.storeReports = [rep("s1", "D")];
    s.items[0].checked = true; s.items[1].checked = true;
    expect(qProgress(s)).toEqual({ done: 2, total: 3, left: 1 });
    expect(qHaulPoints(s, false)).toBe(20);
    s.items[2].checked = true;
    expect(qProgress(s).left).toBe(0);
    expect(qHaulPoints(s, false)).toBe(3 * 10 + 25);
    expect(qHaulPoints(s, true)).toBe(3 * 10 + 25 + 50);
    Q.storeReports = [];
    expect(qHaulPoints(s, false)).toBe(30);
    s = mk(["A"]); setup(s); Q.storeReports = [rep("s1", "A")];
    expect(qProgress(s).total).toBe(0);
    expect(qHaulPoints(s, false)).toBe(0);
  });

  test("handled and total count what was left for next time", () => {
    const s = mk(["A", "B", "C", "D"]); setup(s);
    s.items[0].checked = true;
    s.left = [{ name: "X", qty: 1, how: "saved" }, { name: "Y", qty: 1, how: "dropped" }];
    Q.storeReports = [rep("s1", "B")];
    expect(qHandled(s)).toEqual({ handled: 4, total: 6 });
  });

  test("boss status and the boss points", () => {
    let s = mk(["Milk", "Eggs"]); setup(s);
    expect(qBossStatus(s)).toBe("none");
    s.boss = { name: "Milk", group: "name:milk", reports: 2 };
    expect(qBossStatus(s)).toBe("open");
    s.items[0].checked = true;
    expect(qBossStatus(s)).toBe("found");
    s.items[0].checked = false;
    s.left = [{ ...s.items.shift()!, how: "dropped", idx: 0 }];
    expect(qBossStatus(s)).toBe("left");
    s.items = [{ name: "Soy", qty: 1, checked: true, group: "name:soy" }];
    expect(qBossStatus(s)).toBe("left"); // a swapped boss is left, not found
    expect(QPTS.boss).toBe(40);
    s = mk(["Milk", "Eggs"]); s.boss = { name: "Milk", group: "name:milk", reports: 2 };
    s.items[1].checked = true;
    expect(qHaulPoints(s, false)).toBe(10);
    s.items[0].checked = true;
    expect(qHaulPoints(s, false)).toBe(2 * 10 + 25 + 40);
    expect(qHaulPoints(s, true)).toBe(2 * 10 + 25 + 40 + 50);
    s.items[0].checked = false; s.left = [{ name: "Milk", qty: 1, how: "dropped", group: "name:milk" }];
    s.items.shift();
    expect(qHaulPoints(s, false)).toBe(10 + 25);
  });

  test("the combo is a count, never a clock", () => {
    expect(qComboAfter(0, true)).toBe(1);
    expect(qComboAfter(3, false)).toBe(3);
    expect(qComboAfter(undefined as unknown as number, true)).toBe(1);
    expect(qComboAfter(5, true)).toBe(6);
  });

  test("spotted lines pin the time and the shelf", () => {
    const s = mk(["A", "B"]); setup(s); s.items[0].shelf_label = "Aisle 3, left";
    qPinFound(s.items[0], new Date(2026, 9, 28, 14, 14));
    qPinFound(s.items[1], new Date(2026, 9, 28, 9, 5));
    expect(Q.found.A.line).toBe("Spotted 2:14 pm - Aisle 3, left");
    expect(Q.found.B.line).toBe("Spotted 9:05 am");
  });

  test("hunt UI on the phone: the last six sessions, storage optional", () => {
    Q.combo = 4; Q.found = { A: { line: "x", at: "y" } };
    for (let i = 0; i < 8; i++) qHuntUiSave(mk([], { id: "sess" + i }));
    const stored = JSON.parse(localStorage.getItem("arya-hunt-ui")!);
    expect(stored.v).toBe(1);
    expect(stored.s.length).toBe(6);
    expect(stored.s[0].sid).toBe("sess7");
    expect(qHuntUiLoad("sess7").combo).toBe(4);
    expect(qHuntUiLoad("sess7").found.A.line).toBe("x");
    expect(qHuntUiLoad("nope").combo).toBe(0);
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    qHuntUiSave(mk([], { id: "mem" }));
    expect(qHuntUiLoad("mem").combo).toBe(4);
    set.mockRestore(); get.mockRestore();
  });

  test("toast duration: 60 ms a character, floors of 4 s and 7 s with an action", () => {
    expect(toastMs("hi", false)).toBe(4000);
    expect(toastMs("hi", true)).toBe(7000);
    expect(toastMs("x".repeat(100), false)).toBe(6000);
    expect(toastMs("x".repeat(200), true)).toBe(12000);
    expect(toastMs(null as unknown as string, true)).toBe(7000);
  });
});

describe("the offline outbox", () => {
  test("a grab offline applies on the phone, queues in order, and replays in order", async () => {
    const s = mk(["A", "B", "C"]); setup(s);
    online = false;
    await qCheck(s, "A", true);
    await qCheck(s, "B", true);
    await qCheck(s, "A", false);
    expect(!s.items[0].checked && s.items[1].checked).toBe(true);
    expect(qOutbox().map(o => [o.item, o.checked])).toEqual([["A", true], ["B", true], ["A", false]]);
    expect(Object.keys(qOutbox()[0])).toEqual(["sid", "item", "checked"]);
    expect(sent).toEqual([]);
    online = true;
    await qFlushOutbox();
    expect(sent.map(x => [x[1].item, x[1].checked])).toEqual([["A", true], ["B", true], ["A", false]]);
    expect(qOutbox()).toEqual([]);
  });

  test("a refusal is never queued; a refused entry in the queue is dropped and the rest syncs", async () => {
    const s = mk(["A", "C", "REFUSE"]); setup(s);
    refuse = b => b && b.item === "REFUSE";
    await expect(qCheck(s, "REFUSE", true)).rejects.toThrow();
    expect(qOutbox()).toEqual([]);
    online = false;
    await qCheck(s, "REFUSE", true);
    await qCheck(s, "C", true);
    online = true; sent.length = 0;
    await qFlushOutbox();
    expect(qOutbox()).toEqual([]);
    expect(sent.filter(x => x[0] === "check").map(x => x[1].item)).toEqual(["C"]);
  });

  test("checks and hunt ops replay in order; an unknown op is dropped; no sticker survives", async () => {
    const s = mk(["A", "B"]); setup(s);
    qOutboxSave([
      { sid: "s1", item: "A", checked: true },
      { sid: "s1", op: "leave", body: { entries: [{ item: "B", how: "saved" }] } },
      { sid: "s1", op: "forgot", body: { name: "Tea", qty: 2, note: "" } },
      { sid: "s1", op: "edit", body: { item: "Tea", qty: 3 } },
      { sid: "s1", op: "restore", body: { item: "B" } },
      { sid: "s1", op: "mystery", body: {} },
    ]);
    s.new_sticker = { name: "A" };
    await qFlushOutbox();
    expect(sent.map(x => x[0])).toEqual(["check", "leave", "forgot", "edit", "restore"]);
    expect(sent[0][1]).toEqual({ item: "A", checked: true });
    expect(sent[2][1]).toMatchObject({ name: "Tea", qty: 2 });
    expect(qOutbox()).toEqual([]);
    expect("new_sticker" in Q.current!).toBe(false);
  });

  test("offline keeps the queue; one flush at a time; a grab waits for the replay", async () => {
    const s = mk(["A", "B"]); setup(s);
    online = false;
    qOutboxSave([{ sid: "s1", op: "edit", body: { item: "A", qty: 2 } }]);
    await qFlushOutbox();
    expect(qOutbox().length).toBe(1);
    expect(sent).toEqual([]);
    online = true;
    await qFlushOutbox();
    expect(qOutbox()).toEqual([]);
    expect(sent.length).toBe(1);

    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const order: string[] = [];
    stubServer(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init!.body));
      order.push(url.split("/").slice(-1)[0] + ":" + (body.item || ""));
      await gate;
      return json({ ...Q.current });
    }));
    qOutboxSave([{ sid: "s1", item: "A", checked: true }, { sid: "s1", op: "edit", body: { item: "A", qty: 2 } }]);
    const f1 = qFlushOutbox();
    const f2 = qFlushOutbox();
    expect(f1).toBe(f2);
    const late = qCheck(s, "B", true);
    await Promise.resolve();
    expect(order.length).toBe(1);
    release();
    await f1; await late;
    expect(order).toEqual(["check:A", "edit:A", "check:B"]);
    expect(await qFlushOutbox()).toBeUndefined();
  });

  test("a refused entry fetches the hunt again; offline does not", async () => {
    const s = mk(["Zed"]); setup(s);
    let fetched = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init || !init.method) { fetched++; return json({ id: "s1", state: "playing", items: [{ name: "A", qty: 1, checked: false, group: "A" }], left: [] }); }
      return json({ detail: "no such item" }, 404);
    }));
    qOutboxSave([{ sid: "s1", op: "edit", body: { item: "Zed", qty: 2 } }]);
    await qFlushOutbox();
    expect(fetched).toBe(1);
    expect(Q.current!.items.map(i => i.name)).toEqual(["A"]);
    expect(qOutbox()).toEqual([]);
    fetched = 0;
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    qOutboxSave([{ sid: "s1", op: "edit", body: { item: "A", qty: 2 } }]);
    await qFlushOutbox();
    expect(fetched).toBe(0);
    expect(qOutbox().length).toBe(1);
  });
});

describe("Forgot something", () => {
  const toasts: [string, any][] = [];
  const toast = (m: string, o?: any) => { toasts.push([m, o]); };
  beforeEach(() => { toasts.length = 0; });

  test("parsed, added with Undo, and a merge says so", async () => {
    const s = mk(["Eggs", "Bread"]); setup(s);
    await submitForgot(toast, s, "2x tortillas");
    expect(sent).toEqual([["forgot", { name: "tortillas", qty: 2, note: "" }]]);
    expect(toasts[0][0]).toBe("tortillas added.");
    expect(toasts[0][1].action).toBe("Undo");
    await submitForgot(toast, s, "eggs");
    expect(toasts[toasts.length - 1][0]).toBe("Eggs already on the list, now x2.");
  });

  test("offline: applies on the phone, queues, and Undo cancels the queued add", async () => {
    const s = mk(["Eggs"]); setup(s);
    setOnline(false);
    await submitForgot(toast, s, "Tea");
    expect(s.items.some(i => i.name === "Tea" && i.added_mid_hunt)).toBe(true);
    expect(sent).toEqual([]);
    const q = qOutbox();
    expect(q.length).toBe(1);
    expect(q[0]).toMatchObject({ op: "forgot", sid: "s1", body: { name: "Tea" } });
    await toasts[toasts.length - 1][1].onAction();
    expect(qOutbox()).toEqual([]);
    expect(s.items.some(i => i.name === "Tea")).toBe(false);
  });

  test("online, the server's answer wins (a dictionary name can merge)", async () => {
    const s = mk(["Whole Milk 1 gal", "Bread"]); setup(s);
    stubServer((op, body) => {
      if (op !== "forgot" || body.name !== "whole milk") return undefined;
      const c = JSON.parse(JSON.stringify(Q.current));
      c.items[0].qty = 2;
      c.forgot = { result: "merged", reopened: false, prev_qty: 1, how: null, item: JSON.parse(JSON.stringify(c.items[0])) };
      return c;
    });
    await submitForgot(toast, s, "whole milk");
    expect(toasts[toasts.length - 1][0]).toBe("Whole Milk 1 gal already on the list, now x2.");
    expect("forgot" in Q.current!).toBe(false);
    expect(Q.current!.items.length).toBe(2);
    sent.length = 0;
    await toasts[toasts.length - 1][1].onAction();
    expect(sent).toEqual([["edit", { item: "Whole Milk 1 gal", qty: 1 }]]);
  });

  test("an added item that synced since: Undo removes it on the server", async () => {
    const s = mk(["Eggs"]); setup(s);
    stubServer((op, body) => (op === "remove-added" ? { ...Q.current, items: Q.current!.items.filter(i => i.name !== body.item) } : undefined));
    setOnline(false);
    await submitForgot(toast, s, "Tea");
    const undo = toasts[toasts.length - 1][1].onAction;
    expect(qOutbox().length).toBe(1);
    setOnline(true);
    await qFlushOutbox();
    sent.length = 0;
    await undo();
    expect(sent).toEqual([["remove-added", { item: "Tea" }]]);
    expect(qOutbox()).toEqual([]);
  });
});

describe("substitutes: history only, never on the hunt, this store first", () => {
  const plan: { name: string; stores?: Record<string, number> }[] = [
    { name: "Oat Milk", stores: { Costco: 3 } },
    { name: "2% Milk 1 gal", stores: { TJ: 2, Costco: 1 } },
    { name: "Whole Milk 1 gal", stores: { TJ: 9 } },
    { name: "Almond Milk", stores: { "TJ Market": 1 } },
    { name: "Soy Milk", stores: {} },
    { name: "Bananas", stores: { TJ: 20 } },
    { name: "Chocolate Milk", stores: { TJ: 4 } },
    { name: "Oat Milk", stores: { TJ: 1 } },
  ];
  test("picks", () => {
    const s = mk(["Whole Milk 1 gal", "Chocolate Milk"], { left: [{ name: "Soy Milk", qty: 1 }] });
    const subs = huntSubstitutes(s, plan, "Whole Milk 1 gal", "TJ", 3).map(x => x.name);
    expect(subs.every(n => plan.some(p => p.name === n))).toBe(true);
    for (const n of ["Chocolate Milk", "Soy Milk", "Whole Milk 1 gal", "Bananas"]) expect(subs).not.toContain(n);
    expect(subs).toEqual(["2% Milk 1 gal", "Almond Milk", "Oat Milk"]);
    expect(huntSubstitutes(s, plan, "Whole Milk 1 gal", "TJ").length).toBeLessThanOrEqual(3);
    expect(huntSubstitutes(s, [], "Whole Milk 1 gal", "TJ")).toEqual([]);
  });
});
