/* Port of pwa/haul.js HaulUI's shared state and data calls: the haul
 * view cache, the profile, the album's stickers for a trip, and the
 * way on from a closed hunt (afterFinish). The three haul screens
 * (reveal, rreview, haul), the Score's haul row and the share cards
 * read one copy, as the old module did. */
import { get, post } from "../../lib/api";
import { asset } from "../../lib/format";
import { faceFor, loadCharacters } from "../../lib/characters";
import { clearOnSignOut } from "../../app/session";
import type { useNav } from "../../app/nav";
import { Q, type Session } from "../hunt/model";
import { norm, type FeedPost, type Private } from "./core";

export type Nav = ReturnType<typeof useNav>;

export type HaulItem = { key: string; name: string; qty: number; boss?: boolean; source?: string; hidden?: boolean };
export type Entry = { key: string; name: string; qty: number; fix?: string | null; suggested?: boolean; from?: string; decoded?: boolean };
export type Review = { matched: Entry[]; swapped: Entry[]; on_receipt_only: Entry[]; grabbed_only: Entry[]; read: number };
export type HaulView = {
  session_id: string; state: string; settled: boolean; name: string;
  receipt: { attached: boolean; count: number } | null;
  items: HaulItem[]; review: Review;
  points: { items: number; full_haul?: number; boss?: number; receipt: number; total: number };
  boss: { name: string; found: boolean } | null;
  stats: { items: number; new?: number; level: number };
  private: Private;
  post: { posted: boolean; post_id?: string | null; audience?: string[]; taken_down?: boolean;
    reactions?: { yum: number; me_too: number; teach_me: number } };
};
export type QProfile = { handle?: string; avatar?: string; level?: number; [k: string]: unknown };
export type Sticker = { name: string; key?: string; image?: string; image_url?: string; art?: string };

export const H = {
  cache: {} as Record<string, HaulView>,   // session id -> last haul view from the server
  profile: null as QProfile | null,       // last /api/quest/profile
  burst: new Set<string>(),               // sessions whose level-up burst already played
  queuedIds: {} as Record<string, string[]>, // post id -> queued row ids this phone added
  stk: {} as Record<string, { stickers: Sticker[]; fresh: Set<string> }>,
  feed: [] as FeedPost[],
  // quest.js Q.haulPhotoURL and Q.newBadge: the Score's haul photo and
  // the badge first seen on it, for the share card.
  haulPhotoURL: null as string | null,
  newBadge: null as { id: string; name: string } | null,
};
clearOnSignOut(() => {
  H.cache = {}; H.profile = null; H.burst.clear(); H.queuedIds = {}; H.stk = {}; H.feed = [];
  if (H.haulPhotoURL) { try { URL.revokeObjectURL(H.haulPhotoURL); } catch { /* already gone */ } }
  H.haulPhotoURL = null; H.newBadge = null;
});

export const plural = (n: number, one: string, many?: string) => `${n} ${n === 1 ? one : (many || one + "s")}`;
export const art = (name: string) => faceFor(name);
export const artSrc = (file: string) => asset("assets/characters/" + file);
export const reduced = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const sid = (sess: Session) => encodeURIComponent(sess.id);

/* The character manifest, loaded once (haul.js faceReady). */
export const faceReady = () => loadCharacters();

export async function fetchHaul(sess: Session): Promise<HaulView> {
  const d = await get<HaulView>(`/api/quest/sessions/${sid(sess)}/haul`);
  H.cache[sess.id] = d;
  return d;
}
export async function loadProfile(): Promise<QProfile | null> {
  try { H.profile = await get<QProfile>("/api/quest/profile"); } catch { /* the card shows no handle */ }
  return H.profile;
}
export async function haulPost(sess: Session, path: string, body: unknown): Promise<HaulView> {
  const d = await post<HaulView>(`/api/quest/sessions/${sid(sess)}/haul${path}`, body);
  H.cache[sess.id] = d;
  return d;
}

/* The album's side of the haul (C9): the sticker art and which
 * stickers are new. Any failure gives an empty answer and the
 * screens fall back to the character art with no NEW badge. */
