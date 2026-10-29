import { wantsMapStore } from "../Chat";
import { needsMap } from "../../game/QuestGame";
import { newTrip } from "../../game/core/trip";
import { buildLayout } from "../../game/core/template";

describe("Map my store is easy to reach", () => {
  it("Ask Arya opens it when asked in words", () => {
    for (const q of ["map my store", "Can you help me scan this store?", "teach Arya the aisles", "help map the shop"]) expect(wantsMapStore(q), q).toBe(true);
    for (const q of ["What's running low?", "scan my receipt from the store", "where is the map", "add eggs"]) expect(wantsMapStore(q), q).toBe(false);
  });

  it("is offered after a real trip at a store that is not fully mapped, never in practice", () => {
    const trip = (kind: "mapped" | "partial" | "simulated", practice = false) =>
      newTrip(buildLayout({ id: "s", name: "S", area: "", kind, items: [], mapped: kind === "simulated" ? [] : ["dairy"] }), [], { practice });
    expect(needsMap(trip("simulated"))).toBe(true);
    expect(needsMap(trip("partial"))).toBe(true);
    expect(needsMap(trip("mapped"))).toBe(false);
    expect(needsMap(trip("simulated", true))).toBe(false);
  });
});
