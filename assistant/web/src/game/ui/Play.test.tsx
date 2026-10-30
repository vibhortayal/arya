/* The in-store screen's dock: an empty list leads somewhere (add an
 * item or pick a saved list), never "decided" or Head to checkout. */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SampleSource } from "../core/source";
import { newTrip, type Trip } from "../core/trip";
import { Play } from "./Play";

vi.mock("../world/World3D", () => ({ World3D: () => null }));
vi.mock("../fx/juice", () => ({ Juice: class { resize() {} destroy() {} } }));

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
