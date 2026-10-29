import { beforeEach, describe, expect, it, vi } from "vitest";

const puts: any[] = [];
vi.mock("../../lib/api", () => ({
  get: vi.fn(async () => ({})),
  put: vi.fn(async (_url: string, body: any) => { puts.push(body.profile); return body; }),
}));

import { serverProfileStore } from "./serverProfile";
import { emptyProfile } from "../../game/core/meta";

beforeEach(() => { puts.length = 0; localStorage.clear(); });

describe("the game's profile on the server", () => {
  it("shows the whole account and saves back only the game's part", () => {
    const s = serverProfileStore("k", { profile: { ...emptyProfile(), xp: 40, weeks: ["2026-W43"], trips: 1 }, base_points: 100, weeks: ["2026-W40", "2026-W43"] });
    const shown = s.load();
    expect(shown.xp).toBe(140);
    expect(shown.weeks).toEqual(["2026-W40", "2026-W43"]);
    s.save({ ...shown, xp: 165 });
    expect(puts[0].xp).toBe(65);
    expect(s.load().xp).toBe(165);
  });

  it("carries a phone's earlier progress up once", () => {
    localStorage.setItem("k", JSON.stringify({ ...emptyProfile(), xp: 30, trips: 2, stickers: ["dairy.webp"] }));
    const s = serverProfileStore("k", { profile: null, base_points: 0, weeks: [] });
    expect(puts).toHaveLength(1);
    expect(puts[0].stickers).toEqual(["dairy.webp"]);
    expect(s.load().xp).toBe(30);
  });

  it("falls back to the phone when the server is out of reach", () => {
    const s = serverProfileStore("k", null);
    s.save({ ...emptyProfile(), xp: 5 });
    expect(puts).toHaveLength(0);
    expect(s.load().xp).toBe(5);
  });
});
