/* The practice coach: one short line at a time, chosen from what the
 * player is looking at (learn by doing, never a wall of text). The
 * target is where the ghost hand points after a few idle seconds. */
import { allHandled, currentStop, type Trip } from "../core/trip";
import type { QuestItem } from "../core/types";

export type Coach = { text: string; target: string | null };

export function coachFor(trip: Trip, view: "map" | "section", item: QuestItem | null, sectionView: string): Coach | null {
  if (view === "map") {
    if (allHandled(trip) || !currentStop(trip)) return { text: "That's the list! In a real store you'd walk to the checkout now. Tap Finish trip.", target: ".qg-go" };
    if (!trip.got.length && !trip.reports.length) return { text: "This is the store from above. The dotted line is your route. Tap Go to walk to stop 1.", target: ".qg-go" };
    if (trip.scouted.length && trip.cleared.length < 3) return { text: "See how the fog lifted? Your find mapped that aisle. Next stop!", target: ".qg-go" };
    return { text: "Nice! Follow the dots to the next stop.", target: ".qg-go" };
  }
  if (!item) return null;
  if (sectionView === "fog") return { text: "Fog: nobody has mapped this aisle. Look around. When you spot it, tap Found it to put it on the map.", target: ".qg-got" };
  if (trip.golden === item.key) return { text: "A golden item! Each trip has one, and it's worth double.", target: ".qg-got" };
  if (!item.spot && trip.scouted.includes(item.section)) return { text: "Can't see it? That happens. Tap Can't find it: telling Arya earns points too.", target: ".qg-cant" };
  if (!trip.got.length) return { text: "The glowing ring is the shelf. Put it in your cart, then tap Got it.", target: ".qg-got" };
  return { text: "Grab everything here in one visit for a clean sweep bonus.", target: ".qg-got" };
}
