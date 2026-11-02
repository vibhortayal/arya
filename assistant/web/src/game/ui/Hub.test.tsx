/* The Quest home shows cards only when they matter (owner, 2026-10-30):
 * no level or streak before a real trip, no empty sticker album, and
 * "New here?" only for a player who has never shopped. */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { emptyProfile, played } from "../core/meta";
import { Home } from "./Hub";

const noop = () => {};
const home = (profile = emptyProfile(), newbie = false) =>
  render(<Home profile={profile} newbie={newbie} list={{ id: "l", name: "Weekly", items: [{ name: "Milk" }] }} onPractice={noop} onQuest={noop} onAlbum={noop} />);

describe("Quest home", () => {
  it("a new player sees no level, streak or empty album", () => {
    const { container } = home(emptyProfile(), true);
    expect(container.querySelector(".qg-lvchip")).toBeNull();
    expect(screen.queryByText(/wk streak/)).toBeNull();
    expect(screen.queryByText("Sticker album")).toBeNull();
    expect(screen.getByText("New here? Start with practice")).toBeTruthy();
  });

  it("a player with real weeks sees their level and Ready for a quest", () => {
    const p = { ...emptyProfile(), weeks: ["2026-W40"], stickers: ["milk.webp"] };
    expect(played(p)).toBe(true);
    const { container } = home(p, false);
    expect(container.querySelector(".qg-lvchip")).not.toBeNull();
    expect(screen.getByText("Sticker album")).toBeTruthy();
    expect(screen.getByText("Ready for a quest?")).toBeTruthy();
    expect(screen.queryByText(/New here/)).toBeNull();
    expect(screen.getByText("Practice")).toBeTruthy();
  });

  it("follows the player's panel order and hidden panels, and Ready for a quest always shows", () => {
    const p = { ...emptyProfile(), weeks: ["2026-W40"], stickers: ["milk.webp"] };
    const { container } = render(<Home profile={p} newbie={false} list={{ id: "l", name: "Weekly", items: [{ name: "Milk" }] }} onPractice={noop} onQuest={noop} onAlbum={noop}
      panels={{ map: <p>Map my store</p>, trips: <p>Your trips</p> }} order={["trips", "map", "cta"]} hidden={["album", "stats", "cta"]} onEdit={noop} />);
    const text = container.textContent || "";
    expect(text.indexOf("Your trips")).toBeLessThan(text.indexOf("Map my store"));
    expect(text.indexOf("Map my store")).toBeLessThan(text.indexOf("Ready for a quest?"));
    expect(screen.queryByText("Sticker album")).toBeNull();
    expect(container.querySelector(".qg-lvchip")).toBeNull();
    expect(container.querySelector("#qg-editbtn")).not.toBeNull();
  });

  it("with no lists at all it asks for a list first, and only real lists get chips", () => {
    const p = { ...emptyProfile(), weeks: ["2026-W40"] };
    const { unmount } = render(<Home profile={p} newbie={false} list={null} lists={[]} onPractice={noop} onQuest={noop} onAlbum={noop} onAddItems={noop} />);
    expect(screen.getByText("Create a list to start a quest")).toBeTruthy();
    expect(screen.getByText("Create a list")).toBeTruthy();
    expect(screen.queryByText(/Everything/)).toBeNull();
    unmount();
    const lists = [{ id: "a", name: "Costco", items: [{ name: "Milk" }] }, { id: "b", name: "Indian Store", items: [{ name: "Dal" }] }, { id: "c", name: "Empty", items: [] }];
    render(<Home profile={p} newbie={false} list={lists[0]} lists={lists} onList={noop} onPractice={noop} onQuest={noop} onAlbum={noop} />);
    expect(screen.getAllByRole("radio").map(b => b.textContent)).toEqual(["Costco · 1", "Indian Store · 1"]);
  });
});
