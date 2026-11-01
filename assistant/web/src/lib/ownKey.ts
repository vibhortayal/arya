import { del, get, put } from "./api";

/* "Use my own Meta key" (owner, 2026-11-01; mockup
 * claude.ai/artifact/H8Fn48EmPqYeEwyNeq9M62). The server keeps the key
 * encrypted and only ever answers with its last 4 characters. */
export type OwnKey = { available: boolean; set: boolean; ends?: string | null; status?: "ok" | "needs_attention" | null };

export const getOwnKey = () => get<OwnKey>("/api/account/own-key");
export const saveOwnKey = (key: string) => put<{ saved: boolean; ends: string }>("/api/account/own-key", { key });
export const removeOwnKey = () => del<{ removed: boolean }>("/api/account/own-key");

/* What the shopper typed, trimmed; the server checks it for real. */
export const looksLikeMetaKey = (k: string) => /^LLM_\S{8,}$/.test(k.trim());

/* The cap toast and Ask's card send the shopper to Settings with the
 * sheet open. The row reads this once when it mounts. */
let pending = false;
export const OPEN_OWN_KEY = "arya-open-own-key";
export function requestOwnKey() { pending = true; window.dispatchEvent(new Event(OPEN_OWN_KEY)); }
export function takeOwnKeyRequest() { const p = pending; pending = false; return p; }
export const isOwnKeyOffer = (offer?: string) => offer === "own-key" || offer === "own-key-fix";
