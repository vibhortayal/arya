import { useCallback, useEffect, useRef, useState } from "react";
import { useNav } from "../app/nav";
import { useToast } from "../ui/Toast";
import { get, post } from "../lib/api";
import { t, Trans, useTranslation } from "../i18n";
import { addFrame, discardWalk, finishWalk as queueFinish, startWalk, type LocalWalk } from "../lib/scanQueue";
import { grab, sameView, sharpness, thumb } from "../lib/frames";

/* Port of pwa/index.html #view-capture and pwa/mapper.js (openCapture,
 * the cam* functions, upload, teach confirm, reward card). The Shell
 * already renders <section id="view-capture">; no second one.
 * Owner rule kept: no retake loops. The camera stays open, the app
 * grades frames itself and keeps the best one. Reads nav.params.prompt
 * and nav.params.store (and nav.params.from: "mapper" when the
 * Teach Arya your store screen is underneath). */

type Prompt = {
  kind?: string; segment?: string; teach?: boolean; est_seconds?: number; media?: string; item?: string;
  title: string; why?: string; steps?: string[]; parts?: string[]; splittable?: boolean;
};
type Seg = { id: string; label: string };
type StoreView = { segments?: Seg[]; next?: Prompt | null };
/* store_pct holds nulls while the store's size is unknown (no aisle
 * number read yet): the card then shows no percentage. */
type Reward = { points: number; new_section?: boolean; new_title?: string; store_pct: [number | null, number | null];
  goal?: { sections_needed: number; pct: number } | null };
type Found = { label: string; segment: string; created?: boolean; fresh: boolean };
type Result =
  | { t: "text"; text: string }
  | { t: "gentle" }
  | { t: "pick" }
  | { t: "reward"; won: { out: any; seg: string }[]; last: Reward }
  | { t: "teach"; found: Found[]; pts: number; title: string | null; extra?: ScanExtra };
type ScanExtra = { signs: string[]; prices: { item: string; price: number }[]; people: number };

const CAM_TICK_MS = 250;
const PHOTO_SETTLE_MS = 1500;   // steady this long, then snap
const PHOTO_MAX_MS = 6000;      // snap the best seen by then anyway
const WALK_BUCKET_MS = 2000;    // keep the sharpest frame per 2 s
const WALK_SECONDS_PER_PART = 8;
const WALK_MAX_MS = 45000;
const M_WALK_SEND = 6;          // sharpest frames sent
/* Map my store's walk (owner, 2026-10-30): full screen, coaching only,
 * nothing read while walking. The sharpest frame of every 2 s is saved
 * on the phone (lib/scanQueue) and read in the background after Done.
 * Only Done ends the walk; a gentle nudge at 4 min, a stop at 6. */
const SCAN_SOFT_MS = 4 * 60 * 1000;
const SCAN_HARD_MS = 6 * 60 * 1000;
const SCAN_TIP_MS = 9000;
const PRICES_KEY = "arya-scan-prices";
const readPricesOpt = () => { try { return localStorage.getItem(PRICES_KEY) === "1"; } catch { return false; } };

type Frame = { c: HTMLCanvasElement; score: number };
type WalkState = { t0: number; buckets: Frame[]; maxSharp: number; shownParts: number };
type ScanState = { w: LocalWalk; t0: number; bucket: number; best: Frame | null; last: Uint8Array | null;
  saving: Promise<void>; saved: number; maxSharp: number };
type ScanView = { el: number; coach: string; good: boolean; ready: boolean };
const mmss = (ms: number) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

/* ---- frame grading on the phone (no network, no model): lib/frames ---- */
function camHint(g: { sharp: number; luma: number }, rel: number, walk: boolean): [string, boolean] {
  if (g.luma < 45) return [t("capture.hint.dark"), false];
  if (g.luma > 225) return [t("capture.hint.glare"), false];
  if (rel < 0.5) return [walk ? t("capture.hint.slower") : t("capture.hint.holdStill"), false];
  return [walk ? t("capture.hint.steadyWalk") : t("capture.hint.holding"), true];
}
const camGrab = (video: HTMLVideoElement) => grab(video);
const camBlob = (c: HTMLCanvasElement) => new Promise<Blob>(res => c.toBlob(b => res(b as Blob), "image/jpeg", 0.88));

