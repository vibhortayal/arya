/* Quest start: a soft location check (owner, 2026-11-03). The phone's
 * position is read once, compared with the store and dropped. Nothing
 * blocks: every outcome ends in Start Quest. */
import { useState } from "react";
import { hereAt, type Here } from "../../lib/geo";
import type { StoreSummary } from "../core/types";

const NOTE: Record<Here, string> = {
  near: "You are at the store.",
  far: "You don't seem to be at this store right now. That's fine if you're planning ahead.",
  unsure: "We couldn't confirm your location. Indoor GPS is often off by a block or more.",
  denied: "Location is off for Arya, so we can't check the store.",
};

export function Locate({ store, onGo, onBack }: { store: StoreSummary; onGo: () => void; onBack: () => void }) {
  const [res, setRes] = useState<Here | "checking" | null>(null);
  const check = async () => { setRes("checking"); setRes(await hereAt(store)); };
  return (
    <section className="qg-locate" aria-label="Location check">
      <h2>Start Quest at {store.name}?</h2>
      {res === null || res === "checking" ? (
        <>
          <p>Arya can check that you are at the store. Your phone will ask for location once. Arya does not save where you are.</p>
          <button className="qg-btn primary big" disabled={res === "checking"} onClick={() => void check()}>{res === "checking" ? "Checking…" : "Check my location"}</button>
          <button className="qg-btn ghost" onClick={onGo}>Start without checking</button>
        </>
      ) : (
        <>
          <p role="status" className={res === "near" ? "qg-here ok" : "qg-here"}>{res === "near" ? "✓ " : ""}{NOTE[res]}</p>
          <button className="qg-btn primary big" onClick={onGo}>Start Quest <span aria-hidden="true">▶</span></button>
          {res !== "near" && <button className="qg-btn ghost" onClick={() => void check()}>Try again</button>}
        </>
      )}
      <button className="qg-btn ghost" onClick={onBack}>Back</button>
    </section>
  );
}
