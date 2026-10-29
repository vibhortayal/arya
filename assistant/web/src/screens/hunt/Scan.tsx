import { useEffect, useRef, useState } from "react";
import { QFRESH, freshKey, type Session } from "./model";
import { useTranslation } from "../../i18n";

/* Shelf Scan (quest.js Discussion 37: openScanView .. closeScan), shared
 * by the hunt and Express. SAM proposes boxes for the remaining list,
 * Spark verifies, verified items pop over the view; tapping a pop
 * collects it through the screen's own collect(). Two feed shapes,
 * one endpoint: STILL (one photo) and LIVE (the viewfinder, still
 * frames sent as the view settles). The camera never outlives the
 * overlay or the screen. With target set it is "Find it for me". */

export type Pop = { item: string; box: [number, number, number, number]; grade?: string };
type ScanPop = Pop & { got?: boolean; busy?: boolean };

export const SCAN_NO_POP = "Nothing from your list spotted here — that doesn't mean it isn't here. Keep looking.";
const SCAN_TICK_MS = 250;
const SCAN_DIFF = 0.06;
const SCAN_SETTLE_EPS = 0.02;
const SCAN_HOLD_MS = 1000;
const SCAN_FLOOR_MS = 3000;
const SCAN_CEIL_MS = 2000;
const SCAN_CLEAR = 0.18;

/* The sampling policy (unit-pinned in quest.js). */
export function createScanSampler() {
  let lastSentAt: number | null = null, holdSince: number | null = null, clearStreak = 0, clearArmed = true;
  return {
    noteFrame(diffPrev: number, diffSent: number, now: number) {
      let clear = false;
      if (diffSent >= SCAN_CLEAR) {
        clearStreak++;
        if (clearStreak >= 2 && clearArmed) { clear = true; clearArmed = false; }
      } else { clearStreak = 0; clearArmed = true; }
      let send = false;
      if (diffSent >= SCAN_DIFF) {
        if (diffPrev < SCAN_SETTLE_EPS) { if (holdSince === null) holdSince = now; }
        else holdSince = null;
        const held = holdSince !== null && now - holdSince >= SCAN_HOLD_MS;
        if (held && (lastSentAt === null || now - lastSentAt >= SCAN_FLOOR_MS)) send = true;
        else if (!held && holdSince === null && diffPrev >= SCAN_DIFF && lastSentAt !== null && now - lastSentAt >= SCAN_CEIL_MS) send = true;
      } else holdSince = null;
      return { send, clear };
    },
    noteSent(now: number) { lastSentAt = now; holdSince = null; },
    reset() { lastSentAt = null; holdSince = null; clearStreak = 0; clearArmed = true; },
  };
}

function frameArray(video: HTMLVideoElement, c: HTMLCanvasElement): Float32Array | null {
  c.width = 48; c.height = 36;
  const ctx = c.getContext && c.getContext("2d", { willReadFrequently: true } as any) as CanvasRenderingContext2D | null;
  if (!ctx || !ctx.getImageData) return null;
  ctx.drawImage(video, 0, 0, 48, 36);
  const d = ctx.getImageData(0, 0, 48, 36).data;
  const arr = new Float32Array(48 * 36);
  for (let i = 0; i < arr.length; i++) arr[i] = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) / 255;
  return arr;
}
function arrDiff(a: Float32Array, b: Float32Array) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

type Props = {
  open: boolean;
  sess: Session;
  target: string | null;
  onClose: () => void;
  /* Collect one popped item; true when it went in the cart. */
  collect: (name: string) => Promise<boolean>;
  /* Pops from a finished scan (the hunt pins them on their rows). */
  onPops?: (pops: Pop[]) => void;
};