async function postBlob(url: string, blob: Blob) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": blob.type || "image/jpeg" }, body: blob });
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { detail?: string }).detail || `HTTP ${r.status}`);
  return r.json();
}

function seekTo(video: HTMLVideoElement, t: number) {
  return new Promise<void>(res => { video.onseeked = () => res(); video.currentTime = t; });
}
async function videoFrames(file: File) {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true; video.playsInline = true; video.src = url;
  await new Promise<void>((res, rej) => { video.onloadedmetadata = () => res(); video.onerror = () => rej(new Error(t("capture.badVideo"))); });
  const dur = video.duration || 1;
  const n = Math.max(4, Math.min(24, Math.round(dur / (WALK_BUCKET_MS / 1000))));
  const frames: { blob: Blob; score: number }[] = [];
  for (let i = 0; i < n; i++) {
    await seekTo(video, dur * (i + 0.5) / n);
    const c = camGrab(video);
    frames.push({ blob: await camBlob(c), score: sharpness(c).sharp });
  }
  URL.revokeObjectURL(url);
  return { frames, secs: dur };
}

/* A teach walk sends a spread of its sharpest frames. */
function teachPicks(frames: { blob: Blob }[]) {
  if (frames.length <= M_WALK_SEND) return frames.map(f => f.blob);
  const step = frames.length / M_WALK_SEND;
  const out: Blob[] = [];
  for (let i = 0; i < M_WALK_SEND; i++) out.push(frames[Math.floor(i * step)].blob);
  return out;
}

