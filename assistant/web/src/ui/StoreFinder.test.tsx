import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "../i18n";
import { StoreSearch, useStoreSearch } from "./StoreFinder";
import { ToastProvider } from "./Toast";

vi.mock("../lib/geo", () => ({
  quietGeo: vi.fn(async () => null),
  askGeo: vi.fn(async () => ({ lat: 1, lng: 2 })),
  knownGeo: () => null,
  GeoError: class extends Error {},
}));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function Host({ onPicked }: { onPicked: () => void }) {
  const search = useStoreSearch(onPicked);
  return <StoreSearch search={search} id="t-find" />;
}

test("Near me lists stores near you, with the location sent to the server", async () => {
  const urls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (u: string) => {
    urls.push(String(u));
    return new Response(JSON.stringify({ suggestions: [{ place_id: "p1", name: "Costco", secondary: "Newark, CA" }] }), { status: 200, headers: { "content-type": "application/json" } });
  }));
  render(<ToastProvider><Host onPicked={() => {}} /></ToastProvider>);
  fireEvent.click(document.querySelector("[data-near]")!);
  await waitFor(() => expect(document.querySelector("[data-pick]")).not.toBeNull());
  expect(urls.some(u => u.includes("lat=1") && u.includes("lng=2"))).toBe(true);
  expect(screen.getByText("Near you")).toBeTruthy();
});