export function ScanView({ open, sess, target, onClose, collect, onPops }: Props) {
  const { t } = useTranslation();
  const [mode, setModeS] = useState<"starting" | "live" | "still">("still");
  const [url, setUrl] = useState("");
  const [pops, setPops] = useState<ScanPop[]>([]);
  const [status, setStatus] = useState("");
  const [last, setLast] = useState<Date | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const photo = useRef<HTMLInputElement>(null);
  const R = useRef({
    mode: "still" as string, stream: null as MediaStream | null, timer: 0, wake: null as any, busy: false,
    sampler: null as ReturnType<typeof createScanSampler> | null, prev: null as Float32Array | null,
    sent: null as Float32Array | null, popsShown: false, canvas: null as HTMLCanvasElement | null,
    open: false, url: "", gen: 0,
  });
  const live = useRef({ sess, target, onPops });
  live.current = { sess, target, onPops };
  const setMode = (m: "starting" | "live" | "still") => { R.current.mode = m; setModeS(m); };

  const stopLive = () => {
    const r = R.current;
    if (r.timer) { clearInterval(r.timer); r.timer = 0; }
    if (r.stream) { r.stream.getTracks().forEach(t => t.stop()); r.stream = null; }
    if (r.wake) { const w = r.wake; r.wake = null; if (w.release) w.release().catch(() => {}); }
    if (video.current) video.current.srcObject = null;
    if (r.mode === "live") setMode("still");
  };

  const statusFor = (n: number) => {
    const t = live.current.target;
    if (t) return n ? `Found it! ${t} is highlighted — tap it to grab.`
      : `Didn't spot ${t} in this view — try a little closer or another angle. That doesn't mean it isn't here.`;
    return n ? `${n} from your list spotted here — tap one to collect it.` : SCAN_NO_POP;
  };
  const showPops = (list: Pop[]) => {
    setPops(list);
    R.current.popsShown = list.length > 0;
    setStatus(statusFor(list.length));
    if (list.length) live.current.onPops?.(list);
  };

  const request = async (body: Blob) => {
    const s = live.current.sess, t = live.current.target;
    const aim = t ? `&item=${encodeURIComponent(t)}` : "";
    const r = await fetch(`/api/quest/scan-shelf?session=${encodeURIComponent(s.id)}${aim}`, {
      method: "POST", headers: { "Content-Type": body.type || "image/jpeg" }, body,
    });
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { detail?: string }).detail || `HTTP ${r.status}`);
    const out = (await r.json()) as { pops?: Pop[] };
    (out.pops || []).forEach(p => { delete QFRESH[freshKey(s.store, p.item)]; });
    return out;
  };

  const sendFrame = (v: HTMLVideoElement, arr: Float32Array) => {
    const r = R.current, gen = r.gen;
    r.busy = true;
    r.sampler!.noteSent(performance.now());
    const fail = () => {
      r.busy = false;
      if (r.mode === "live" && !r.popsShown) setStatus("That scan didn't work — still looking.");
    };
    let c: HTMLCanvasElement;
    try {
      c = document.createElement("canvas");
      const scale = Math.min(1, 1280 / (v.videoWidth || 1280));
      c.width = Math.round((v.videoWidth || 1280) * scale);
      c.height = Math.round((v.videoHeight || 960) * scale);
      const ctx = c.getContext && c.getContext("2d");
      if (!ctx || !c.toBlob) { fail(); return; }
      ctx.drawImage(v, 0, 0, c.width, c.height);
    } catch { fail(); return; }
    c.toBlob(async blob => {
      if (!blob) { fail(); return; }
      try {
        const out = await request(blob);
        r.busy = false;
        if (r.mode !== "live" || r.gen !== gen) return;
        r.sent = arr;
        showPops(out.pops || []);
        setLast(new Date());
      } catch { fail(); }
    }, "image/jpeg", 0.85);
  };

  const tick = () => {
    const r = R.current, v = video.current;
    if (r.mode !== "live" || !r.sampler || !v) return;
    if (v.readyState !== undefined && v.readyState < 2) return;
    if (!r.canvas) r.canvas = document.createElement("canvas");
    const arr = frameArray(v, r.canvas);
    if (!arr) return;
    const diffPrev = r.prev ? arrDiff(arr, r.prev) : 0;
    const diffSent = r.sent ? arrDiff(arr, r.sent) : 1;
    r.prev = arr;
    const d = r.sampler.noteFrame(diffPrev, diffSent, performance.now());
    if (d.clear && r.popsShown) {
      setPops([]);
      r.popsShown = false;
      setStatus("Live scan — looking…");
    }
    if (d.send && !r.busy) sendFrame(v, arr);
  };

  const startLive = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("no camera");
    const gen = R.current.gen;
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    const r = R.current;
    if (!r.open || r.gen !== gen) { stream.getTracks().forEach(t => t.stop()); return; }
    r.stream = stream;
    const v = video.current;
    if (v) {
      v.srcObject = stream;
      try { await v.play(); } catch { /* frames still read once playing */ }
    }
    // Closed (or reopened) while the video started: let the camera go.
    if (!r.open || r.gen !== gen) {
      stream.getTracks().forEach(t => t.stop());
      if (r.stream === stream) { r.stream = null; if (v && v.srcObject === stream) v.srcObject = null; }
      return;
    }
    setMode("live");
    r.sampler = createScanSampler();
    r.prev = null; r.sent = null; r.busy = false;
    setStatus("Live scan — point the camera at a shelf.");
    if (r.timer) clearInterval(r.timer);
    r.timer = window.setInterval(tick, SCAN_TICK_MS);
    const wl = (navigator as any).wakeLock;
    if (wl) {
      let w: any = null;
      try { w = await wl.request("screen"); } catch { w = null; }
      if (!r.open || r.gen !== gen || r.stream !== stream) { if (w && w.release) w.release().catch(() => {}); return; }
      r.wake = w;
    }
  };

  // Open: reset and try the live camera; closing releases it, always.
  useEffect(() => {
    const r = R.current;
    r.open = open;
    if (!open) { r.gen++; stopLive(); return; }
    r.gen++;
    setPops([]);
    r.popsShown = false;
    setLast(null);
    setStatus(live.current.target ? `Point the camera at the shelf — looking for ${live.current.target}…` : "Starting the camera…");
    setMode("starting");
    startLive().catch(() => {
      if (!R.current.open) return;
      setMode("still");
      setStatus("Camera not available here — take or choose a photo instead.");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => () => {
    R.current.open = false;
    stopLive();
    if (R.current.url) URL.revokeObjectURL(R.current.url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The platform drops the wake lock when the page hides; re-take it.
  useEffect(() => {
    const onVis = () => {
      const r = R.current, wl = (navigator as any).wakeLock;
      if (document.visibilityState === "visible" && r.mode === "live" && !r.wake && wl) {
        wl.request("screen").then((w: any) => { r.wake = w; }).catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const still = async (file: File) => {
    const r = R.current;
    setMode("still");
    stopLive();
    if (r.url) URL.revokeObjectURL(r.url);
    r.url = URL.createObjectURL(file);
    setUrl(r.url);
    setPops([]);
    r.popsShown = false;
    setStatus(live.current.target ? `Looking for ${live.current.target} on this shelf…` : "Looking for your list on this shelf…");
    const gen = r.gen;
    try {
      const out = await request(file);
      if (!r.open || r.gen !== gen) return;
      showPops(out.pops || []);
      setLast(new Date());
    } catch {
      setStatus("That scan didn't work — close and try again.");
    }
  };

  const tapPop = async (k: number) => {
    const p = pops[k];
    if (!p || p.got || p.busy) return;
    setPops(ps => ps.map((x, j) => (j === k ? { ...x, busy: true } : x)));
    const ok = await collect(p.item).catch(() => false);
    setPops(ps => ps.map((x, j) => (j === k ? { ...x, busy: false, got: ok || x.got } : x)));
  };

  const isLive = mode === "live";
  const lastLine = last
    ? `${isLive ? "Live scan · " : ""}Last scan ${last.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`
    : "";

  return (
    <>
      <input id="scan-photo" ref={photo} type="file" accept="image/*" capture="environment" hidden
        onChange={ev => { const f = ev.target.files?.[0]; if (f) still(f); }} />
      <div id="scan-overlay" className="scanoverlay" hidden={!open}>
        <div className="scanbar">
          <div className="grow">
            <span className="name">{t("hunt.shelfScan")}</span>
            <span className="sub">{t("hunt.spotsItemsFromYourList")}</span>
            <span className="sub" id="scan-last">{lastLine}</span>
          </div>
          <button id="scan-usephoto" className="btn" type="button" hidden={isLive} onClick={() => photo.current?.click()}>{t("hunt.takeAPhoto")}</button>
          <button id="scan-stop" className="btn" type="button" hidden={!isLive} onClick={() => { stopLive(); setStatus("Live scan stopped."); }}>{t("hunt.stop")}</button>
          <button id="scan-close" className="cornerbtn" type="button" aria-label={t("hunt.closeScan")}
            onClick={() => { stopLive(); if (photo.current) photo.current.value = ""; onClose(); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="scanstage">
          <div className="scanwrap">
            <video id="scan-video" ref={video} playsInline muted hidden={!isLive} />
            <img id="scan-img" alt={t("hunt.yourShelfPhoto")} hidden={isLive || !url} src={url || undefined} />
            <div id="scan-boxes">
              {pops.map((p, k) => {
                const [x1, y1, x2, y2] = p.box;
                return (
                  <button key={k} className={"scanpop" + (p.grade === "region" ? " region" : "") + (p.got ? " got" : "")} type="button"
                    data-item={p.item} disabled={p.busy}
                    style={{ left: `${x1 * 100}%`, top: `${y1 * 100}%`, width: `${(x2 - x1) * 100}%`, height: `${(y2 - y1) * 100}%` }}
                    onClick={() => tapPop(k)}>
                    <span className="poplabel">{p.got ? `${p.item} ✓` : p.item + (p.grade === "region" ? " · this shelf" : "")}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <p id="scan-status" className="scanstatus">{status}</p>
      </div>
    </>
  );
}
