/* The in-store screen's dock: an empty list leads somewhere (add an
 * item or pick a saved list), never "decided" or Head to checkout. */
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SampleSource } from "../core/source";
import { newTrip, reduce, type Action, type Trip } from "../core/trip";
const reduceAll = (t: Trip, as: Action[]) => as.reduce(reduce, t);
import { Play } from "./Play";

const kroger = vi.hoisted(() => ({ hints: {} as Record<string, unknown> }));
vi.mock("../../lib/krogerHints", async orig => ({ ...(await orig<typeof import("../../lib/krogerHints")>()), useKrogerHints: () => kroger.hints }));
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

describe("Put back on the List sheet", () => {
  it("a Got it row and a shelf-empty row each get Put back, and it restores the item", async () => {
    const base = await open(["Milk", "Bananas", "Pasta"]);
    let trip: Trip = reduceAll(base, [{ type: "grab", key: base.items[0].key }, { type: "report", key: base.items[1].key, kind: "empty" }]);
    const src = Object.assign(new SampleSource(), { progress: vi.fn(), unreport: vi.fn() });
    const view = () => <Play trip={trip} source={src} onTrip={n => { trip = n; }} onFinish={() => {}} onQuit={() => {}} />;
    const { rerender } = render(view());
    fireEvent.click(screen.getByText(/^List ·|List · /, { selector: "button" }));
    expect(screen.getAllByText(/^(Put back|Revisit again)$/)).toHaveLength(2);
    fireEvent.click(screen.getByLabelText("Put back Milk"));
    expect(trip.got).toEqual([]);
    expect(src.progress).toHaveBeenCalledWith({ kind: "ungrab", item: "Milk", instead: undefined });
    rerender(view());
    fireEvent.click(screen.getByLabelText("Revisit Bananas"));
    expect(trip.reports).toEqual([]);
    expect(src.unreport).toHaveBeenCalledWith("Bananas");
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

  it("shows the Kroger line only after the hint arrives and never blocks the cue", async () => {
    kroger.hints = {};
    const trip = await open(["Pasta"]);
    const { rerender } = render(<Play trip={{ ...trip, here: trip.items[0].section }} source={new SampleSource()} onTrip={() => {}} onFinish={() => {}} onQuit={() => {}} />);
    await waitFor(() => expect(world.arrive).toBeTruthy());
    act(() => world.arrive!({ kind: "item", key: trip.items[0].key }));
    await screen.findByText(/Got it/);                         // the cue is up without any hint
    expect(screen.queryByText(/Kroger:/)).toBeNull();
    kroger.hints = { pasta: { aisle: "2", side: "L", bay: "10" } };
    rerender(<Play trip={{ ...trip, here: trip.items[0].section }} source={new SampleSource()} onTrip={() => {}} onFinish={() => {}} onQuit={() => {}} />);
    expect(await screen.findByText("Kroger: Aisle 2 · left side · bay 10")).toBeTruthy();
    kroger.hints = {};
  });
});

describe("Find it for me", () => {
  const box = (a: number, b: number, c: number, d: number) => [a, b, c, d] as [number, number, number, number];
  const at = async (src: SampleSource) => {
    const { layout, items } = await src.open("qfc-redmond", { id: "l", name: "L", items: [{ name: "Milk" }, { name: "Bananas" }] });
    let trip: Trip = { ...newTrip(layout, items, { seed: 1 }), here: items[0].section };
    render(<Play trip={trip} source={src} onTrip={n => { trip = n; }} onFinish={() => {}} onQuit={() => {}} />);
    await waitFor(() => expect(world.arrive).toBeTruthy());
    act(() => world.arrive!({ kind: "item", key: items[0].key }));
    fireEvent.click(await screen.findByText("Can't find it"));
    await screen.findByText("Ask a staff member");
    return { items, get trip() { return trip; } };
  };
  const shoot = async () => {
    const input = document.querySelector<HTMLInputElement>(".qg-findopt + .qg-snapfile")!;
    await act(async () => { fireEvent.change(input, { target: { files: [new File(["x"], "shelf.jpg", { type: "image/jpeg" })] } }); });
  };
  globalThis.URL.createObjectURL ||= () => "blob:x";
  globalThis.URL.revokeObjectURL ||= () => {};

  it("is the first option only when the host can scan", async () => {
    await at(new SampleSource());
    expect(screen.queryByText(/Find it for me/)).toBeNull();
  });

  it("draws SAM's boxes, lights the verified one, and Got it grabs", async () => {
    const src = Object.assign(new SampleSource(), { findIt: vi.fn(async () => ({ found: true, box: box(.6, .3, .8, .5), candidates: [box(.1, .3, .3, .5), box(.6, .3, .8, .5)] })) });
    const g = await at(src);
    const first = document.querySelector(".qg-opts")!.firstElementChild!;
    expect(first.textContent).toContain("Find it for me");
    await shoot();
    expect(src.findIt).toHaveBeenCalledWith(expect.objectContaining({ item: "Milk" }));
    expect(document.querySelectorAll(".qg-find-cand").length).toBe(2);
    expect(await screen.findByText("There it is.")).toBeTruthy();
    expect(document.querySelector(".qg-find-hit")).toBeTruthy();
    expect(document.querySelector(".qg-find-pill")!.textContent).toBe("Milk");
    fireEvent.click(screen.getByText(/^Got it \+/, { selector: ".qg-find-btn" }));
    expect(g.trip.got).toContain(g.items[0].key);
    expect(document.querySelector(".qg-find")).toBeNull();
  });

  it("a miss never says it isn't there, and offers Look again and The shelf is empty", async () => {
    const src = Object.assign(new SampleSource(), { findIt: vi.fn(async () => ({ found: false, candidates: [box(.1, .1, .2, .2)] })) });
    await at(src);
    await shoot();
    expect(await screen.findByText(/Arya didn't spot milk in this photo\. That doesn't mean it isn't here/)).toBeTruthy();
    expect(screen.getByText("Look again")).toBeTruthy();
    expect(screen.getByText("The shelf is empty", { selector: ".qg-find-btn" })).toBeTruthy();
    fireEvent.click(screen.getByText("Back", { selector: ".qg-find-btn" }));
    expect(document.querySelector(".qg-find")).toBeNull();
  });
});