export async function stickersFor(sess: Session) {
  if (H.stk[sess.id]) return H.stk[sess.id];
  let stickers: Sticker[] = [], fresh = new Set<string>();
  try { stickers = (await get(`/api/quest/stickers?session=${sid(sess)}`)).stickers || []; } catch { stickers = []; }
  try {
    const r = await get(`/api/quest/stickers/new?session=${sid(sess)}`);
    for (const x of (r && r.new) || []) { const n = String((x && x.name) || "").trim().toLowerCase(); if (n) fresh.add(n); }
  } catch { fresh = new Set(); }
  return (H.stk[sess.id] = { stickers, fresh });
}
function stickerFor(stickers: Sticker[], item: HaulItem) {
  const n = String(item.name).toLowerCase();
  return stickers.find(s => String(s.name).toLowerCase() === n) ||
    stickers.find(s => s.key && norm(s.key) === item.key) || null;
}
export function tileSrc(stickers: Sticker[], item: HaulItem) {
  const st = stickerFor(stickers, item);
  if (st) return st.image === "cutout" && st.image_url ? st.image_url : artSrc(st.art || "basket.webp");
  return artSrc(art(item.name));
}

/* A receipt that Arya read at least one line of can be checked
 * again, any time, from the Score screen or the Reveal. */
export function canReview(sess: Session | null, d: HaulView | null | undefined) {
  return !!(sess && sess.receipt_id && d && d.review && d.review.read > 0);
}
export const hiddenKeys = (d: HaulView) => new Set(d.items.filter(i => i.hidden).map(i => i.key));

/* ---------- the way on from a closed hunt ---------- */
type Go = { replace?: boolean };
/* haul.js enter(): a closed hunt has no Back to the hunt. */
export function enter(nav: Nav, view: "reveal" | "rreview" | "haul", sess: Session, data?: HaulView) {
  Q.current = sess;
  nav.reset(view, data ? { session: sess, data } : { session: sess }, "community");
}
export function openScore(nav: Nav, sess: Session, go?: Go) {
  // From a closed run (Finish, or a haul screen standing in for it):
  // Back from the Score never reopens the run (haul.js enter).
  if (go && go.replace) nav.reset("score", { session: sess }, "community");
  else nav.show("score", { session: sess });
}
export function next(nav: Nav, sess: Session, go?: Go) {
  // Express stays quiet: no reveal, straight to the summary.
  return sess.mode === "express" ? openScore(nav, sess, go) : enter(nav, "reveal", sess);
}
export async function afterFinish(nav: Nav, sess: Session, go?: Go) {
  delete H.stk[sess.id];
  try {
    if (sess.state === "done" && sess.receipt_id) {
      const d = await fetchHaul(sess);
      if (d.review && d.review.read > 0) return enter(nav, "rreview", sess, d);
    }
    return next(nav, sess, go);
  } catch {
    return openScore(nav, sess, go);
  }
}

/* ---------- the share context ---------- */
export type ShareCtx = {
  sess: Session; profile?: QProfile | null; hidden?: Set<string>; title?: string; names?: string[];
  stats?: { items: number; new: number; level: number };
  haulPhotoURL?: string | null; newBadge?: { id: string; name: string } | null;
};
export function shareCtx(sess: Session): ShareCtx {
  const d = H.cache[sess.id];
  if (!d) return { sess };
  return {
    sess, profile: H.profile || undefined, hidden: hiddenKeys(d), title: d.name,
    names: d.items.map(i => i.name),
    stats: { items: d.items.filter(i => !i.hidden).length, new: d.stats.new || 0, level: d.stats.level },
  };
}
/* The share card's context: hidden stickers, Arya's name for the
 * trip, the reviewed names and the numbers. Share your haul waits for
 * the haul view; the plain hunt (every checked item) is never the
 * fallback for a closed hunt, because it would show hidden and
 * removed stickers. */
export async function shareReady(sess: Session, toast: (m: string) => void): Promise<ShareCtx | null> {
  try {
    if (!H.cache[sess.id]) await fetchHaul(sess);
    await loadProfile();
  } catch {
    toast("Could not load your haul. Check your connection. Then tap Share your haul once more.");
    return null;
  }
  return shareCtx(sess);
}

/* The e-receipt path (haul.js decodeAny): a PDF goes to /decode/pdf,
 * a picture to the photo decoder. */
export async function decodeAny(file: File): Promise<string> {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
  const r = await fetch(isPdf ? "/decode/pdf" : "/decode/photo", {
    method: "POST", headers: { "Content-Type": isPdf ? "application/pdf" : (file.type || "image/jpeg") }, body: file });
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { detail?: string }).detail || `HTTP ${r.status}`);
  return (await r.json()).receipt.receipt_id;
}
