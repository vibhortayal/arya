import { useEffect, useRef, useState } from "react";
import { get, post } from "../lib/api";
import { useToast } from "../ui/Toast";
import { useTranslation } from "../i18n";
import { addFrame, discardWalk, finishWalk, startWalk, subscribe, WALK_MAX_FRAMES, type QueueState } from "../lib/scanQueue";
import { photoFrame, videoFrames } from "../lib/frames";

/* Map my store after the walk (owner, 2026-10-30): the walk's frames
 * wait on the phone, go up when there is signal, and are read in the
 * background (lib/scanQueue, api/scanjobs.py). This card says where the
 * walk is: saved on the phone, sending, building the map, or ready to
 * check. "Upload a video or photos" feeds the same background read. */

type Found = { segment: string; label: string; created: boolean; fresh: boolean };
export type ScanJob = {
  id: string; store: string; source: string; status: "uploading" | "queued" | "reading" | "ready" | "failed";
  total: number; done: number; received: number; seen: boolean; at: string; error?: string | null;
  result?: { found: Found[]; signs: string[]; prices: { item: string; price: number }[]; people: number;
    skipped: number; pts: number; title: string | null; capped?: boolean } | null;
};

const PRICES_KEY = "arya-scan-prices";
const readPricesOpt = () => { try { return localStorage.getItem(PRICES_KEY) === "1"; } catch { return false; } };
const busy = (j: ScanJob) => j.status === "queued" || j.status === "reading";

/* The walks for one store: on the phone and on the server. Asks the
 * server again every few seconds while a walk is on its way. */
export function useScanJobs(store: string) {
  const [queue, setQueue] = useState<QueueState | null>(null);
  const [jobs, setJobs] = useState<ScanJob[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => subscribe(setQueue), []);
  useEffect(() => {
    const again = () => setTick(n => n + 1);
    window.addEventListener("arya-scan-sent", again);
    return () => window.removeEventListener("arya-scan-sent", again);
  }, []);
  useEffect(() => {
    if (!store) { setJobs([]); return; }
    let live = true;
    get<{ jobs: ScanJob[] }>(`/api/storemap/jobs?store=${encodeURIComponent(store)}`)
      .then(r => { if (live) setJobs(r.jobs || []); }).catch(() => {});
    return () => { live = false; };
  }, [store, tick]);
  const local = (queue?.walks || []).filter(w => w.store === store);
  const waiting = local.length > 0 || jobs.some(busy);
  useEffect(() => {
    if (!waiting) return;
    const id = window.setInterval(() => setTick(n => n + 1), 8000);
    return () => clearInterval(id);
  }, [waiting]);
  return { queue, local, jobs, refresh: () => setTick(n => n + 1) };
}

