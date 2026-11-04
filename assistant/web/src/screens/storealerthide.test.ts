import { hideStoreAlert, storeAlerts } from "./Today";

/* ✕ on a store alert (owner, 2026-11-03): hidden for this account only
 * while that report is open; Undo brings it back. */
vi.mock("../app/session", () => ({ useSession: () => ({ demo: false }), clearOnSignOut: () => {} }));

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const milk = { id: "cornermarket|whole milk", store: "Corner Market", item: "Whole milk", count: 3, reported_at: "2026-11-02T10:00:00Z" };
const eggs = { id: "freshfields|egg", store: "Fresh Fields", item: "Eggs", count: 4, reported_at: "2026-11-03T10:00:00Z" };
let posts: { url: string; body: any }[] = [];
let status = 200;

beforeEach(() => {
  posts = []; status = 200;
  vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
    posts.push({ url: String(u), body: JSON.parse(String(init?.body || "{}")) });
    return status === 200 ? json({ ok: true }) : json({ detail: "That alert has already cleared." }, status);
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("store alert hide", () => {
  test("a report row carries its id and what the ✕ reads aloud; a price row has no ✕", () => {
    const gap = { A: { median: 3 }, B: { median: 4 } };
    const rows = storeAlerts({ list: { items: [{ item_id: "m", name: "Milk", on_list: true }] }, price_by_store: { m: gap } }, [milk]);
    expect(rows[0].id).toBe("cornermarket|whole milk");
    expect(rows[0].hideLabel).toBe("Hide alert: Whole milk at Corner Market");
    expect(rows[1].kind).toBe("price");
    expect(rows[1].id).toBeUndefined();
  });

  test("a branch report names its town; an older chain report does not", () => {
    const branch = { id: "@gplace-milpitas|egg", store: "Trader Joe's", store_city: "Milpitas", item: "Eggs", count: 3, reported_at: "2026-11-04T10:00:00Z" };
    const rows = storeAlerts({ list: { items: [] } }, [branch, eggs]);
    expect(rows[0].name).toBe("Eggs: out at Trader Joe's, Milpitas");
    expect(rows[0].hideLabel).toBe("Hide alert: Eggs at Trader Joe's, Milpitas");
    expect(rows[1].name).toBe("Eggs: out at Fresh Fields");
  });

  test("✕ hides the row at once, Undo puts it back", async () => {
    let shown: any[] = [milk, eggs];
    const toasts: { m: string; a?: { action: string; onAction: () => void } }[] = [];
    await hideStoreAlert(milk.id, shown, v => { shown = v; }, (m, a) => toasts.push({ m, a }), () => {});
    expect(shown).toEqual([eggs]);
    expect(posts[0]).toEqual({ url: expect.stringContaining("/api/quest/news/hide"), body: { id: milk.id } });
    expect(toasts[0].m).toBe("Alert hidden. Other shoppers still see it.");
    expect(toasts[0].a?.action).toBe("Undo");
    toasts[0].a!.onAction();
    expect(shown).toEqual([milk, eggs]);
    await vi.waitFor(() => expect(posts[1]?.url).toContain("/api/quest/news/unhide"));
  });

  test("a failed hide puts the row back and says why", async () => {
    status = 404;
    let shown: any[] = [milk];
    const errs: unknown[] = [];
    await hideStoreAlert(milk.id, shown, v => { shown = v; }, () => {}, e => errs.push(e));
    expect(shown).toEqual([milk]);
    expect(errs).toHaveLength(1);
  });
});
