/* The in-store screen's dock: an empty list leads somewhere (add an
 * item or pick a saved list), never "decided" or Head to checkout. */
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SampleSource } from "../core/source";
import { newTrip, type Trip } from "../core/trip";
import { Play } from "./Play";

const world = vi.hoisted(() => ({ arrive: null as null | ((g: { kind: "item"; key: string }) => void) }));
vi.mock("../world/World3D", () => ({ World3D: (p: { onArrive: (g: { kind: "item"; key: string }) => void }) => { world.arrive = p.onArrive; return null; } }));
vi.mock("../fx/juice", () => ({ Juice: class {
  constructor() { return new Proxy(this, { get: () => () => ({ x: 0, y: 0 }) }); }
} }));

const open = async (names: string[]) => {
  const { layout, items } = await new SampleSource().open("qfc-redmond", { id: "l", name: "List", items: names.map(name => ({ name })) });
  return newTrip(layout, items, { seed: 1 });
};

describe("Play dock", () => {
  it("an empty list offers add and a saved list", async () => {
    let trip: Trip = await open([]);
    const onQuit = vi.fn();
    const { rerender } = render(<Play trip={trip} source={new SampleSource()} onTrip={t => { trip = t; }} onFinish={() => {}} onQuit={onQuit} />);
    expect(screen.getByText("Your list is empty")).toBeTruthy();
    expect(screen.queryByText(/Head to checkout|decided/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Add an item"), { target: { value: "milk" } });
    fireEvent.click(screen.getByText("Add"));
    expect(trip.items.map(i => i.name)).toEqual(["Milk"]);
    rerender(<Play trip={trip} source={new SampleSource()} onTrip={t => { trip = t; }} onFinish={() => {}} onQuit={onQuit} />);
    expect(screen.queryByText("Your list is empty")).toBeNull();
  });

  it("Pick a saved list leaves for the lists", async () => {
    const onQuit = vi.fn();
    render(<Play trip={await open([])} source={new SampleSource()} onTrip={() => {}} onFinish={() => {}} onQuit={onQuit} />);
    fireEvent.click(screen.getByText("Pick a saved list"));
    expect(onQuit).toHaveBeenCalled();
  });

  it("one List button, no Route, and Map it only with a host map", async () => {
    const trip = await open(["Milk", "Bananas"]);
    const { rerender } = render(<Play trip={trip} source={new SampleSource()} onTrip={() => {}} onFinish={() => {}} onQuit={() => {}} />);
    expect(screen.queryByText("Route")).toBeNull();
    expect(screen.queryByText(/Map it/)).toBeNull();
    rerender(<Play trip={trip} source={new SampleSource()} onTrip={() => {}} onFinish={() => {}} onQuit={() => {}} onMap={() => {}} />);
    expect(trip.layout.kind).toBe("simulated");
    expect(screen.getByText(/Map it/)).toBeTruthy();
  });
});

describe("fog nudge", () => {
  const snapSource = (r: { ok: boolean; label?: string; note?: string }) => Object.assign(new SampleSource(), { snap: vi.fn(async (_e: unknown) => r) });
  /* A real trip at a store nobody mapped, standing at the first item. */
  const atShelf = async (src: SampleSource, practice = false) => {
    const { layout, items } = await src.open("qfc-redmond", { id: "l", name: "L", items: [{ name: "Milk" }, { name: "Bananas" }] });
    let trip: Trip = { ...newTrip(layout, items, { seed: 1, practice }), here: items[0].section };
    render(<Play trip={trip} source={src} onTrip={n => { trip = n; }} onFinish={() => {}} onQuit={() => {}} />);
    await waitFor(() => expect(world.arrive).toBeTruthy());
    act(() => world.arrive!({ kind: "item", key: items[0].key }));
    fireEvent.click(await screen.findByText(/Got it/));
    return { items, get trip() { return trip; } };
  };

  it("offers one small Snap after a find, and the photo puts the section on the map", async () => {
    const src = snapSource({ ok: true, label: "Dairy" });
    const g = await atShelf(src);
    expect(await screen.findByText(/Snap the shelf to put it on the map/)).toBeTruthy();
    const input = document.querySelector<HTMLInputElement>(".qg-nudge .qg-snapfile")!;
    const photo = new File(["x"], "shelf.jpg", { type: "image/jpeg" });
    await act(async () => { fireEvent.change(input, { target: { files: [photo] } }); });
    expect(src.snap).toHaveBeenCalledWith({ section: g.items[0].section, item: "Milk", photo });
    expect(await screen.findByText(/is on the map/)).toBeTruthy();
    expect(g.trip.snapped).toEqual([g.items[0].section]);
  });

  it("a refused photo says why and offers a retry", async () => {
    const src = snapSource({ ok: false, note: "Shelf photos aren't on right now, so nothing was kept." });
    await atShelf(src);
    await screen.findByText(/Snap the shelf/);
    const input = document.querySelector<HTMLInputElement>(".qg-nudge .qg-snapfile")!;
    await act(async () => { fireEvent.change(input, { target: { files: [new File(["x"], "s.jpg", { type: "image/jpeg" })] } }); });
    expect(screen.getByText(/aren't on right now/)).toBeTruthy();
    expect(screen.getByText("Retry")).toBeTruthy();
  });

  it("practice never nudges", async () => {
    await atShelf(snapSource({ ok: true }), true);
    await screen.findByText(/^List ·/);
    expect(screen.queryByText(/Snap the shelf/)).toBeNull();
  });
});
