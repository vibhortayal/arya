import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { ToastProvider } from "../../ui/Toast";
import { ListSheet, type StoreLink } from "./ListSheets";

/* The store picker on a phone: five stores and "Show all", picks as chips
 * that can be removed, a search that filters the household's own stores. */
vi.mock("../../app/session", () => ({ useSession: () => ({ demo: false, user: "t@x.y" }), clearOnSignOut: () => {} }));

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
const NAMES = ["Trader Joe's", "Costco", "Safeway", "Whole Foods", "Target", "Walmart", "Aldi", "Lucky"];
const mine = { stores: NAMES.map((name, i) => ({ id: "s" + i, name, street: `${i} Main St`, city: "Oakland" })) };
const $$ = (s: string) => Array.from(document.querySelectorAll(s)) as HTMLElement[];

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (u: string) => json(String(u).includes("/api/stores/mine") ? mine : {})));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function open() {
  const saved: StoreLink[] = [];
  const data = { list: { items: [] }, lists: [{ id: "l-x", name: "Mine" }] };
  const actions: any = { onSaveStores: async (_id: string, link: StoreLink) => { saved.push(link); } };
  render(<ToastProvider><ListSheet sheet={{ kind: "stores" }} setSheet={() => {}} data={data as any} lens="l-x" actions={actions} /></ToastProvider>);
  await waitFor(() => expect($$("[data-ls-store]").length).toBeGreaterThan(0));
  return saved;
}

test("shows five stores and a Show all button that reveals the rest", async () => {
  await open();
  expect($$("[data-ls-store]")).toHaveLength(5);
  const all = document.getElementById("ls-showall")!;
  expect(all.textContent).toBe("Show all 8 stores");
  act(() => { fireEvent.click(all); });
  expect($$("[data-ls-store]")).toHaveLength(8);
  expect(document.getElementById("ls-showall")).toBeNull();
});

test("picked stores show as chips, even past the first five, and a chip unpicks", async () => {
  const saved = await open();
  act(() => { fireEvent.click($$("[data-ls-store]")[1]); });
  expect($$("#ls-picked .chip").map(c => c.getAttribute("data-ls-chip"))).toEqual(["Costco"]);
  act(() => { fireEvent.click(document.getElementById("ls-showall")!); });
  act(() => { fireEvent.click($$("[data-ls-store]")[7]); });
  expect($$("#ls-picked .chip").map(c => c.getAttribute("data-ls-chip"))).toEqual(["Costco", "Lucky"]);
  act(() => { fireEvent.click($$("#ls-picked .chip")[0]); });
  expect($$("#ls-picked .chip").map(c => c.getAttribute("data-ls-chip"))).toEqual(["Lucky"]);
  act(() => { fireEvent.click($$("[data-ls=savestores]")[0]); });
  await waitFor(() => expect(saved).toHaveLength(1));
  expect(saved[0]).toEqual({ stores: ["Lucky"], ids: ["s7"] });
});

test("typing in the search filters the household's own stores", async () => {
  await open();
  act(() => { fireEvent.change(document.getElementById("ls-find")!, { target: { value: "saf" } }); });
  expect($$("[data-ls-store]").map(b => b.getAttribute("data-ls-store"))).toEqual(["Safeway"]);
  expect(document.getElementById("ls-showall")).toBeNull();
});
