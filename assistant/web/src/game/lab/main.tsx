/* Quest lab: the game on its own page, no sign-in, sample stores and
 * a sample list. The profile stays on this device under its own key.
 * Add ?reset to the address to start over as a new player. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SampleSource } from "../core/source";
import { localProfileStore } from "../store";
import { setAssetResolver } from "../assets";
import QuestGame from "../QuestGame";

// Bundle the pictures, so the lab works from any host (and as one file).
const files = import.meta.glob("../../../../pwa/assets/{characters,scenes}/*.webp", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const byPath: Record<string, string> = {};
for (const [k, v] of Object.entries(files)) byPath[k.replace(/^.*\/assets\//, "")] = v;
setAssetResolver(p => byPath[p] || "");

const store = localProfileStore("arya-quest-lab");
if (new URLSearchParams(location.search).has("reset")) store.reset?.();

createRoot(document.getElementById("root")!).render(
  <StrictMode><QuestGame source={new SampleSource()} store={store} /></StrictMode>,
);
