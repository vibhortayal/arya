import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNav } from "../app/nav";
import { clearOnSignOut } from "../app/session";
import { useToast } from "../ui/Toast";
import { SceneView, type SceneDriver } from "../ui/Scene";
import { Sheet } from "../ui/Sheet";
import { Empty } from "../ui/kit";
import { get, post } from "../lib/api";
import { asset, qtyFmt, qtyTag } from "../lib/format";
import { faceFor, useCharacters } from "../lib/characters";
import { itemHasData, storeModel, storePhotos, useStoreData } from "../lib/stores";
import {
  Q, qModeLabel, QPTS, QFRESH, errMsg, qAgo, freshKey, qCheck, qClock, qCurrentIndex, qFlushOutbox, qHandled, qHaulPoints,
  qHuntUiLoad, qHuntUiSave, qIsReportedByMe, qLoadSessions, qLoadStoreReports, qNextIndex, qNoteOf, qOfflineText,
  qPinFound, qPlanUsuals, qProgress, qRetarget, qSetState, qStops, qnorm, type Fresh, type Session,
} from "./hunt/model";
import { qCelebHide, qCelebLoad, qOnCollected, qRewardGrab, QFX, setSound } from "./hunt/fx";
import { M, gyroAvailable, initMotion, stepAnchorTo, stepSync, stepsDebug, stopHuntMotion, toggleGyro, toggleSteps } from "./hunt/motion";
import { bringBack, nrm, offline, submitForgot } from "./hunt/menu";
import { StickerCard, cardOpen, stickerUndoIndex } from "./album/StickerCard";
import { HuntMenu, openItems, type MenuState } from "./hunt/HuntMenu";
import { ScanView, type Pop } from "./hunt/Scan";
import { AskSheet } from "./hunt/AskSheet";
import { useRecord } from "./hunt/useRecord";
import { t, Trans, useTranslation } from "../i18n";

/* Port of pwa/index.html #view-hunt and its sheets (Not here, How to
 * play, the hunt menu, Ask Arya, the Shelf Scan) with the hunt half of
 * pwa/quest.js (openHunt, renderHunt, collect/put back, the walk, the
 * rewards, motion, Where am I?, the scan), pwa/huntmenu.js and
 * pwa/huntask.js. Reads nav.params.session (as Mode passes it). The
 * session object is mutated in place, as the old app did, and the
 * screen repaints on Q.repaint. The hunt is a full-screen mode: the
 * tab bar, avatar and demo bar hide while it is up. */

/* ---- the navigation-first walk (quest.js qWalkStart / qFollowHold) ---- */
export const WALK_MS: Record<string, number> = { quest: 3200, express: 2000 };
export function walkStop() {
  if (Q.walkTimer) { clearTimeout(Q.walkTimer); Q.walkTimer = 0; }
  Q.walkTarget = -1;
}
export function walkStart(idx: number) {
  walkStop();
  Q.walkTarget = idx;
  Q.arrived = false;
  const sess = Q.current;
  if (!sess || idx < 0) return;
  Q.scene?.glideTo?.(idx);
  if (Q.followHold || sess.state !== "playing") { Q.arrived = true; return; }
  Q.walkTimer = window.setTimeout(() => {
    Q.walkTimer = 0;
    Q.arrived = true;
    Q.repaint?.();
  }, WALK_MS[sess.mode] || WALK_MS.quest);
}
/* Manual navigation: the walk holds, the stop presents at once. */
export function followHold() {
  Q.followHold = true;
  if (Q.walkTimer) {
    clearTimeout(Q.walkTimer);
    Q.walkTimer = 0;
    Q.arrived = true;
    Q.repaint?.();
  }
}

/* One store view, picked by the store (quest.js qResolveDriver). */
export function resolveDriver(sess: Session, peek3D: boolean): string {
  if (peek3D && storeModel(sess.store, sess.store_id)) return "cloud";
  if (storePhotos(sess.store, sess.store_id)) return "photo";
  return sess.mode === "express" ? "strip" : "art";
}

const QSCENE_CAPTION: Record<string, string> = {
  photo: "hunt.caption.photo",
  cloud: "hunt.caption.cloud",
  strip: "hunt.caption.strip",
  art: "hunt.caption.art",
};

/* "Nothing left" after a grab (quest.js qNothingLeftNote). */
function nothingLeftNote(sess: Session) {
  const p = qProgress(sess);
  return p.left === 0 && p.total === sess.items.length
    ? t("hunt.allCollectedTapDone")
    : t("hunt.nothingLeftTapDone");
}

/* ---- Teach Arya offers (pwa/mapper.js mapperOfferBriefing / mapperHuntIcon) ---- */
type Prompt = { title: string; segment?: string; est_seconds?: number; [k: string]: unknown };
const MAP_MUTE_DAYS = 7;
function mapperMuted(store: string) {
  try {
    const m = JSON.parse(localStorage.getItem("arya-map-mute") || "{}");
    return !!m[store] && Date.now() - m[store] < MAP_MUTE_DAYS * 864e5;
  } catch { return false; }
}
function mapperMute(store: string) {
  try {
    const m = JSON.parse(localStorage.getItem("arya-map-mute") || "{}");
    m[store] = Date.now();
    localStorage.setItem("arya-map-mute", JSON.stringify(m));
  } catch { /* private mode: the ask just returns next time */ }
}
async function mapperNextPrompt(store: string, items: string[]): Promise<Prompt | null> {
  try {
    const out = await get<{ prompt?: Prompt }>(`/api/storemap/next?store=${encodeURIComponent(store)}&items=${encodeURIComponent(items.join(","))}`);
    const p = out && out.prompt;
    return p && p.segment ? p : null;
  } catch { return null; }
}
let MAP_ICON: { store: string | null; prompt: Prompt | null | undefined } = { store: null, prompt: undefined };

const QHOWTO_KEY = "arya-howto-seen";
let planTried = false;
// The next account starts with no cached Teach Arya prompt and its own plan.
clearOnSignOut(() => { planTried = false; MAP_ICON = { store: null, prompt: undefined }; });

/* ---- icons (quest.js QTICK_SVG .. and the HUD buttons) ---- */
const TICK = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
const PIN = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></svg>;
const CLOSE = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>;
const PAUSE = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M9 5v14M15 5v14" /></svg>;
const PLAY = <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><path d="M8 5l11 7-11 7z" /></svg>;
const SOUND_ON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /></svg>;
const SOUND_OFF = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M16 9.5l5 5M21 9.5l-5 5" /></svg>;