export function Capture() {
  const { t } = useTranslation();
  const nav = useNav();
  const { toast } = useToast();
  const param = nav.params.prompt as Prompt | undefined;
  const [prompt, setPrompt] = useState<Prompt>(param || { title: "" });
  const [store, setStore] = useState<string>(String(nav.params.store || ""));
  const [view, setView] = useState<StoreView | null>(null);
  const [camOn, setCamOn] = useState(false);
  const [hint, setHint] = useState<{ text: string; good: boolean }>({ text: "", good: false });
  const [parts, setParts] = useState({ n: 0, on: 0 });
  const [goLabel, setGoLabel] = useState(() => t("capture.openCamera"));
  const [goDisabled, setGoDisabled] = useState(false);
  // Snap the aisle (owner, 2026-10-29): a photo or a short video.
  const [videoOpt, setVideoOpt] = useState(false);
  const [controls, setControls] = useState(true);
  const [result, setResult] = useState<Result | null>(null);
  const [barW, setBarW] = useState<number | null>(null);
  const [after, setAfter] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanView | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  const [pricesOpt, setPricesOpt] = useState(readPricesOpt);

  const videoRef = useRef<HTMLVideoElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const videoInRef = useRef<HTMLInputElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<number | null>(null);
  const walk = useRef<WalkState | null>(null);
  const scanRef = useRef<ScanState | null>(null);
  const busy = useRef(false);
  const epoch = useRef(0);
  const P = useRef(prompt); P.current = prompt;
  const S = useRef(store); S.current = store;
  const V = useRef(view); V.current = view;

  const camStop = useCallback(() => {
    if (timer.current !== null) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach(t => t.stop());
    stream.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const loadView = useCallback(async (st: string) => {
    if (!st) return null;
    const v = await get<StoreView>(`/api/storemap?store=${encodeURIComponent(st)}`);
    setView(v); V.current = v;
    return v;
  }, []);

  const openCapture = useCallback((p: Prompt) => {
    camStop();
    walk.current = null;
    epoch.current++;
    setPrompt(p); P.current = p;
    setGoLabel(t("capture.openCamera")); setGoDisabled(false);
    setVideoOpt(p.media === "both");
    setCamOn(false); setControls(true); setResult(null); setAfter(null); setBarW(null); setScan(null);
    setParts({ n: 0, on: 0 }); setHint({ text: "", good: false });
    if (photoRef.current) photoRef.current.value = "";
    if (videoInRef.current) videoInRef.current.value = "";
    // Aisle unknown yet: one tap on the aisle you are in, then the camera.
    if (!p.segment && !p.teach) { setControls(false); setResult({ t: "pick" }); }
  }, [camStop]);

  // Opened (or re-opened) with a prompt from the mapper, hunt, etc.
  useEffect(() => {
    const p = nav.params.prompt as Prompt | undefined;
    const st = String(nav.params.store || "");
    setStore(st); S.current = st;
    busy.current = false;
    if (p) openCapture(p);
    loadView(st).catch(() => {});
  }, [nav.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Leaving the screen always turns the camera off. A walk in progress
  // is kept: its frames are already on the phone and go up later.
  useEffect(() => () => {
    epoch.current++; walk.current = null; camStop();
    const sc = scanRef.current; scanRef.current = null;
    if (sc) { nav.setChrome(true); void sc.saving.then(() => (sc.w.frames ? queueFinish(sc.w) : discardWalk(sc.w))); }
  }, [camStop]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  const upload = (blob: Blob, kind: string, segment?: string) =>
    postBlob(`/api/storemap/capture?store=${encodeURIComponent(S.current)}&segment=${encodeURIComponent(segment || P.current.segment || "")}&kind=${kind}`, blob);

  const confetti = () => { const f = (window as any).qConfetti; if (typeof f === "function") f(); };

  const mapperAfter = async () => {
    const v = await loadView(S.current).catch(() => V.current);
    // Snapped from a shopping trip: the way on is back to the trip.
    setAfter(P.current.item ? t("capture.backToShopping") : v && v.next ? t("capture.teachOneMore") : t("capture.backToMap"));
  };

  /* Upload, then celebrate. A failure never asks for a retake. */
  const send = async (picks: { blob: Blob; segment?: string }[], kind: string) => {
    busy.current = true;
    const ep = epoch.current;
    setControls(false); setCamOn(false);
    setResult({ t: "text", text: t("capture.blurring") });
    const won: { out: any; seg: string }[] = [];
    let last: Reward | null = null;
    for (const p of picks) {
      try {
        const out = await upload(p.blob, kind, p.segment);
        if (out.reward) { won.push({ out, seg: p.segment || "" }); last = out.reward; }
      } catch { /* skip quietly; nothing was kept for this one */ }
    }
    busy.current = false;
    if (ep !== epoch.current) return;
    if (!won.length || !last) { setResult({ t: "gentle" }); await mapperAfter(); return; }
    setBarW(last.store_pct[0] ?? 0);
    setResult({ t: "reward", won, last });
    if (won.some(w => w.out.reward.new_section)) confetti();
    const l = last;
    requestAnimationFrame(() => requestAnimationFrame(() => setBarW(l.store_pct[1] ?? 0)));
    await mapperAfter();
  };

  /* Send the walk's frames to the teach reader, then show the confirm
   * card: sections found, each removable with one tap. */
  const teachSend = async (blobs: Blob[], kind = "walk") => {
    busy.current = true;
    const ep = epoch.current;
    setControls(false); setCamOn(false);
    setResult({ t: "text", text: t("capture.reading") });
    const found = new Map<string, Found>();
    let pts = 0, newTitle: string | null = null;
    for (const blob of blobs) {
      try {
        const item = P.current.item || "";
        const out = await postBlob(`/api/storemap/teach?store=${encodeURIComponent(S.current)}&kind=${kind}` + (item ? `&item=${encodeURIComponent(item)}` : ""), blob);
        const cur = found.get(out.segment) || { label: out.label, segment: out.segment, created: out.created, fresh: false };
        if (out.reward) {
          pts += out.reward.points;
          if (out.reward.new_section) cur.fresh = true;
          if (out.reward.new_title) newTitle = out.reward.new_title;
        }
        found.set(out.segment, cur);
      } catch { /* skip the frame */ }
    }
    busy.current = false;
    if (ep !== epoch.current) return;
    if (!found.size) { setResult({ t: "gentle" }); await mapperAfter(); return; }
    const list = [...found.values()];
    setResult({ t: "teach", found: list, pts, title: newTitle });
    if (list.some(f => f.fresh)) confetti();
    await mapperAfter();
  };

  /* Spread a walk's frames over the aisle's sections; send the
   * sharpest frame of each. */
  const sendWalk = async (frames: { blob: Blob; score: number }[], secs: number) => {
    if (!frames.length) { setResult({ t: "gentle" }); return; }
    const p = P.current;
    let ids: string[] = p.parts || [p.segment || ""];
    const want = Math.max(1, Math.min(6, Math.round(secs / WALK_SECONDS_PER_PART)));
    if (p.splittable && want >= 2) {
      try {
        const out = await post("/api/storemap/split", { store: S.current, segment: p.segment, parts: want });
        ids = out.segments.map((s: Seg) => s.id);
      } catch { /* keep the whole aisle as one piece */ }
    }
    const picks = ids.map((id, k) => {
      const lo = Math.floor(k * frames.length / ids.length);
      const hi = Math.max(lo + 1, Math.floor((k + 1) * frames.length / ids.length));
      const group = frames.slice(lo, hi);
      if (!group.length) return null;
      return { blob: group.reduce((a, b) => (b.score > a.score ? b : a)).blob, segment: id };
    }).filter((x): x is { blob: Blob; segment: string } => !!x);
    await send(picks, "walk");
  };

  const finishWalk = async () => {
    const w = walk.current; walk.current = null;
    if (!w) return;
    const secs = (Date.now() - w.t0) / 1000;
    camStop();
    const frames: { blob: Blob; score: number }[] = [];
    for (const b of w.buckets.filter(Boolean)) frames.push({ blob: await camBlob(b.c), score: b.score });
    if (P.current.teach) { await teachSend(teachPicks(frames)); return; }
    await sendWalk(frames, secs);
  };

  /* Map my store's walk: keep the sharpest frame of every 2 s on the
   * phone, skipping one that shows what the last one did. */
  const scanKeep = (sc: ScanState, f: Frame) => {
    const th = thumb(f.c);
    if (sameView(sc.last, th)) return;
    sc.last = th; sc.saved++;
    sc.saving = sc.saving.then(async () => { await addFrame(sc.w, await camBlob(f.c)); }).catch(() => {});
  };

  const backToMapper = () => {
    if (nav.params.from === "mapper") nav.back("mapper");
    else nav.replace("mapper", { store: S.current });
  };

  /* Done (keep) or the X (throw away). Frames go up in the background. */
  const endScan = async (keep: boolean) => {
    const sc = scanRef.current; scanRef.current = null;
    if (!sc) return;
    camStop(); nav.setChrome(true); setScan(null);
    if (keep && sc.best) scanKeep(sc, sc.best);
    await sc.saving;
    if (!keep || !sc.w.frames) {
      await discardWalk(sc.w).catch(() => {});
      if (keep) toast(t("capture.scan.noFrames"));
      backToMapper();
      return;
    }
    await queueFinish(sc.w).catch(() => {});
    toast(t("capture.scan.sent"));
    backToMapper();
  };

  const stopScan = () => {
    if (window.confirm(t("capture.scan.discardAsk"))) void endScan(false);
  };

  const startScan = async () => {
    const v = videoRef.current!;
    let w: LocalWalk;
    try { w = await startWalk(S.current, "scan", pricesOpt); }
    catch { camStop(); toast(t("capture.scan.noStorage")); return; }
    const sc: ScanState = { w, t0: Date.now(), bucket: 0, best: null, last: null, saving: Promise.resolve(), saved: 0, maxSharp: 1 };
    scanRef.current = sc;
    nav.setChrome(false); setControls(false);
    setScan({ el: 0, coach: t("capture.scan.start"), good: false, ready: false });
    timer.current = window.setInterval(() => {
      const s2 = scanRef.current;
      if (!s2 || !v.videoWidth) return;
      const el = Date.now() - s2.t0;
      const c = camGrab(v), g = sharpness(c);
      s2.maxSharp = Math.max(s2.maxSharp, g.sharp);
      const [text, ok] = camHint(g, g.sharp / s2.maxSharp, true);
      const b = Math.floor(el / WALK_BUCKET_MS);
      if (b !== s2.bucket) { if (s2.best) scanKeep(s2, s2.best); s2.best = null; s2.bucket = b; }
      if (ok && (!s2.best || g.sharp > s2.best.score)) s2.best = { c, score: g.sharp };
      setScan({ el, coach: text, good: ok, ready: true });
      if (el >= SCAN_HARD_MS) void endScan(true);
    }, CAM_TICK_MS * 2);
  };

  async function camStart() {
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) return false;
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } }, audio: false });
    } catch { return false; }
    const v = videoRef.current;
    if (!v) { camStop(); return false; }
    v.srcObject = stream.current;
    await v.play().catch(() => {});
    setCamOn(true);
    return true;
  }

  /* PHOTO: watch, hint, snap the best frame once steady. */
  const camPhoto = () => {
    const v = videoRef.current!;
    setGoLabel(t("capture.snapping")); setGoDisabled(true); setParts({ n: 0, on: 0 });
    const t0 = Date.now();
    let best: Frame | null = null, maxSharp = 1, goodSince = 0, snapping = false;
    timer.current = window.setInterval(async () => {
      if (!v.videoWidth || snapping) return;
      const c = camGrab(v), g = sharpness(c);
      maxSharp = Math.max(maxSharp, g.sharp);
      const [text, ok] = camHint(g, g.sharp / maxSharp, false);
      setHint({ text, good: ok });
      const score = g.sharp * (ok ? 1 : 0.5);
      if (!best || score > best.score) best = { c, score };
      goodSince = ok ? (goodSince || Date.now()) : 0;
      const now = Date.now();
      if ((goodSince && now - goodSince >= PHOTO_SETTLE_MS) || now - t0 >= PHOTO_MAX_MS) {
        snapping = true;
        if (timer.current !== null) clearInterval(timer.current);
        timer.current = null;
        setHint({ text: t("capture.gotIt"), good: true });
        const blob = await camBlob(best.c);
        camStop();
        if (P.current.teach) { await teachSend([blob], "photo"); return; }
        await send([{ blob, segment: P.current.segment }], "photo");
      }
    }, CAM_TICK_MS);
  };

  /* WALK: keep the sharpest frame of every 2 seconds. */
  const camWalk = () => {
    const v = videoRef.current!;
    setGoLabel(t("capture.done")); setGoDisabled(false);
    const n0 = (P.current.parts || [P.current.segment]).length;
    walk.current = { t0: Date.now(), buckets: [], maxSharp: 1, shownParts: n0 };
    setParts({ n: n0, on: 0 });
    timer.current = window.setInterval(() => {
      const w = walk.current;
      if (!w || !v.videoWidth) return;
      const el = Date.now() - w.t0;
      const c = camGrab(v), g = sharpness(c);
      w.maxSharp = Math.max(w.maxSharp, g.sharp);
      const [text, ok] = camHint(g, g.sharp / w.maxSharp, true);
      setHint({ text, good: ok });
      const b = Math.floor(el / WALK_BUCKET_MS);
      const score = g.sharp * (ok ? 1 : 0.5);
      if (!w.buckets[b] || score > w.buckets[b].score) w.buckets[b] = { c, score };
      const want = P.current.splittable ? Math.max(1, Math.min(6, Math.round(el / 1000 / WALK_SECONDS_PER_PART))) : n0;
      w.shownParts = want;
      setParts({ n: want, on: Math.min(want, Math.floor(el / 1000 / WALK_SECONDS_PER_PART) + 1) });
      if (el >= WALK_MAX_MS) finishWalk();
    }, CAM_TICK_MS * 2);
  };

  const go = async (asVideo = false) => {
    if (busy.current) return;
    if (scanRef.current) { void endScan(true); return; }
    if (walk.current) { finishWalk(); return; }      // the button is "Done" mid-walk
    const isWalk = asVideo || P.current.kind === "walk";
    if (!(await camStart())) {
      // No live camera: fall back to the system camera. No retakes.
      (isWalk ? videoInRef : photoRef).current?.click();
      return;
    }
    setVideoOpt(false);
    if (isWalk && P.current.teach && !asVideo) { void startScan(); return; }
    if (isWalk) camWalk(); else camPhoto();
  };

  const openSegment = async (id: string) => {
    try {
      const out = await get(`/api/storemap/next?store=${encodeURIComponent(S.current)}&segment=${encodeURIComponent(id)}`);
      if (out.prompt) openCapture(out.prompt);
    } catch (e) { toast(e instanceof Error ? e.message : String(e)); }
  };

  const discard = async (seg: string) => {
    try {
      const out = await post("/api/storemap/discard", { store: S.current, segment: seg });
      setResult(r => (r && r.t === "teach" ? { ...r, found: r.found.filter(f => f.segment !== seg) } : r));
      toast(t("capture.takenOff", { label: out.label }));
      await loadView(S.current);
    } catch (e) { toast(e instanceof Error ? e.message : String(e)); }
  };

  const segLabel = (id: string) => {
    const s = (V.current?.segments || []).find(x => x.id === id);
    return s ? s.label : P.current.title || t("capture.thisAisle");
  };

  const onPhoto = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0];
    if (!f || busy.current) return;
    if (P.current.teach) { await teachSend([f], "photo"); return; }
    await send([{ blob: f, segment: P.current.segment }], "photo");
  };
  const onVideo = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0];
    if (!f || busy.current) return;
    setResult({ t: "text", text: t("capture.picking") });
    try {
      const { frames, secs } = await videoFrames(f);
      if (P.current.teach) await teachSend(teachPicks(frames));
      else await sendWalk(frames, secs);
    } catch { setResult({ t: "gentle" }); }
  };

  const next = () => {
    if (P.current.item) { nav.back(); return; }
    const n = V.current?.next;
    if (n) { openCapture(n); return; }
    // Back to the map: the mapper under us if it opened this screen,
    // so its Back does not lead into this finished capture again.
    if (nav.params.from === "mapper") nav.back("mapper");
    else nav.replace("mapper", { store: S.current });
  };
  const outdated = async () => {
    const p = P.current;
    if (!p.segment) return;
    try {
      const out = await post("/api/storemap/outdated", { store: S.current, segment: p.segment });
      toast(t("capture.markedOutOfDate"));
      if (out.prompt) openCapture(out.prompt);
    } catch (e) { toast(e instanceof Error ? e.message : String(e)); }
  };
  const back = (ev: React.MouseEvent) => {
    ev.preventDefault();
    if (scanRef.current) { stopScan(); return; }
    walk.current = null; camStop();
    nav.back("mapper");
  };

  return (
    <>
      <p><a href="#" className="qback" onClick={back}><span aria-hidden="true">‹ </span>{t("common.back")}</a></p>
      <h1 className="largetitle" style={{ fontSize: 26 }} id="cp-title">{prompt.title}</h1>
      <p className="muted" id="cp-why">{prompt.why || ""}</p>
      <div className={"cp-cam" + (scan ? " full" : "")} id="cp-cam" hidden={!camOn}>
        <video id="cp-live" ref={videoRef} playsInline muted autoPlay></video>
        {scan ? (
          <>
            <div className="cp-fs-top">
              <button className="cp-fs-x" id="cp-stop" type="button" aria-label={t("capture.scan.stop")} onClick={stopScan}>✕</button>
              <span className="cp-fs-rec"><i aria-hidden="true"></i>{mmss(scan.el)}</span>
              <span className="cp-fs-store">{S.current.split("|")[0]}</span>
            </div>
            {scan.el < SCAN_TIP_MS && <div className="cp-fs-tip">{t("capture.scan.tip")}</div>}
            {scan.el >= SCAN_SOFT_MS && <div className="cp-fs-tip">{t("capture.scan.long")}</div>}
            <div className="cp-fs-bottom">
              <div className={"cp-fs-coach" + (!scan.ready ? "" : scan.good ? " good" : " warn")} id="cp-coach" aria-live="polite">
                {scan.ready && scan.good ? t("capture.scan.good") : scan.coach}</div>
              <div className="cp-fs-saved">{online ? t("capture.scan.saving") : t("capture.scan.offline")}</div>
              <button className="cp-fs-done" id="cp-done" type="button" onClick={() => void endScan(true)}>{t("capture.done")}</button>
            </div>
          </>
        ) : (
          <>
            <div className={"cp-hint" + (hint.good ? " good" : "")} id="cp-hint" aria-live="polite">{hint.text}</div>
            <div className="cp-parts" id="cp-parts" aria-hidden="true">
              {Array.from({ length: parts.n }, (_, i) => <span key={i} className={i < parts.on ? "on" : ""}></span>)}
            </div>
          </>
        )}
      </div>
      <div className="group pad" id="cp-howto" hidden={camOn}>
        <ol id="cp-steps" className="cpsteps">{(prompt.steps || []).map((step, i) => <li key={i}>{step}</li>)}</ol>
        <p className="muted nomargin" id="cp-time">{t("capture.aboutSeconds", { s: prompt.est_seconds || 10 })}</p>
        {prompt.teach && !result && (
          <label className="cp-opt" htmlFor="cp-prices">
            <input type="checkbox" id="cp-prices" checked={pricesOpt} onChange={e => {
              const on = e.target.checked; setPricesOpt(on);
              try { localStorage.setItem(PRICES_KEY, on ? "1" : "0"); } catch { /* private mode */ }
            }} />
            <span><b>{t("capture.scan.pricesOpt")}</b><small>{t("capture.scan.pricesOptSub")}</small></span>
          </label>
        )}
      </div>
      <p id="cp-controls" hidden={!controls}>
        <button className="btn primary wide" id="cp-go" type="button" disabled={goDisabled} onClick={() => go()}>{goLabel}</button>
        <button className="btn wide" id="cp-govideo" type="button" hidden={!videoOpt} onClick={() => go(true)}>{t("capture.recordAShortVideo")}</button>
        <input type="file" id="cp-photo" ref={photoRef} accept="image/*" capture="environment" hidden onChange={onPhoto} />
        <input type="file" id="cp-video" ref={videoInRef} accept="video/*" capture="environment" hidden onChange={onVideo} />
      </p>
      <div id="cp-result" className="group pad" hidden={!result}>
        {result && <ResultBody r={result} view={view} barW={barW} segLabel={segLabel} onPick={openSegment} onDiscard={discard} />}
      </div>
      <p id="cp-after" hidden={after === null}>
        <button id="cp-next" className="btn primary wide" type="button" onClick={next}>{after}</button>
      </p>
      <p><button id="cp-outdated" className="btn wide" type="button" hidden={!prompt.segment} onClick={outdated}>{t("capture.thisPartOfTheMap")}</button></p>
    </>
  );
}

