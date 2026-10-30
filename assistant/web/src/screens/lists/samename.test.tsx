import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { ToastProvider } from "../../ui/Toast";
import { ListSheet, type StoreLink } from "./ListSheets";

/* Two saved stores with one name (two Trader Joe's) link one at a time:
 * tapping a branch ticks that branch, not both. */
vi.mock("../../app/session", () => ({ useSession: () => ({ demo: false, user: "t@x.y" }), clearOnSignOut: () => {} }));

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
const mine = { stores: [
  { id: "s-a", name: "Trader Joe's", street: "1 Main St", city: "Chino" },
  { id: "s-b", name: "Trader Joe's", street: "9 Oak Ave", city: "Brea" },
] };
const $$ = (s: string) => Array.from(document.querySelectorAll(s)) as HTMLElement[];

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (u: string) => json(String(u).includes("/api/stores/mine") ? mine : {})));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function open(list: { stores?: string[]; store_ids?: string[] }) {
  const saved: StoreLink[] = [];
  const data = { list: { items: [] }, lists: [{ id: "l-tj", name: "Trader Joe's", ...list }] };
  const actions: any = { onSaveStores: async (_id: string, link: StoreLink) => { saved.push(link); } };
  render(<ToastProvider><ListSheet sheet={{ kind: "stores" }} setSheet={() => {}} data={data as any} lens="l-tj" actions={actions} /></ToastProvider>);
  await waitFor(() => expect($$("[data-ls-store]")).toHaveLength(2));
  return saved;
}
const pressed = () => $$("[data-ls-store]").map(b => b.getAttribute("aria-pressed"));

test("tapping one Trader Joe's ticks only that one and saves its id", async () => {
  const saved = await open({});
  expect(pressed()).toEqual(["false", "false"]);
  act(() => { fireEvent.click($$("[data-ls-store]")[1]); });
  expect(pressed()).toEqual(["false", "true"]);
  act(() => { fireEvent.click($$("[data-ls=savestores]")[0]); });
  await waitFor(() => expect(saved).toHaveLength(1));
  expect(saved[0]).toEqual({ stores: ["Trader Joe's"], ids: ["s-b"] });
});

test("a list saved with names only ticks just the first matching branch", async () => {
  await open({ stores: ["Trader Joe's"] });
  await waitFor(() => expect(pressed()).toEqual(["true", "false"]));
});

test("a saved id reopens on the same branch, and unticking keeps the other", async () => {
  await open({ stores: ["Trader Joe's"], store_ids: ["s-b"] });
  expect(pressed()).toEqual(["false", "true"]);
  act(() => { fireEvent.click($$("[data-ls-store]")[0]); });
  expect(pressed()).toEqual(["true", "true"]);
  act(() => { fireEvent.click($$("[data-ls-store]")[1]); });
  expect(pressed()).toEqual(["true", "false"]);
});