/* [report kind, en.json key]. */
const SPOT_KINDS: [string, string][] = [
  ["empty_shelf", "hunt.spot.emptyShelf"],
  ["replaced", "hunt.spot.replaced"],
  ["wrong_aisle", "hunt.spot.wrongAisle"],
  ["cant_tell", "hunt.spot.cantTell"],
];

export function Hunt() {
  const { t } = useTranslation();
  const nav = useNav();
  useStoreData();
  const { toast, hide: hideToast } = useToast();
  useCharacters();
  const sess = nav.params.session as Session | undefined;

  const [, setTick] = useState(0);
  const repaint = useCallback(() => setTick(t => t + 1), []);
  const [peek3D, setPeek3D] = useState(false);
  const drv = useRef("");
  const [menu, setMenu] = useState<MenuState>(null);
  const [spot, setSpot] = useState<{ idx: number; busy: boolean; pressed: string | null } | null>(null);
  const [howto, setHowto] = useState(false);
  const [ask, setAsk] = useState(false);
  const [scan, setScan] = useState<{ target: string | null } | null>(null);
  const [wildOpen, setWildOpen] = useState(false);
  const [wildName, setWildName] = useState("");
  const [addText, setAddText] = useState("");
  const [leftOpen, setLeftOpen] = useState(false);
  const [brief, setBrief] = useState<Prompt | null>(null);
  const [teach, setTeach] = useState<Prompt | null>(null);
  const [, setFreshTick] = useState(0);
  const timerEl = useRef<HTMLSpanElement>(null);
  const timer = useRef(0);
  const popRef = useRef<HTMLDivElement>(null);
  const popH = useRef(0);
  const wildRef = useRef<HTMLInputElement>(null);
  const wildRec = useRecord(t => setWildName(t));
  const addRec = useRecord(t => setAddText(t));

  /* The hunt clock (kept hidden on the Quest HUD, as before). */
  const startTimer = (s: Session) => {
    clearInterval(timer.current);
    const paint = () => {
      const el = timerEl.current;
      if (!el || !s.started_at) return;
      const end = s.finished_at ? new Date(s.finished_at).getTime() : Date.now();
      el.textContent = qClock(end - new Date(s.started_at).getTime());
    };
    paint();
    timer.current = window.setInterval(paint, 1000);
  };

  /* openHunt: once per mount (a rail switch re-mounts the screen). */
  useEffect(() => {
    if (!sess) return;
    Q.current = sess;
    Q.repaint = repaint;
    Q.notify = toast;
    qCelebLoad();
    const cold = Q.uiSid !== sess.id;
    if (cold) {
      const ui = qHuntUiLoad(sess.id);
      Q.combo = ui.combo;
      Q.found = ui.found;
      Q.uiSid = sess.id;
    }
    nav.setChrome(false);
    document.body.classList.add("hunting");
    const view = document.getElementById("view-hunt");
    view?.classList.add("full");
    Q.followHold = false;
    Q.focusIdx = -1;
    Q.scanTarget = null;
    drv.current = resolveDriver(sess, false);
    startTimer(sess);
    initMotion(document.getElementById("scene-mount"), repaint).then(repaint);
    walkStart(qCurrentIndex(sess));
    qLoadStoreReports(sess.store).then(() => { if (Q.current === sess) repaint(); });
    qFlushOutbox();
    if (sess.mode === "quest") {
      let seen = false;
      try { seen = localStorage.getItem(QHOWTO_KEY) === "1"; } catch { /* not seen */ }
      if (!seen) setHowto(true);
    }
    if (cold) {
      const p = qProgress(sess);
      if (p.done > 0) toast(t("hunt.welcomeBack", { done: p.done, total: p.total }));
    }
    qLoadSessions().then(() => { if (Q.current === sess) repaint(); }).catch(() => {});

    // A touch on the scene is manual navigation (the seated fallback).
    const mount = document.getElementById("scene-mount");
    const onDown = () => { followHold(); M.stepsHold = true; };
    mount?.addEventListener("pointerdown", onDown);
    // The outbox flushes on "online" from hunt/model, whatever is up.
    window.addEventListener("offline", repaint);
    return () => {
      mount?.removeEventListener("pointerdown", onDown);
      window.removeEventListener("offline", repaint);
      clearInterval(timer.current);
      walkStop();
      stopHuntMotion();
      qCelebHide();
      Q.scanTarget = null;
      if (Q.repaint === repaint) { Q.repaint = null; Q.notify = null; }
      Q.scene = null;
      document.body.classList.remove("hunting");
      view?.classList.remove("full");
      nav.setChrome(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* huntAfterRender: the plan (for the usual chips) loads once, and the
   * combo and finder lines save on the phone when they change. */
  const foundSig = JSON.stringify(Q.found);
  useEffect(() => {
    if (!sess) return;
    try { qHuntUiSave(sess); } catch { /* the hunt works without storage */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sess, Q.combo, foundSig, sess?.state]);
  useEffect(() => {
    if (!sess) return;
    stepSync(true);
    if (!Q.plan && !planTried && !offline()) {
      planTried = true;
      get("/api/quest/plan").then(p => { if (p && !Q.plan) { Q.plan = p; if (Q.current === sess) repaint(); } }).catch(() => {});
    }
  });

  const state = sess?.state || "";
  const store = sess?.store || "";
  const storeId = sess?.store_id || null;
  const isQuest = sess?.mode === "quest";

  /* The briefing card (before the start) and the Teach Arya tool. */
  useEffect(() => {
    if (!sess || state !== "not_started" || sess.mode === "express" || mapperMuted(store)) return;
    let hunted = false;
    try { hunted = !!localStorage.getItem("arya-hunted"); } catch { /* first hunt */ }
    if (!hunted) return;
    let live = true;
    mapperNextPrompt(store, sess.items.map(i => i.name).slice(0, 30)).then(p => { if (live && p) setBrief(p); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, store]);
  useEffect(() => {
    if (!sess) return;
    const liveHunt = state === "playing" && sess.mode !== "express" && !mapperMuted(store);
    if (!liveHunt) { setTeach(null); return; }
    if (MAP_ICON.store !== store) MAP_ICON = { store, prompt: undefined };
    if (MAP_ICON.prompt !== undefined) { setTeach(MAP_ICON.prompt); return; }
    MAP_ICON.prompt = null;
    let live = true;
    mapperNextPrompt(store, sess.items.filter(i => !i.checked).map(i => i.name).slice(0, 30)).then(p => {
      if (MAP_ICON.store === store) MAP_ICON.prompt = p;
      if (live) setTeach(p);
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, store]);

  /* ---- what the screen shows (quest.js renderHunt) ---- */
  const next = sess ? qCurrentIndex(sess) : -1;
  // One stops array per real change, so the scene does not rebuild on
  // every keystroke (Express keys it the same way).
  const stopSig = sess ? sess.items.map(i => `${i.checked ? 1 : 0}${i.name}|${i.qty}|${i.shelf_label ?? ""}|${i.shelf_u ?? ""}|${i.shelf_side ?? ""}|${i.group ?? ""}`).join("\n") : "";
  const stops = useMemo(() => (sess ? qStops(sess) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sess, Q.storeReports, stopSig]);
  if (sess) {
    const base = resolveDriver(sess, peek3D);
    if (!drv.current) drv.current = base;
    // Art for the unmapped: an unplaced focused stop shows the drawing.
    if (isQuest && state === "playing") {
      const focus = stops[next];
      drv.current = base === "photo" && focus && focus.unplaced ? "art" : base;
    }
  }
  const driverName = drv.current;
  const ps = !sess ? "hidden" : state === "not_started" ? "ready"
    : state !== "playing" && state !== "paused" ? "hidden"
    : qNextIndex(sess) === -1 ? "done" : Q.arrived ? "stop" : "hidden";
  const allIn = ps === "done";
  const freshName = !sess || ps === "ready" || allIn || next < 0 ? null : sess.items[next].name;
  const freshCached = freshName ? freshKey(store, freshName) in QFRESH : false;

  /* The note takes the next-card's height when it replaces it, so the
   * list under them does not jump out from under a tap. */
  useLayoutEffect(() => {
    if (!allIn && popRef.current) popH.current = popRef.current.offsetHeight;
  });

  /* Fresh shelf photo: one fetch per store+item per visit; silent when
   * none. QFRESH is the cache; a scan pop drops an entry so it refetches. */
  useEffect(() => {
    if (!freshName || freshCached) return;
    const key = freshKey(store, freshName);
    QFRESH[key] = null;
    fetch(`/api/quest/shelf-photo?store=${encodeURIComponent(store)}&item=${encodeURIComponent(freshName)}`, { credentials: "same-origin" })
      .then(r => (r.ok ? r.json() : null)).catch(() => null)
      .then((rec: Fresh) => { QFRESH[key] = rec; setFreshTick(n => n + 1); });
  }, [store, freshName, freshCached]);

  /* ---- actions ---- */
  const announceGrab = (s: Session, idx: number, wasSuggested: boolean) => {
    const it = s.items[idx];
    if (!it) return;
    try {
      document.dispatchEvent(new CustomEvent("arya:grabbed", { detail: {
        sid: s.id, name: it.name, qty: it.qty, group: it.group,
        boss: !!(s.boss && it.group === s.boss.group), idx, wasSuggested } }));
    } catch { /* no events here */ }
    // The sticker card carries its own Undo; two toasts would stack.
    if (cardOpen()) return;
    const name = it.name;
    toast(t("hunt.inYourCart", { name }), { action: t("common.undo"), onAction: () => {
      const j = s.items.findIndex(i => i.name === name);
      if (j >= 0) putBackStop(j);
    } });
  };

  async function collectStop(idx: number, opts?: { undo?: boolean }) {
    const s = Q.current;
    if (!s || idx < 0 || idx >= s.items.length) return;
    if (s.state !== "playing" || s.items[idx].checked) return;
    const name = s.items[idx].name;
    const busyKey = s.id + "|" + name;
    if (Q.grabbing.has(busyKey)) return;
    Q.grabbing.add(busyKey);
    const wasSuggested = !(opts && opts.undo) && idx === qCurrentIndex(s);
    const isBoss = !!(s.boss && s.items[idx].group === s.boss.group);
    try {
      const before = qProgress(s).done;
      await qCheck(s, name, true);
      qOnCollected(name);
      try { qRewardGrab(s, before, { wasSuggested, boss: isBoss }); } catch { /* celebration only */ }
      delete Q.found[name];
      Q.followHold = false;
      const target = qRetarget(s, idx);
      repaint();
      stepAnchorTo(name);
      walkStart(target);
      announceGrab(s, idx, wasSuggested);
      if (target === -1) toast(nothingLeftNote(s));
    } catch (e) { toast(errMsg(e)); }
    finally { Q.grabbing.delete(busyKey); }
  }

  async function putBackStop(idx: number) {
    const s = Q.current;
    if (!s || idx < 0 || idx >= s.items.length) return;
    if (s.state !== "playing" && s.state !== "paused") return;
    if (!s.items[idx].checked) return;
    const name = s.items[idx].name, group = s.items[idx].group;
    try {
      await qCheck(s, name, false);
      if (qCurrentIndex(s) === -1 || Q.focusIdx === -1) Q.focusIdx = idx;
      repaint();
      try { document.dispatchEvent(new CustomEvent("arya:putback", { detail: { sid: s.id, name, group } })); } catch { /* no events */ }
      toast(t("hunt.putBack"), { action: t("common.undo"), onAction: () => {
        const j = s.items.findIndex(i => i.name === name);
        if (j >= 0) collectStop(j, { undo: true });
      } });
    } catch (e) { toast(errMsg(e)); }
  }

  /* A marker tap: the presented stop grabs; any other presents itself. */
  function tapStop(idx: number) {
    const s = Q.current;
    if (!s || s.mode !== "quest" || s.state !== "playing") return;
    if (idx === qCurrentIndex(s)) { collectStop(qCurrentIndex(s)); return; }
    if (idx < 0 || idx >= s.items.length || s.items[idx].checked) return;
    Q.focusIdx = idx;
    walkStart(idx);
    repaint();
  }

  async function onCollect() {
    const s = Q.current;
    if (!s) return;
    if (s.state === "not_started") {
      try {
        await qSetState(s, "playing");
        repaint();
        startTimer(s);
        walkStart(qCurrentIndex(s));
      } catch (e) { toast(errMsg(e)); }
      return;
    }
    collectStop(qCurrentIndex(s));
  }

  async function onPause() {
    const s = Q.current;
    if (!s) return;
    try {
      const to = s.state === "paused" ? "playing" : "paused";
      await qSetState(s, to);
      if (to === "paused") walkStop();
      repaint();
      if (to === "playing" && !Q.arrived) walkStart(qCurrentIndex(s));
    } catch (e) { toast(errMsg(e)); }
  }

  async function onAbandon() {
    const s = Q.current;
    if (!s) return;
    if (!window.confirm(t("hunt.confirmEnd"))) return;
    try {
      await qSetState(s, "abandoned");
      Q.sessions = Q.sessions.filter(x => x.id !== s.id);
      toast(t("hunt.questEnded"));
      nav.reset("community", {}, "home"); // an ended quest has no Back to it
    } catch (e) { toast(errMsg(e)); }
  }

  function onFinish() {
    const s = Q.current;
    if (!s || s.state === "not_started") return;
    // Items still open: the leave sheet asks first (huntmenu.js).
    if (openItems(s).length) { setMenu({ kind: "leave", name: "" }); return; }
    hideToast();
    nav.show("finish", { session: s });
  }

  const onCheckout = (n: number, undo: () => Promise<void>) => {
    const s = Q.current;
    if (!s) return;
    toast(t("hunt.leftForNext", { n }), { action: t("common.undo"), onAction: async () => {
      await undo();
      const fin = document.getElementById("view-finish");
      if (fin && !fin.hidden) nav.back();
    } });
    nav.show("finish", { session: s });
  };

  /* "Not here": the explicit report sheet. */
  async function withdrawReport(s: Session, name: string) {
    const NO_SIGNAL = t("hunt.noSignalTapAgain");
    if (navigator.onLine === false) { toast(NO_SIGNAL); return false; }
    try {
      Object.assign(s, await post(`/api/quest/sessions/${s.id}/withdraw-report`, { item: name }));
    } catch (e) {
      toast(e instanceof TypeError ? NO_SIGNAL : errMsg(e));
      return false;
    }
    await qLoadStoreReports(s.store);
    Q.focusIdx = -1;
    return true;
  }
  const openSpot = (idx?: number) => {
    const s = Q.current;
    const i = typeof idx === "number" ? idx : (s ? qCurrentIndex(s) : -1);
    if (!s || i < 0 || i >= s.items.length) return;
    setSpot({ idx: i, busy: false, pressed: null });
  };
  async function sendSpotReport(kind: string) {
    const s = Q.current;
    if (!s || !spot || spot.busy) return;
    const i = spot.idx >= 0 && spot.idx < s.items.length ? spot.idx : qCurrentIndex(s);
    if (i === -1) return;
    setSpot({ ...spot, busy: true, pressed: kind });
    try {
      const rep = await post<{ map_task?: { prompt?: Prompt } }>(`/api/quest/sessions/${s.id}/report-missing`, { item: s.items[i].name, kind });
      setSpot(null);
      const task = rep && rep.map_task;
      if (task && task.prompt) {
        // Teach Arya: "can't find it" is the best moment to learn this shelf.
        const prompt = task.prompt;
        toast(t("hunt.showShelf"), { action: t("hunt.openCamera"),
          onAction: () => nav.show("capture", { prompt, store: s.store }) });
      } else {
        const repName = s.items[i] ? s.items[i].name : "";
        toast(t("hunt.reportThanks"), { action: t("common.undo"), onAction: async () => {
          if (repName && await withdrawReport(s, repName)) { repaint(); toast(t("hunt.reportTakenBack")); }
        } });
      }
      Q.focusIdx = -1;
      await qLoadStoreReports(s.store);
      repaint();
    } catch (e) {
      toast(errMsg(e));
      setSpot(sp => (sp ? { ...sp, busy: false, pressed: null } : sp));
    }
  }

  async function foundIt(idx: number) {
    const s = Q.current, it = s && s.items[idx];
    if (!s || !it) return;
    const name = it.name;
    if (!(await withdrawReport(s, name))) return;
    const j = s.items.findIndex(i => i.name === name);
    if (j >= 0) await collectStop(j);
    else repaint();
  }
  function unfind(idx: number) {
    const s = Q.current, it = s && s.items[idx];
    if (!s || !it) return;
    delete Q.found[it.name];
    qHuntUiSave(s);
    repaint();
  }

  /* Wild finds: already in the cart, so it lands collected. */
  async function addWild() {
    const s = Q.current;
    const name = wildName.trim();
    if (!s || !name) return;
    try {
      Object.assign(s, await post(`/api/quest/sessions/${encodeURIComponent(s.id)}/items`, { name, qty: 1, wild: true }));
      setWildName("");
      setWildOpen(false);
      repaint();
      toast(t("hunt.wildFindAdded", { name }));
    } catch (e) { toast(errMsg(e)); }
  }

  async function addForgot(text: string) {
    if (!text.trim()) { toast(t("hunt.typeItemFirst")); return; }
    setAddText("");
    await submitForgot(toast, Q.current, text);
  }

  /* Shelf Scan / Find it for me. */
  const openScan = (target: string | null) => {
    walkStop(); // the player is standing at a shelf; the walk waits
    Q.scanTarget = target;
    setScan({ target });
  };
  const closeScan = () => {
    Q.scanTarget = null;
    setScan(null);
    const s = Q.current;
    if (s && s.state === "playing" && !Q.arrived && !Q.followHold && qNextIndex(s) >= 0) walkStart(qCurrentIndex(s));
  };
  async function scanCollect(name: string): Promise<boolean> {
    const s = Q.current;
    if (!s) return false;
    if (s.state !== "playing") { toast(t("hunt.startFirst")); return false; }
    const cur = qCurrentIndex(s);
    const isCurrent = cur >= 0 && s.items[cur].name === name;
    const cIdx = s.items.findIndex(i => i.name === name);
    const busyKey = s.id + "|" + name;
    if (Q.grabbing.has(busyKey)) return false;
    Q.grabbing.add(busyKey);
    try {
      const before = qProgress(s).done;
      await qCheck(s, name, true);
      qOnCollected(name);
      try {
        qRewardGrab(s, before, { wasSuggested: isCurrent, boss: !!(s.boss && cIdx >= 0 && s.items[cIdx].group === s.boss.group) });
      } catch { /* celebration only */ }
      delete Q.found[name];
      Q.followHold = false;
      if (isCurrent) qRetarget(s, cIdx);
      repaint();
      announceGrab(s, cIdx, isCurrent);
      if (isCurrent) { stepAnchorTo(name); walkStart(qCurrentIndex(s)); }
      if (Q.scanTarget === name && qNextIndex(s) !== -1) setTimeout(closeScan, 700);
      if (qNextIndex(s) === -1) { closeScan(); toast(nothingLeftNote(s)); }
      return true;
    } catch (e) { toast(errMsg(e)); return false; }
    finally { Q.grabbing.delete(busyKey); }
  }
  const onPops = (pops: Pop[]) => {
    const s = Q.current;
    if (!s) return;
    pops.forEach(pop => {
      const item = s.items.find(i => i.name === pop.item);
      if (item && !item.checked) qPinFound(item);
    });
    try { qHuntUiSave(s); } catch { /* memory only */ }
    repaint();
  };

  const closeHowto = () => {
    setHowto(false);
    try { localStorage.setItem(QHOWTO_KEY, "1"); } catch { /* shown again next time */ }
  };

  const openSession = (s0: Session) => {
    if (s0.state === "done" || s0.state === "finished") { nav.show("score", { session: s0 }); return; }
    nav.show(s0.mode === "express" ? "express" : "hunt", { session: s0 });
  };

  /* Keyboard (desktop players and judges): Space/Enter grab, ←/→ aim,
   * P pauses, F finishes, Esc goes Back. An open sheet owns the keys. */
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && t.closest && t.closest("input, textarea, select, [contenteditable]")) return;
    if ((e.key === "Enter" || e.key === " ") && t && t.closest && t.closest("button, a[href], [role=button], summary")) return;
    if (!Q.current || document.querySelector(".sheetwrap")) return;
    if (e.key === "Escape") { nav.back("community"); e.preventDefault(); return; }
    const press = (sel: string) => {
      const b = document.querySelector<HTMLButtonElement>(sel);
      if (b && b.offsetParent !== null && !b.disabled) { b.click(); return true; }
      return false;
    };
    let done = false;
    switch (e.key) {
      case " ": case "Enter": done = press("#btn-collect"); break;
      case "ArrowRight": case "ArrowLeft": {
        const s = Q.current, n = s.items.length, dir = e.key === "ArrowRight" ? 1 : -1;
        let i = qCurrentIndex(s), hit = -1;
        for (let k = 0; k < n; k++) { i = (i + dir + n) % n; if (!s.items[i].checked) { hit = i; break; } }
        if (hit >= 0) { tapStop(hit); done = true; }
        break;
      }
      case "p": case "P": done = press("#btn-pause"); break;
      case "f": case "F": done = press("#btn-finish"); break;
    }
    if (done) e.preventDefault();
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, []);

  const onDriver = useCallback((d: SceneDriver | null) => {
    Q.scene = d;
    if (d && Q.walkTarget >= 0) d.glideTo?.(Q.walkTarget);
  }, []);

  if (!sess) {
    return (
      <>
        <p><a href="#" className="qback" onClick={ev => { ev.preventDefault(); nav.back("community"); }}><span aria-hidden="true">‹ </span>{t("common.back")}</a></p>
        <Empty>{t("hunt.thatHuntIsGoneThe")}</Empty>
      </>
    );
  }

  /* Snap the aisle (owner, 2026-10-29): the capture this item's aisle
   * needs, on the guided capture screen (pwa/storedata.js snapAisle). */
  const snapAisle = async (name: string) => {
    try {
      const out = await get(`/api/storemap/next?store=${encodeURIComponent(store)}&item=${encodeURIComponent(name)}`);
      const prompt = out && out.prompt;
      if (prompt) nav.show("capture", { prompt, store, from: "hunt" });
    } catch (e) { toast(e instanceof Error ? e.message : String(e)); }
  };

  /* ---- paint ---- */
  const p = qProgress(sess);
  const hd = qHandled(sess);
  const live = state === "playing";
  const bossGroup = sess.boss && sess.boss.group;
  const hasModel = !!storeModel(store, storeId);
  const offlineText = qOfflineText();
  const stillOpen = openItems(sess).length > 0;
  const gyro = gyroAvailable() && !M.gyroGone;
  // Step-advance is an experiment: its toggle shows only in a debug
  // build or with ?debug=1, or while the flag is on so it can go off.
  const stepsVis = stepsDebug() || M.stepsOn;

  let popKicker = "", popBody: React.ReactNode = null, collectLabel = t("hunt.grab"), collectDisabled = false;
  let findHidden = true, notHereDisabled = false;
  if (ps === "ready") {
    const first = sess.items[0];
    const b = sess.boss;
    popKicker = t("hunt.readyWhenYouAre");
    popBody = <>
      <p className="pop-name">{t("hunt.item", { count: p.total })}</p>
      <p className="pop-shelf">{t("hunt.firstStop", { name: first ? first.name : "—" })}</p>
      {b ? <p className="pop-shelf hunt-boss">{t("hunt.bossItemReportedMissingOn", { name: b.name, reports: b.reports, boss: QPTS.boss })}</p> : null}
    </>;
    collectLabel = t("hunt.startTheHunt");
    notHereDisabled = true;
  } else if (!allIn && next >= 0) {
    const it = sess.items[next];
    const stop = stops[next];
    const rep = Q.storeReports.find(r => (r.item_group && r.item_group === it.group) || qnorm(r.item) === qnorm(it.name));
    popKicker = state === "paused" ? t("hunt.paused") : t("hunt.suggestedNext");
    popBody = <>
      <div className="popflex"><img className="popface" src={asset("assets/characters/" + faceFor(it.name))} alt="" />
        <div><p className="pop-name">{it.name}{it.unit ? ` · ${qtyTag(it)}` : it.qty > 1 ? ` · × ${qtyFmt(it.qty)}` : ""}</p></div></div>
      {stop.shelfLabel ? <p className="pop-shelf">{stop.shelfLabel}</p> : null}
      {itemHasData(store, it, storeId) ? null : <p className="pop-shelf nodata"><Trans i18nKey="common.noPhotoNudge" components={{ snap: <button type="button" className="linkbtn snapaisle" data-snap-aisle={it.name} onClick={() => snapAisle(it.name)} /> }} /></p>}
      {rep ? <p style={{ margin: "6px 0 0" }}><span className="repflag">{t("hunt.youReportedThisMissingHere")}</span></p> : null}
    </>;
    collectLabel = it.unit || it.qty > 1 ? t("hunt.grabQty", { qty: qtyTag(it), name: it.name }) : t("hunt.grabName", { name: it.name });
    collectDisabled = state !== "playing";
    findHidden = state !== "playing";
    notHereDisabled = state !== "playing";
  }
  const freshRec = freshName ? QFRESH[freshKey(store, freshName)] : null;
  const fresh = freshRec && freshRec.image && freshRec.box ? freshRec : null;

  const listRows = sess.items.map((it, i) => {
    const s = stops[i];
    const rep = !it.checked && qIsReportedByMe(sess, it);
    const sub = [s.shelfLabel || (s.unplaced ? t("hunt.notPlaced") : ""), s.flagged || rep ? t("common.reportedMissing") : ""].filter(Boolean).join(" · ");
    const qty = qtyTag(it);
    const note = qNoteOf(it);
    const f = !it.checked ? Q.found[it.name] : null;
    const openMenu = () => setMenu({ kind: "row", name: it.name });
    return (
      <div key={it.name + "|" + i} className={"row huntrow" + (it.checked ? " got" : "") + (rep ? " reported" : "") + (i === next ? " next" : "")}
        data-row={it.checked ? undefined : i}
        onClick={ev => {
          if (it.checked) return;
          if ((ev.target as HTMLElement).closest("button, a, input")) return;
          openMenu();
        }}>
        {it.checked
          ? <button type="button" className="huntcheck got" data-putback={i} aria-label={t("hunt.putBackName", { name: it.name })}
              disabled={!(live || state === "paused")} onClick={() => putBackStop(i)}>{TICK}</button>
          : rep
            ? <span className="huntcheck rep" aria-hidden="true" />
            : <button type="button" className={"huntcheck" + (state === "not_started" ? " notlive" : "")} data-grab={i}
                disabled={!live && state !== "not_started"} aria-disabled={state === "not_started" ? true : undefined}
                aria-label={qty ? t("hunt.grabQtyAria", { qty, name: it.name }) : t("hunt.grabAria", { name: it.name })}
                onClick={() => {
                  if (Q.current && Q.current.state === "not_started") { toast(t("hunt.tapStartFirst")); return; }
                  collectStop(i);
                }}>{TICK}</button>}
        <img className="rowface" src={asset("assets/characters/" + faceFor(it.name))} alt="" loading="lazy" />
        <div className="grow"><span className="name">{it.name}{qty ? <> <span className="hqty">{qty}</span></> : null}</span>
          {(bossGroup && it.group === bossGroup) || it.added_mid_hunt
            ? <span className="hunt-badges">
                {bossGroup && it.group === bossGroup ? <span className="hunt-badge boss">{t("hunt.boss")}</span> : null}
                {it.added_mid_hunt ? <span className="hunt-badge">{t("hunt.justAdded")}</span> : null}
              </span>
            : null}
          {note ? <span className="sub hunt-note">{note}</span> : null}
          {sub ? <span className="sub">{sub}</span> : null}
          {f && f.line
            ? <span className="findline">{PIN}<span className="hunt-findtext">{f.line}</span>
                <button type="button" className="hunt-unfind" data-unfind={i} aria-label={t("hunt.dismissSpotted", { name: it.name })} onClick={() => unfind(i)}>{CLOSE}</button></span>
            : null}
        </div>
        {rep ? <button type="button" className="btn rowact" data-foundit={i} disabled={!live} onClick={() => foundIt(i)}>{t("hunt.foundItAfterAll")}</button> : null}
        {it.checked ? null : <button type="button" className="morechev" data-more={i} aria-label={t("hunt.moreFor", { name: it.name })} onClick={openMenu}>›</button>}
      </div>
    );
  });

  const left = sess.left || [];
  const have = new Set([...(sess.items || []), ...left].map(i => nrm(i.name)));
  const usual = Q.plan && Q.plan.items && !offline() && state !== "done"
    ? qPlanUsuals(Q.plan, store).filter(u => !have.has(nrm(u.name))).slice(0, 4) : [];

  return (
    <>
      <div className="hunthud">
        <a href="#" className="qback hudback" aria-label={t("common.backPlain")} onClick={ev => { ev.preventDefault(); nav.back("community"); }}>&lsaquo;</a>
        <span className="hchip grow" id="hunt-store">{`${store} · ${qModeLabel(sess.mode)}`}</span>
        <span className="hchip" id="hunt-timer" ref={timerEl} hidden>0:00</span>
        <span className="hchip pts" id="hunt-pts" aria-live="polite">{t("hunt.pts", { qHaulPoints: qHaulPoints(sess, false) })}</span>
        <span className="hchip prog" id="hunt-count">{t("hunt.handledOf", { done: hd.handled, total: hd.total })}</span>
        <span className="hchip combo" id="hunt-combo" hidden={!(Q.combo >= 2)}>{t("hunt.combo", { n: Q.combo || 0 })}</span>
        <button id="btn-pause" className="hudbtn" type="button" aria-label={state === "paused" ? t("common.resume") : t("common.pause")}
          disabled={state === "not_started"} onClick={onPause}>{state === "paused" ? PLAY : PAUSE}</button>
      </div>
      <div id="q-brief">
        {brief ? (
          <div className="group pad mp-offer">
            <span className="eyebrow">{t("hunt.bonus10Pts")}</span>
            <div className="name">{t("hunt.gotSecondsTeachArya", { est_seconds: brief.est_seconds, replace: brief.title.replace(/^(Photo of|Walk)\s+/, "") })}</div>
            <p className="muted nomargin">{t("hunt.yourNextHuntHereGets")}</p>
            <div className="rail">
              <button className="btn primary" data-mapoffer="go" type="button" onClick={() => nav.show("capture", { prompt: brief, store })}>{t("hunt.teachArya")}</button>
              <button className="btn" data-mapoffer="later" type="button" onClick={() => { mapperMute(store); setBrief(null); }}>{t("common.notNow")}</button>
            </div>
          </div>
        ) : null}
      </div>
      <SceneView id="scene-mount" className="storeview" driver={driverName} photos={storePhotos(store, storeId)} model={storeModel(store, storeId)}
        stops={stops} next={next} onTapStop={tapStop} onDriver={onDriver} />
      <div className="scenecap">
        <p id="scene-cap" className="muted nomargin">{QSCENE_CAPTION[driverName] ? t(QSCENE_CAPTION[driverName]) : ""}</p>
        <button id="btn-3d" className="linkbtn" type="button" hidden={!hasModel} onClick={() => {
          M.stepsHold = true;
          followHold();
          const peek = driverName !== "cloud";
          drv.current = resolveDriver(sess, peek);
          setPeek3D(peek);
        }}>{driverName === "cloud" ? <><span aria-hidden="true">‹ </span>{t("hunt.backToPhotos")}</> : <>{t("hunt.seeIn3d")}<span aria-hidden="true"> ›</span></>}</button>
      </div>
      <div id="milestone" className="milestone" role="status" />
      <p id="hunt-mapnote" className="muted small" hidden />
      <p id="hunt-offline" className="offlinenote" role="status" hidden={!offlineText}>{offlineText}</p>
      <div className="hunt-tools" role="group" aria-label={t("hunt.huntTools")}>
        <button id="btn-scan" className="btn toolbtn" type="button" hidden={driverName !== "strip"} onClick={() => openScan(null)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8h3l2-2.5h6L17 8h3v11H4z" /><circle cx="12" cy="13" r="3.4" /></svg><span>{t("hunt.scanShelf")}</span></button>
        <button id="btn-nothere" className="btn toolbtn" type="button" hidden={allIn} disabled={notHereDisabled}
          onClick={() => { const s = Q.current; const i = s ? qCurrentIndex(s) : -1; if (s && i >= 0) setMenu({ kind: "moved", name: s.items[i].name }); }}>{t("common.notHere")}</button>
        <button id="btn-wild" className="btn toolbtn" type="button"
          onClick={() => { const o = !wildOpen; setWildOpen(o); if (o) setTimeout(() => wildRef.current?.focus(), 0); }}><span aria-hidden="true">+ </span>{t("hunt.wildFind")}</button>
        <button id="btn-teach" className="btn toolbtn" type="button" hidden={!teach}
          onClick={() => { if (teach) nav.show("capture", { prompt: teach, store }); }}>
          <img className="toolimg" src={asset("assets/characters/compass.webp")} alt="" /><span>{t("hunt.teachArya")}</span></button>
        <span className="toolspacer" />
        <span className="hudgroup">
          <button id="btn-howto" className="hudbtn" type="button" aria-label={t("hunt.howToPlay")} onClick={() => setHowto(true)}>?</button>
          <button id="btn-sound" className="hudbtn" type="button" aria-label={t("hunt.soundAndBuzz")} aria-pressed={QFX.on}
            onClick={() => { setSound(!QFX.on); repaint(); }}>{QFX.on ? SOUND_ON : SOUND_OFF}</button>
        </span>
      </div>
      <div id="wild-form" className="group pad" hidden={!wildOpen}>
        <label className="field" htmlFor="wild-name">{t("hunt.wildFindAlreadyInYour")}</label>
        <input type="text" id="wild-name" ref={wildRef} placeholder={t("hunt.eGOatMilkChocolate")} autoComplete="off"
          value={wildName} onChange={e => setWildName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addWild(); } }} />
        <p style={{ display: "flex", gap: 8, margin: "8px 0 0" }}>
          <button className="btn primary grow" id="wild-add" type="button" onClick={addWild}>{t("hunt.addToTheHaul")}</button>
          <button className={"btn grow" + (wildRec.listening ? " listening" : "")} id="wild-mic" type="button" onClick={wildRec.click}>
            {wildRec.listening ? t("common.voice.stopTranscribe") : t("common.voice.record")}</button>
        </p>
        <p className="muted nomargin" id="wild-status">{wildRec.status}</p>
      </div>
      <div id="hunt-pop" className="nextcard" ref={popRef} hidden={allIn}>
        <p className="nb-k" id="pop-kicker">{popKicker || t("hunt.suggestedNext")}</p>
        <div id="pop-body">{popBody}</div>
        <figure id="hunt-fresh" className="fresh" hidden={!fresh}>
          <div className="freshimg"><img id="fresh-img" alt="" src={fresh?.image || undefined} />
            <span id="fresh-box" className="freshbox" style={fresh && fresh.box ? {
              left: fresh.box[0] * 100 + "%", top: fresh.box[1] * 100 + "%",
              width: (fresh.box[2] - fresh.box[0]) * 100 + "%", height: (fresh.box[3] - fresh.box[1]) * 100 + "%" } : undefined} /></div>
          <figcaption id="fresh-cap" className="muted">{fresh ? t("hunt.freshFrom", { ago: qAgo(fresh.seen_at) }) : ""}</figcaption>
        </figure>
        <p className="nomargin"><button id="btn-collect" className="btn primary wide grabbtn" type="button" disabled={collectDisabled} onClick={onCollect}>{collectLabel}</button></p>
        <p className="nomargin findrow"><button id="btn-findit" className="btn wide" type="button" hidden={findHidden || allIn}
          onClick={() => { const s = Q.current; const i = s ? qCurrentIndex(s) : -1; if (s && i >= 0) openScan(s.items[i].name); }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></svg><span>{t("hunt.findItForMe")}</span></button></p>
      </div>
      <p id="hunt-done-note" className="donenote" hidden={!allIn} style={allIn && popH.current ? { minHeight: popH.current } : undefined}>
        {p.total > 0 && p.left === 0
          ? t("hunt.allCollectedNote")
          : t("hunt.nothingLeftTapDone")}
      </p>
      <h3 className="sect">{t("hunt.theList")}</h3>
      <div id="hunt-list" className="group">
        {listRows.length ? listRows : <Empty>{left.length ? t("hunt.nothingLeftOnHunt") : t("hunt.listEmpty")}</Empty>}
      </div>
      <div id="hunt-left" className="hm-left" hidden={!left.length}>
        {left.length ? (
          <div className="group hm-leftgroup">
            <button type="button" className="hm-leftbar" data-act="fold" aria-expanded={leftOpen} onClick={() => setLeftOpen(o => !o)}>
              <span>{t("hunt.leftForNextTime", { leftCount: left.length })}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={"hm-chev" + (leftOpen ? " open" : "")}><path d="M6 9l6 6 6-6" /></svg>
            </button>
            {leftOpen ? left.map((e, k) => (
              <div key={e.name + k} className="row hm-leftrow">
                <div className="grow"><span className="name">{e.name}{qtyTag(e) ? ` - ${qtyTag(e)}` : ""}</span>
                  <span className="sub">{e.how === "dropped" ? t("hunt.notNeededToday") : t("hunt.savedForNextTrip")}</span></div>
                <button type="button" className="btn" data-back={k} aria-label={t("hunt.bringBackName", { name: e.name })} onClick={() => bringBack(toast, sess, k)}>{t("hunt.bringBack")}</button>
              </div>
            )) : null}
          </div>
        ) : null}
      </div>
      <div id="hunt-add" className="hm-add group pad">
        <label className="hm-addlabel" htmlFor="hm-add-input"><span aria-hidden="true">+ </span>{t("hunt.forgotSomething")}</label>
        <div className="hm-addrow">
          <input type="text" id="hm-add-input" className="hm-addinput" placeholder={t("hunt.2xTortillas")} autoComplete="off" enterKeyHint="done"
            value={addText} onChange={e => setAddText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addForgot(addText); } }} />
          <button id="hm-add-btn" className="btn primary" type="button" onClick={() => addForgot(addText)}>{t("common.add")}</button>
          <button id="hm-add-mic" className={"btn hm-mic" + (addRec.listening ? " listening" : "")} type="button" onClick={addRec.click}>
            {addRec.listening ? t("common.voice.stopTranscribe") : t("common.voice.record")}</button>
        </div>
        <p id="hm-add-status" className="muted nomargin">{addRec.status}</p>
        <div id="hm-add-chips" className="hm-chips" hidden={!usual.length}>
          {usual.map(u => <button key={u.name} type="button" className="chip hm-chip" data-usual={u.name} onClick={() => submitForgot(toast, Q.current, u.name)}>+ {u.name}</button>)}
        </div>
      </div>
      <p><button id="btn-finish" className={stillOpen ? "btn secondary wide" : "btn primary wide"} type="button"
        disabled={state === "not_started"} onClick={onFinish}>{stillOpen ? t("hunt.doneShopping") : t("hunt.doneAddReceipt")}</button></p>
      <p style={{ textAlign: "center" }}><button id="btn-abandon" className="btn" type="button"
        hidden={!["playing", "paused", "not_started"].includes(state)} onClick={onAbandon}>{t("hunt.endThisQuest")}</button></p>
      <p id="motion-row" className="motionrow" hidden={!(gyro || stepsVis)}>
        <button id="btn-gyro" className="btn" type="button" aria-pressed={!!(M.motion && M.motion.on)} hidden={!gyro}
          onClick={async () => {
            const ok = await toggleGyro();
            if (!ok) toast(t("hunt.gyroUnavailable"));
            repaint();
          }}>{M.motion && M.motion.on ? t("hunt.stopPhoneLook") : t("hunt.lookAround")}</button>
        <button id="btn-steps" className="chip" type="button" aria-pressed={M.stepsOn} hidden={!stepsVis}
          onClick={async () => {
            const msg = await toggleSteps();
            if (msg) toast(msg);
            stepSync(true);
            repaint();
          }}>{M.stepsOn ? t("hunt.stepsOn") : t("hunt.stepsOff")}</button>
      </p>
      <button id="hunt-askbar" className="askbar" type="button" onClick={() => setAsk(true)}>{t("hunt.askArya")}<span className="askmic">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" /></svg></span></button>
      <div id="hunt-rail" className="rail" aria-label={t("common.todaySHunts")}>
        {Q.sessions.map(s0 => {
          const s = s0.id === sess.id ? sess : s0;
          const pr = qProgress(s);
          return <button key={s.id} className="chip" data-rail={s.id} aria-pressed={s.id === sess.id} type="button"
            onClick={() => { if (s.id !== sess.id) openSession(s0); }}>{`${s.store} · ${pr.done}/${pr.total}`}</button>;
        })}
      </div>
      <canvas id="confetti" className="confetti" aria-hidden="true" hidden />
      <div id="celeb-layer" className="celeblayer" hidden onClick={qCelebHide} />

      <ScanView open={!!scan} sess={sess} target={scan ? scan.target : null} onClose={closeScan} collect={scanCollect} onPops={onPops} />

      <Sheet open={!!spot} onClose={() => setSpot(null)} id="spot-sheet">
        <span className="sheetgrip" aria-hidden="true" />
        <div className="row"><span className="name">{t("common.notHereShort")}</span></div>
        <p className="muted" id="spot-item">{spot && sess.items[spot.idx] ? t("hunt.atTheStop", { name: sess.items[spot.idx].name }) : ""}</p>
        <div className="actions" style={{ flexDirection: "column", alignItems: "stretch" }}>
          {SPOT_KINDS.map(([kind, label]) => (
            <button key={kind} className="chip" data-kind={kind} aria-pressed={!!spot && spot.pressed === kind} type="button"
              onClick={() => sendSpotReport(kind)}>{t(label)}</button>
          ))}
        </div>
        <p className="muted nomargin">{t("hunt.tapWhatYouSeeAnd")}</p>
      </Sheet>

      <Sheet open={howto} onClose={closeHowto} id="howto-sheet" labelledBy="howto-title">
        <div className="row"><span className="name" id="howto-title">{t("hunt.howToPlay3Steps")}</span>
          <button id="howto-skip" className="btn" type="button" onClick={closeHowto}>{t("common.skip")}</button></div>
        <ol className="howto">
          <li><b>{t("hunt.findIt")}</b><span>{t("hunt.theOrangeCardShowsYour")}</span></li>
          <li><b>{t("hunt.grabIt")}</b><span>{t("hunt.inYourCartTapGrab")}</span></li>
          <li><b>{t("hunt.snapTheReceipt")}</b><span>{t("hunt.tapFinishAndPhotographThe")}</span></li>
        </ol>
        <p className="nomargin"><button id="howto-go" className="btn primary wide" type="button" data-first onClick={closeHowto}>{t("hunt.gotItLetSHunt")}</button></p>
        <p className="muted nomargin">{t("hunt.theOnTheHuntScreen")}</p>
      </Sheet>

      <StickerCard onUndo={(key, name) => {
        const idx = stickerUndoIndex(Q.current, key, name);
        if (idx >= 0) putBackStop(idx);
      }} />

      <HuntMenu menu={menu} setMenu={setMenu} sess={sess}
        onFind={name => openScan(name)} onTell={idx => openSpot(idx)} onCheckout={onCheckout} />

      <AskSheet open={ask} onClose={() => setAsk(false)} onChange={repaint} />
    </>
  );
}

