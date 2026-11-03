import { render, cleanup, waitFor, fireEvent } from "@testing-library/react";
import "../i18n";

/* Map my store page order (owner-approved mockup, 2026-11-03): after a
 * pick, the store with Change, the next step right under it, then
 * Aisles with Add an aisle in place; honest labels, never "3D". */

let mine: any[] = [];
const view = (segs: any[] = []) => ({ store: "Trader Joe's", total: segs.length, coverage_pct: null, seen: segs.length, aisles: 0, expected: null,
  counts: { mapped: 0, aging: 0, stale: 0, unmapped: 0 }, next: null, segments: segs, focus: [] });
let mapView: any = view();
vi.mock("../lib/api", async () => ({
  ...(await vi.importActual<object>("../lib/api")),
  get: async (path: string) => path.startsWith("/api/stores/mine") ? { stores: mine }
    : path.startsWith("/api/storemap") ? mapView : path.startsWith("/api/stores/search") ? { stores: [] } : {},
  post: async () => ({}),
}));
vi.mock("../app/nav", () => ({ useNav: () => ({ key: 1, back: () => {}, show: () => {}, params: {} }) }));
vi.mock("../lib/geo", () => ({ hereAt: async () => "unsure", judge: () => "unsure", quietGeo: async () => null,
  askGeo: async () => ({ lat: 0, lng: 0 }), knownGeo: () => null, GeoError: class extends Error {} }));
vi.mock("./MapScanStatus", () => ({ ScanStatus: () => null, UploadWalk: () => null }));
vi.mock("../lib/stores", async () => ({ ...(await vi.importActual<object>("../lib/stores")), storeModel: () => null, useStoreData: () => 0 }));

// Mapper keeps the chosen store across visits (module state): a fresh
// module per test.
let Mapper: any, ToastProvider: any;
beforeEach(async () => {
  vi.resetModules();
  await import("../i18n");
  Mapper = (await import("./Mapper")).Mapper;
  ToastProvider = (await import("../ui/Toast")).ToastProvider;
});
afterEach(() => cleanup());
const page = () => render(<ToastProvider><Mapper /></ToastProvider>);
const $ = (s: string) => document.querySelector(s) as HTMLElement | null;
const before = (a: string, b: string) => !!($(a)!.compareDocumentPosition($(b)!) & Node.DOCUMENT_POSITION_FOLLOWING);

test("after a pick: the store with Change, then the next step, then Aisles; no store list", async () => {
  mine = [{ id: "s1", name: "Trader Joe's", favorite: true, street: "39324 Argonaut Way", city: "Fremont", lat: 37.5, lng: -122 },
    { id: "s2", name: "Costco", city: "Newark", lat: 37.5, lng: -122 }];
  mapView = view();
  page();
  await waitFor(() => expect($("#mp-picked")).not.toBeNull());
  await waitFor(() => expect($("#mp-upload")).not.toBeNull());
  expect($("#mp-stores")).toBeNull();
  expect($("#mp-find")).toBeNull();
  expect(before("#mp-picked", "#mp-walk")).toBe(true);
  expect(before("#mp-walk", "#mp-segs")).toBe(true);
  expect(before("#mp-segs", "#mp-how")).toBe(true);
  expect($("#mp-here")!.textContent).toContain("live walk");
  expect($("#mp-check")).not.toBeNull();
  // Change brings the list and Find my store back.
  fireEvent.click($("#mp-change")!);
  expect($("#mp-stores")).not.toBeNull();
  expect($("#mp-find")).not.toBeNull();
  expect($("#mp-walk")!.textContent).toBe("");
  fireEvent.click(document.querySelector('[data-mstore="Costco"]')!);
  await waitFor(() => expect($("#mp-picked")?.textContent).toContain("Costco"));
});

test("a store with no map location: Upload only, honest text, no Check again", async () => {
  mine = [{ id: "s3", name: "Corner Market", favorite: true }];
  mapView = view();
  page();
  await waitFor(() => expect($("#mp-here")).not.toBeNull());
  expect($("#mp-here")!.textContent).toContain("Arya doesn't know where this store is");
  expect($("#mp-upload")).not.toBeNull();
  expect($("#mp-check")).toBeNull();
});

test("Aisles: Add an aisle opens the form in place; tags say what is there, never 3D", async () => {
  mine = [{ id: "s1", name: "Trader Joe's", favorite: true, lat: 1, lng: 1, aisles: 5, scene: "cloud" }];
  mapView = view();
  page();
  await waitFor(() => expect($("#mp-addrow")).not.toBeNull());
  expect($("#mp-empty")!.textContent).toContain("Nothing mapped yet");
  expect($("#mp-picked")!.textContent).toContain("5 aisles mapped");
  expect($("#mp-picked")!.textContent).toContain("Map view");
  expect(document.body.textContent).not.toMatch(/3D/i);
  fireEvent.click($("#mp-addrow")!);
  expect($("#mp-addform")).not.toBeNull();
  expect($("#mp-label")).not.toBeNull();
  expect($("#mp-more")).toBeNull();
});

test("View map follows the Map view tag: shown for scene cloud, opens the store world, hidden otherwise", async () => {
  vi.doMock("./MapperWorld", () => ({ default: ({ name }: { name: string }) => <div id="mp-world-stub">{name}</div> }));
  mine = [{ id: "s1", name: "Trader Joe's", favorite: true, lat: 1, lng: 1, scene: "cloud" }];
  mapView = view();
  page();
  await waitFor(() => expect($("#mp-viewmap")).not.toBeNull());
  expect($("#mp-viewmap")!.textContent).toContain("View map");
  fireEvent.click($("#mp-viewmap")!);
  await waitFor(() => expect($("#mp-world-stub")).not.toBeNull());
  expect($(".mp-scene")!.textContent).toContain("Trader Joe's · Map");
  fireEvent.click($("#mp-scenedone")!);
  expect($(".mp-scene")).toBeNull();
  cleanup();
  mine = [{ id: "s2", name: "Costco", favorite: true, lat: 1, lng: 1, scene: "strip" }];
  vi.resetModules();
  await import("../i18n");
  Mapper = (await import("./Mapper")).Mapper;
  ToastProvider = (await import("../ui/Toast")).ToastProvider;
  page();
  await waitFor(() => expect($("#mp-picked")).not.toBeNull());
  expect($("#mp-viewmap")).toBeNull();
});