export function ScanStatus({ store, onMapChanged }: { store: string; onMapChanged: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { queue, local, jobs, refresh } = useScanJobs(store);
  const [checking, setChecking] = useState<ScanJob | null>(null);
  const name = store.split("|")[0];
  const prevBusy = useRef(false);

  const running = jobs.find(busy);
  const ready = jobs.find(j => (j.status === "ready" || j.status === "failed") && !j.seen);
  useEffect(() => {
    // A walk finished while this screen was open: the map changed.
    if (prevBusy.current && !running) onMapChanged();
    prevBusy.current = !!running;
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  const seen = async (j: ScanJob) => {
    try { await post(`/api/storemap/jobs/${j.id}/seen`, {}); } catch { /* the card comes back next time */ }
    setChecking(null); refresh(); onMapChanged();
  };

  let card = null;
  if (local.length) {
    const w = local[0];
    const sending = queue?.sending === w.id && queue.online;
    const left = Math.max(0, (w.sendCount ?? w.frames) - (w.sent || 0));
    card = sending
      ? <Status ic="↑" title={t("mapScan.sendingTitle")} sub={t("mapScan.sendingSub", { sent: w.sent || 0, total: w.sendCount ?? w.frames })} />
      : <Status ic="↻" title={t("mapScan.savedTitle")} sub={t("mapScan.savedSub", { count: left })} />;
  } else if (running) {
    card = <Status ic="↑" title={t("mapScan.buildingTitle", { store: name })}
      sub={t("mapScan.buildingSub", { done: running.done, total: running.total })} />;
  } else if (ready) {
    const found = ready.result?.found || [];
    const fresh = found.filter(f => f.created).length;
    card = ready.status === "failed" || !found.length ? (
      <Status ic="!" title={ready.status === "failed" ? t("mapScan.failedTitle") : t("mapScan.emptyTitle")}
        sub={ready.error || t("mapScan.emptySub")} ready
        action={<button className="btn wide" type="button" onClick={() => seen(ready)}>{t("mapScan.ok")}</button>} />
    ) : (
      <Status ic="✓" title={t("mapScan.readyTitle", { store: name })} sub={t("mapScan.readySub", { count: found.length, fresh })} ready
        action={<button className="btn primary wide" id="mp-check" type="button" onClick={() => setChecking(ready)}>{t("mapScan.check", { count: found.length })}</button>} />
    );
  }

  const discard = async (seg: string) => {
    try {
      const out = await post("/api/storemap/discard", { store, segment: seg });
      toast(t("capture.takenOff", { label: out.label }));
      setChecking(c => c && c.result ? { ...c, result: { ...c.result, found: c.result.found.filter(f => f.segment !== seg) } } : c);
      onMapChanged();
    } catch (e) { toast(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <>
      {card}
      {checking && checking.result && (
        <div className="sheetwrap" role="dialog" aria-modal="true" aria-labelledby="ms-check-h" onClick={e => { if (e.target === e.currentTarget) void seen(checking); }}>
          <div className="sheet ms-check">
            <div className="mp-reward">
              <div className="what" id="ms-check-h">{t("capture.aryaFoundSection", { count: checking.result.found.length })}</div>
              <p className="muted">{t("capture.checkThemAWrongOne")}</p>
              {checking.result.found.map(f => (
                <div className="row mp-seg" key={f.segment}>
                  <span className="grow"><span className="name">{f.label}</span><span className="sub">{f.created ? t("capture.newSection") : t("capture.alreadyOnMap")}</span></span>
                  <button className="btn small" type="button" onClick={() => discard(f.segment)}>{t("capture.notASection")}<span aria-hidden="true"> ✕</span></button>
                </div>
              ))}
              {(checking.result.signs.length > 0 || checking.result.prices.length > 0 || checking.result.people > 0) && (
                <div className="cp-extra">
                  {checking.result.signs.length > 0 && <div className="row"><span className="grow">{t("capture.scan.signsRead")}</span><span className="sub">{checking.result.signs.join(" · ")}</span></div>}
                  {checking.result.prices.length > 0 && <div className="row"><span className="grow">{t("capture.scan.pricesRead")}</span><span className="sub">{checking.result.prices.map(p => `${p.item} ${p.price.toFixed(2)}`).join(" · ")}</span></div>}
                  {checking.result.people > 0 && <div className="row"><span className="grow">{t("capture.scan.peopleBlurred", { count: checking.result.people })}</span></div>}
                </div>
              )}
              {checking.result.pts ? <div className="pts">+{checking.result.pts}</div> : null}
              {checking.result.title ? <div className="mp-title">{t("capture.youReNowA", { title: checking.result.title })}</div> : null}
            </div>
            <p><button className="btn primary wide" id="ms-check-done" type="button" onClick={() => seen(checking)}>{t("mapScan.looksRight")}</button></p>
          </div>
        </div>
      )}
    </>
  );
}

function Status({ ic, title, sub, ready, action }: { ic: string; title: string; sub: string; ready?: boolean; action?: React.ReactNode }) {
  return (
    <div className={"group pad ms-status" + (ready ? " ready" : "")} id="ms-status" aria-live="polite">
      <div className="ms-row"><span className="ms-ic" aria-hidden="true">{ic}</span>
        <span className="grow"><b>{title}</b><span>{sub}</span></span></div>
      {action && <div className="ms-act">{action}</div>}
    </div>
  );
}

/* "Upload a video or photos": for a shopper who already filmed the
 * store. Frames are picked on the phone; the video never leaves it. */
export function UploadWalk({ store, onClose }: { store: string; onClose: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [mine, setMine] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const name = store.split("|")[0];

  const pick = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(ev.target.files || [])];
    ev.target.value = "";
    if (!files.length) return;
    setProgress(t("mapScan.upload.picking"));
    let w;
    try { w = await startWalk(store, "upload", readPricesOpt()); }
    catch { setProgress(null); toast(t("capture.scan.noStorage")); return; }
    try {
      const videos = files.filter(f => f.type.startsWith("video/"));
      const photos = files.filter(f => !f.type.startsWith("video/")).slice(0, WALK_MAX_FRAMES);
      for (const [i, f] of photos.entries()) {
        const b = await photoFrame(f);
        if (b) await addFrame(w, b);
        setProgress(t("mapScan.upload.photos", { done: i + 1, total: photos.length }));
      }
      const room = Math.max(0, WALK_MAX_FRAMES - w.frames);
      for (const v of videos) {
        if (!room) break;
        const blobs = await videoFrames(v, Math.max(1, Math.floor(room / videos.length)),
          (d, n) => setProgress(t("mapScan.upload.video", { pct: Math.round(100 * d / n) })));
        for (const b of blobs) await addFrame(w, b);
      }
      if (!w.frames) { await discardWalk(w); setProgress(null); toast(t("mapScan.upload.nothing")); return; }
      await finishWalk(w);
      toast(t("capture.scan.sent"));
      onClose();
    } catch {
      await discardWalk(w).catch(() => {});
      setProgress(null);
      toast(t("capture.badVideo"));
    }
  };

  return (
    <div className="sheetwrap" role="dialog" aria-modal="true" aria-labelledby="ms-up-h" onClick={e => { if (e.target === e.currentTarget && !progress) onClose(); }}>
      <div className="sheet" id="ms-upload">
        <div className="sheethead"><h2 id="ms-up-h" className="ms-h">{t("mapScan.upload.title")}</h2>
          <button className="btn small" type="button" onClick={onClose} disabled={!!progress}>{t("common.close")}</button></div>
        <p className="muted">{t("mapScan.upload.why", { store: name })}</p>
        <label className="cp-opt" htmlFor="ms-mine">
          <input type="checkbox" id="ms-mine" checked={mine} onChange={e => setMine(e.target.checked)} />
          <span><b>{t("mapScan.upload.mine")}</b><small>{t("mapScan.upload.mineSub")}</small></span>
        </label>
        {progress && <p className="muted" aria-live="polite" id="ms-up-progress">{progress}</p>}
        <p style={{ marginTop: 16 }}>
          <button className="btn primary wide" id="ms-up-pick" type="button" disabled={!mine || !!progress} onClick={() => input.current?.click()}>{t("mapScan.upload.choose")}</button>
          <input ref={input} type="file" accept="video/*,image/*" multiple hidden onChange={pick} />
        </p>
      </div>
    </div>
  );
}
