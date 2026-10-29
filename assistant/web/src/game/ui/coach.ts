/* The practice coach: one short line at a time, chosen from what the
 * player is looking at (learn by doing, never a wall of text). The
 * target is where the ghost hand points after a few idle seconds. */
import { allHandled, currentStop, type Trip } from "../core/trip";
import type { QuestItem } from "../core/types";

export type Coach = { text: string; target: string | null };

export function coachFor(trip: Trip, view: "map" | "section", item: QuestItem | null, sectionView: string): Coach | null {
  if (view === "map") {
    if (allHandled(trip) || !currentStop(trip)) return { text: "That's the list! Tap Head to checkout and your shopper walks over.", target: ".qg-go" };
    if (!trip.got.length && !trip.reports.length) return { text: "This is your store. Tap Next and your shopper walks there. Follow the dots.", target: ".qg-go" };
    if (trip.scouted.length && trip.cleared.length < 3) return { text: "See how the fog lifted? Your find mapped that part of the store. Tap Next!", target: ".qg-go" };
    return { text: "Nice! Tap Next, or tap any item card in the store to walk to it.", target: ".qg-go" };
  }
  if (!item) return null;
  if (sectionView === "fog") return { text: "Fog: nobody has mapped this part. Look around. If you spot it, tap Found it here to put it on the map.", target: ".qg-got" };
  if (trip.golden === item.key) return { text: "A golden item! Each trip has one, and it's worth double.", target: ".qg-got" };
  if (!item.spot && trip.scouted.includes(item.section)) return { text: "Can't see it? Tap Not here: you can ask staff or tell other shoppers.", target: ".qg-cant" };
  if (!trip.got.length) return { text: "You're at the shelf. Nothing goes in the cart until you choose: tap Grab it once it's in your real cart.", target: ".qg-got" };
  return { text: "Grab everything in one section on one visit for a clean sweep bonus.", target: ".qg-got" };
}