function ResultBody({ r, view, barW, segLabel, onPick, onDiscard }: {
  r: Result; view: StoreView | null; barW: number | null; segLabel: (id: string) => string;
  onPick: (id: string) => void; onDiscard: (seg: string) => void;
}) {
  const { t } = useTranslation();
  if (r.t === "text") return <>{r.text}</>;
  if (r.t === "gentle") return <p className="nomargin"><Trans i18nKey="capture.gentle" components={{ b: <strong /> }} /></p>;
  if (r.t === "pick") {
    const segs = view?.segments || [];
    return segs.length ? (
      <>
        <p className="nomargin">{t("capture.tapTheAisleYouAre")}</p>
        <div className="rail">{segs.map(s => <button key={s.id} className="chip" data-mpick={s.id} type="button" onClick={() => onPick(s.id)}>{s.label}</button>)}</div>
      </>
    ) : <p className="nomargin">{t("capture.aryaDoesNotKnowThis")}</p>;
  }
  if (r.t === "teach") {
    return (
      <div className="mp-reward">
        <div className="what">{t("capture.aryaFoundSection", { count: r.found.length })}</div>
        <p className="muted">{t("capture.checkThemAWrongOne")}</p>
        {r.found.map(f => (
          <div className="row mp-seg" key={f.segment}>
            <span className="grow"><span className="name">{f.label}</span><span className="sub">{f.created ? t("capture.newSection") : t("capture.alreadyOnMap")}</span></span>
            <button className="btn small" data-tdiscard={f.segment} type="button" onClick={() => onDiscard(f.segment)}>{t("capture.notASection")}<span aria-hidden="true"> ✕</span></button>
          </div>
        ))}
        {r.extra && (r.extra.signs.length > 0 || r.extra.prices.length > 0 || r.extra.people > 0) && (
          <div className="cp-extra">
            {r.extra.signs.length > 0 && <div className="row"><span className="grow">{t("capture.scan.signsRead")}</span><span className="sub">{r.extra.signs.join(" · ")}</span></div>}
            {r.extra.prices.length > 0 && <div className="row"><span className="grow">{t("capture.scan.pricesRead")}</span><span className="sub">{r.extra.prices.map(p => `${p.item} ${p.price.toFixed(2)}`).join(" · ")}</span></div>}
            {r.extra.people > 0 && <div className="row"><span className="grow">{t("capture.scan.peopleBlurred", { count: r.extra.people })}</span></div>}
          </div>
        )}
        {r.pts ? <div className="pts">+{r.pts}</div> : null}
        {r.title ? <div className="mp-title">{t("capture.youReNowA", { title: r.title })}</div> : null}
      </div>
    );
  }
  const { won, last } = r;
  const pts = won.reduce((n, w) => n + w.out.reward.points, 0);
  const fresh = won.filter(w => w.out.reward.new_section);
  const partial = won.some(w => w.out.weak);
  const what = fresh.length > 1 ? t("capture.learnedSections", { n: fresh.length })
    : fresh.length ? t("capture.learned", { name: segLabel(fresh[0].seg) })
    : t("capture.freshAgain");
  const [a, b] = last.store_pct;
  const sized = a !== null && b !== null;
  const goal = last.goal ? t("capture.moreSectionsTo", { count: last.goal.sections_needed, pct: last.goal.pct })
    : sized && b >= 100 ? t("capture.knowsWholeStore") : t("capture.sizeUnknown");
  return (
    <div className="mp-reward">
      <div className="pts">+{pts}</div>
      <div className="what">{what}</div>
      {sized && <div className="muted"><Trans i18nKey="capture.storePct" values={{ a, to: b }} components={{ b: <strong /> }} /></div>}
      {sized && <div className="track" aria-hidden="true"><span className="bar" style={{ transform: `scaleX(${Math.min(100, Math.max(0, barW ?? a ?? 0)) / 100})` }}></span></div>}
      <div className="muted">{goal}</div>
      {last.new_title ? <div className="mp-title">{t("capture.youReNowA", { title: last.new_title })}</div> : null}
      {fresh.length ? <p className="muted">{t("capture.nextHuntHereThisAisle")}</p> : null}
      {partial ? <p className="muted">{t("capture.someOfItWasA")}</p> : null}
    </div>
  );
}
