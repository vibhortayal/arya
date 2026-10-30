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
});
