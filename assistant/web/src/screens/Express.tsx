import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNav } from "../app/nav";
import { useToast } from "../ui/Toast";
import { Sheet } from "../ui/Sheet";
import { SceneView, type SceneDriver } from "../ui/Scene";
import { IconCheck, IconMic } from "../ui/icons";
import { Empty } from "../ui/kit";
import { get, post } from "../lib/api";
import { qtyFmt, qtyTag } from "../lib/format";
import { storePhotos } from "../lib/stores";
import { startCapture, transcribeBlob, voiceSupported, type Capture } from "../lib/recorder";
import {
  Q, QMODE_LABEL, qCheck, qFlushOutbox, qIsReportedByMe, qLoadSessions, qLoadStoreReports, qNextIndex, qProgress,
  qSetState, qStops, type Item, type Session,
} from "./hunt/model";
import { leaveItems, restoreItems } from "./hunt/menu";
import { ScanView } from "./hunt/Scan";

/* Port of pwa/index.html #view-express with quest.js openExpress,
 * renderExpress, qExpPaintHelp, qExpToggle, qExpEnsurePlaying and
 * qExpListHtml: a plain grocery checklist in walking order. Each row is
 * the check. The next item carries a help row (Show me, Not here?, Find
 * with camera); More help opens Ask Arya and Teach Arya. Reads
 * nav.params.session. Finish goes to nav.show("finish", { session }).
 *
 * The run shares the hunt's state and calls (hunt/model: Q, qCheck,
 * qSetState and the offline outbox), the leave/restore changes
 * (hunt/menu) and the Shelf Scan (hunt/Scan). The sheets are ported
 * here as local pieces: huntmenu.js movedSheet and leaveSheet (the
 * "Can't find it?" and "Leave for next time?" sheets), quest.js
 * openSpotSheet / sendSpotReport (Not here report), huntask.js (Ask
 * Arya) and mapper.js mapperTeachNow. */

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const SPOT_KINDS: [string, string][] = [
  ["empty_shelf", "Empty shelf — its tag is still there"],
  ["replaced", "Something else here now"],
  ["wrong_aisle", "It is in a different aisle"],
  ["cant_tell", "Can’t tell"],
];

const PauseSvg = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M9 5v14M15 5v14" /></svg>;
const PlaySvg = () => <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><path d="M8 5l11 7-11 7z" /></svg>;

export function Express() {
  const nav = useNav();
  const { toast, hide: hideToast } = useToast();
  const sessRef = useRef<Session | undefined>(nav.params.session as Session | undefined);
  const sess = sessRef.current;
  const [, setTick] = useState(0);
  const repaint = useCallback(() => setTick(n => n + 1), []);
  const [rail, setRail] = useState<Session[]>([]);
  const [scan, setScan] = useState<{ target: string | null } | null>(null);
  const [show, setShow] = useState(false);
  const [more, setMore] = useState(false);
  const [moved, setMoved] = useState<string | null>(null);
  const [spot, setSpot] = useState<string | null>(null);
  const [spotBusy, setSpotBusy] = useState<string | null>(null);
  const [leave, setLeave] = useState<Item[] | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const live = useRef(true);
  const root = useRef<HTMLDivElement>(null);
  const driver = useRef<SceneDriver | null>(null);

  /* openExpress: the run is Q.current, so the outbox flush, qCheck and
   * the leave changes repaint this screen. */
  useEffect(() => {
    live.current = true;
    if (sess) {
      Q.current = sess;
      Q.repaint = repaint;
      Q.notify = toast;
      Q.followHold = false;
      Q.scanTarget = null;
      qFlushOutbox();
    }
    return () => {
      live.current = false;
      Q.scanTarget = null;
      if (Q.repaint === repaint) { Q.repaint = null; Q.notify = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* The run is a full-screen frame (quest.js paintHuntFrame): the tab
   * bar, avatar and demo bar hide, the view drops its bottom padding. */
  useEffect(() => {
    nav.setChrome(false);
    document.body.classList.add("hunting");
    const section = root.current?.closest("section");
    section?.classList.add("full");
    return () => {
      nav.setChrome(true);
      document.body.classList.remove("hunting");
      section?.classList.remove("full");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadReports = useCallback(async () => {
    if (!sessRef.current) return;
    await qLoadStoreReports(sessRef.current.store);
    if (live.current) repaint();
  }, [repaint]);
  const loadRail = useCallback(async () => {
    try { const list = await qLoadSessions(); if (live.current) setRail(list); } catch { /* the rail stays empty */ }
  }, []);
  useEffect(() => { loadReports(); loadRail(); }, [loadReports, loadRail]);

  const reports = Q.storeReports;
  const next = sess ? qNextIndex(sess) : -1;
  const prog = sess ? qProgress(sess) : { done: 0, total: 0, left: 0 };
  const stops = useMemo(() => (sess ? qStops(sess) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sess, reports, sess?.items.map(i => (i.checked ? 1 : 0) + i.name).join("|")]);
  const photos = sess ? storePhotos(sess.store) : null;
  const sceneOn = show && next >= 0;

  /* ---- the run ---- */
  const toggle = async (item: Item) => {
    if (!sess) return;
    try {
      if (sess.state === "not_started") await qSetState(sess, "playing");
      if (sess.state === "paused") { toast("The run is paused — resume first."); return; }
      await qCheck(sess, item.name, !item.checked);
      repaint();
      if (qProgress(sess).left === 0) toast("All checked. Finish with the receipt.");
    } catch (e) { toast(errText(e)); }
  };
  /* Not here? and Find with camera need a live run: the first tap on
   * either starts it, a paused run asks to resume. */
  const ensurePlaying = async () => {
    if (!sess) return false;
    try {
      if (sess.state === "not_started") await qSetState(sess, "playing");
      if (sess.state === "paused") { toast("The run is paused — resume first."); return false; }
      repaint();
      return sess.state === "playing";
    } catch (e) { toast(errText(e)); return false; }
  };
  const pause = async () => {
    if (!sess) return;
    try {
      const to = sess.state === "paused" ? "playing" : "paused";
      await qSetState(sess, to);
      repaint();
      if (to === "playing" && driver.current?.glideTo && next >= 0) driver.current.glideTo(next);
    } catch (e) { toast(errText(e)); }
  };

  /* ---- Shelf Scan (hunt/Scan, quest.js openScanView) ---- */
  const openScan = (target: string | null) => { Q.scanTarget = target; setScan({ target }); };
  const closeScan = () => { Q.scanTarget = null; setScan(null); };
  /* Tapping a pop collects that item. */
  const scanCollect = async (name: string): Promise<boolean> => {
    const s = sessRef.current;
    if (!s) return false;
    if (s.state !== "playing") { toast("Start the hunt first."); return false; }
    const key = s.id + "|" + name;
    if (Q.grabbing.has(key)) return false;
    Q.grabbing.add(key);
    try {
      await qCheck(s, name, true);
      repaint();
      if (Q.scanTarget === name && s.items.some(i => !i.checked)) setTimeout(closeScan, 700);
      if (qNextIndex(s) === -1) { closeScan(); toast("All checked. Finish with the receipt."); }
      return true;
    } catch (e) { toast(errText(e)); return false; }
    finally { Q.grabbing.delete(key); }
  };

  /* ---- help row ---- */
  const notHere = async () => {
    if (!sess || next < 0 || !(await ensurePlaying())) return;
    setMoved(sess.items[next].name);
  };
  const findWithCamera = async (name?: string) => {
    if (!sess) return;
    const i = name ? sess.items.findIndex(x => x.name === name) : next;
    if (i < 0) return;
    if (!name && !(await ensurePlaying())) return;
    openScan(sess.items[i].name);
  };
  const teach = async () => {
    if (!sess || !sess.store) return;
    const items = sess.items.filter(i => !i.checked).map(i => i.name).slice(0, 30);
    let p: { segment?: string } | null = null;
    try {
      const out = await get(`/api/storemap/next?store=${encodeURIComponent(sess.store)}&items=${encodeURIComponent(items.join(","))}`);
      p = out && out.prompt && out.prompt.segment ? out.prompt : null;
    } catch { p = null; }
    if (!p) { toast("Arya already knows every aisle of this store."); return; }
    nav.show("capture", { prompt: p, store: sess.store, from: "express" });
  };

  /* ---- Not here: the Spotter report (quest.js sendSpotReport) ---- */
  const withdraw = async (name: string) => {
    if (!sess) return false;
    const NO_SIGNAL = "No signal. Tap it again when you are back online.";
    if (navigator.onLine === false) { toast(NO_SIGNAL); return false; }
    try { Object.assign(sess, await post(`/api/quest/sessions/${sess.id}/withdraw-report`, { item: name })); }
    catch (e) { toast(e instanceof TypeError ? NO_SIGNAL : errText(e)); return false; }
    await loadReports();
    return true;
  };
  const sendSpot = async (kind: string) => {
    if (!sess || !spot || spotBusy) return;
    const name = spot;
    setSpotBusy(kind);
    try {
      const rep = await post(`/api/quest/sessions/${sess.id}/report-missing`, { item: name, kind });
      setSpot(null);
      const task = rep && rep.map_task;
      if (task && task.prompt) {
        toast("Show Arya the shelf? It learns where things moved.", { action: "Open camera",
          onAction: () => nav.show("capture", { prompt: task.prompt, store: sess.store, from: "express" }) });
      } else {
        toast("Thanks. You just saved the next shopper a trip down the aisle.", { action: "Undo", onAction: async () => {
          if (await withdraw(name)) { repaint(); toast("Report taken back."); }
        } });
      }
      await loadReports();
    } catch (e) { toast(errText(e)); }
    setSpotBusy(null);
  };

  /* ---- Finish: leave sheet when items are still open (huntmenu.js) ---- */
  const openFinish = () => { hideToast(); nav.show("finish", { session: sess }); };
  const finish = () => {
    if (!sess) return;
    const open = sess.items.filter(i => !i.checked && !qIsReportedByMe(sess, i));
    if (!open.length) { openFinish(); return; }
    const all = sess.items.filter(i => !i.checked);
    setChoice(Object.fromEntries(all.map(i => [i.name, "saved"])));
    setLeave(all);
  };
  /* Online first, the outbox when the signal is gone (hunt/menu). */
  const checkout = async () => {
    if (!sess || !leave) return;
    setLeaveBusy(true);
    const entries = leave.map(it => ({ item: it.name, how: choice[it.name] || "saved" }));
    const moved = await leaveItems(toast, sess, entries);
    setLeaveBusy(false);
    if (!moved) return;
    setLeave(null);
    openFinish();
    toast(`${moved.length} left for next time.`, { action: "Undo", onAction: async () => {
      await restoreItems(toast, sess, moved);
      if (live.current) repaint();
      // Undone from the receipt screen: back to the run (as the hunt does).
      const fin = document.getElementById("view-finish");
      if (fin && !fin.hidden) nav.back();
    } });
  };

  /* ---- Ask Arya (huntask.js) ---- */
  const askContext = () => {
    if (!sess) return {};
    const it = next >= 0 ? sess.items[next] : null;
    const ctx: Record<string, unknown> = { hunt: sess.store, left: sess.items.filter(x => !x.checked).map(x => x.name).slice(0, 12) };
    if (it) { ctx.next_item = it.name; if (it.shelf_label) ctx.aisle = it.shelf_label; }
    return ctx;
  };

  if (!sess) return <></>;

  const rows: ReactNode[] = sess.items.map((it, i) => {
    const s = stops[i];
    return (
      <button key={"r:" + it.name} type="button" data-exp-check={it.name} aria-pressed={!!it.checked}
        className={"row listrow exprow" + (it.checked ? " checked" : "") + (i === next ? " next" : "")}
        onClick={() => toggle(it)}>
        <span className="check" aria-hidden="true"><IconCheck /></span>
        <span className="grow"><span className="name">{it.name}</span>
          {s?.shelfLabel ? <span className="sub">{s.shelfLabel}</span> : null}
          {s?.flagged ? <span className="repflag">Reported missing at this store.</span> : null}</span>
        <span className="money">{it.unit ? qtyTag(it) : "× " + qtyFmt(it.qty)}</span>
      </button>
    );
  });

  const helpRow = (
    <div key="help" id="exp-help" className="exphelp" hidden={next < 0}>
      <div className="exphelp-btns">
        <button id="exp-show" className="chip" type="button" aria-pressed={sceneOn} onClick={() => setShow(v => !v)}>{sceneOn ? "Hide" : "Show me"}</button>
        <button id="exp-nothere" className="chip" type="button" onClick={notHere}>Not here?</button>
        <button id="exp-find" className="chip" type="button" onClick={() => findWithCamera()}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6H8l1.3-2h5.4L16 6h1.5A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-8z" /><circle cx="12" cy="12.5" r="3.2" /></svg>Find with camera</button>
      </div>
      <div id="exp-photo" hidden={!sceneOn}>
        {sceneOn && (
          <SceneView id="exp-mount" className="storeview mini" driver={photos ? "photo" : "strip"} photos={photos} model={null}
            stops={stops} next={next} glide onDriver={d => { driver.current = d; if (d) d.onTapStop = null; }} />
        )}
        <p className="muted nomargin" id="exp-photo-cap">{photos
          ? "A real photo from this store. The dot marks this item."
          : "This store has no photos yet. The card shows the shelf."}</p>
      </div>
    </div>
  );
  /* The help row sits under the next item. It is a keyed sibling that
   * moves with the next item, never rebuilt, so the mounted photo
   * survives every repaint of the list. */
  const listChildren: ReactNode[] = [];
  rows.forEach((r, i) => { listChildren.push(r); if (i === next) listChildren.push(helpRow); });
  const paused = sess.state === "paused";

  return (
    <>
      <div className="hunthud" ref={root}>
        <a href="#" className="qback hudback" aria-label="Back" onClick={e => { e.preventDefault(); nav.back("community"); }}>&lsaquo;</a>
        <span className="hchip grow" id="exp-store">{`${sess.store} · ${QMODE_LABEL[sess.mode] || sess.mode}`}</span>
        <span className="hchip prog" id="exp-count">{`${prog.done}/${prog.total}`}</span>
        <button id="exp-pause" className="hudbtn" type="button" aria-label={paused ? "Resume" : "Pause"}
          disabled={sess.state === "not_started"} onClick={pause}>{paused ? <PlaySvg /> : <PauseSvg />}</button>
      </div>
      <p className="walk-label">In walking order. Tap a row to check it off.</p>
      <div id="exp-items" className="group">
        {listChildren.length ? listChildren : <Empty>The list is empty.</Empty>}
      </div>
      {next < 0 && helpRow}
      <p className="nomargin"><button id="exp-more" className="linkbtn" type="button" aria-expanded={more} aria-controls="exp-more-list"
        onClick={() => setMore(v => !v)}>More help</button></p>
      <div id="exp-more-list" className="exphelp-btns" hidden={!more}>
        <button id="exp-ask" className="chip" type="button" onClick={() => setAskOpen(true)}>Ask Arya</button>
        <button id="exp-teach" className="chip" type="button" onClick={teach}>Teach Arya your store</button>
      </div>
      <p><button id="exp-finish" className="btn primary wide" type="button" disabled={sess.state === "not_started"} onClick={finish}>Finish &rarr;</button></p>
      <div id="exp-rail" className="rail" aria-label="Today's hunts">
        {rail.map(s0 => {
          const s = s0.id === sess.id ? sess : s0;
          const p = qProgress(s);
          return (
            <button key={s.id} className="chip" type="button" data-rail={s.id} aria-pressed={s.id === sess.id}
              onClick={() => {
                if (s.id === sess.id) return;
                if (s.state === "done" || s.state === "finished") nav.show("score", { session: s });
                else nav.show(s.mode === "express" ? "express" : "hunt", { session: s });
              }}>{s.store} · {p.done}/{p.total}</button>
          );
        })}
      </div>

      <ScanView open={!!scan} sess={sess} target={scan ? scan.target : null} onClose={closeScan} collect={scanCollect} />

      <Sheet open={moved !== null} onClose={() => setMoved(null)} id="hunt-sheet" labelledBy="hm-title">
        {moved !== null && (() => {
          const i = sess.items.findIndex(x => x.name === moved);
          const stop = i >= 0 ? stops[i] : null;
          return (
            <>
              <h3 className="hm-title" id="hm-title">Can&apos;t find {moved}?</h3>
              <p className="sub hm-sub">Last seen: {stop && stop.shelfLabel ? stop.shelfLabel : "not placed on the map yet"}. Check the end caps too.</p>
              <button type="button" className="btn primary wide hm-main" data-act="find" data-first
                onClick={() => { setMoved(null); findWithCamera(moved); }}>Find it for me</button>
              <button type="button" className="btn wide" data-act="tell"
                onClick={() => { setMoved(null); setSpot(moved); }}>Tell other shoppers it is gone</button>
              <button type="button" className="btn wide" data-act="keep" onClick={() => setMoved(null)}>Keep looking</button>
            </>
          );
        })()}
      </Sheet>

      <Sheet open={spot !== null} onClose={() => setSpot(null)} id="spot-sheet">
        <span className="sheetgrip" aria-hidden="true"></span>
        <div className="row"><span className="name">Not here</span></div>
        <p className="muted" id="spot-item">At the stop for {spot} — what do you see?</p>
        <div className="actions" style={{ flexDirection: "column", alignItems: "stretch" }}>
          {SPOT_KINDS.map(([kind, label], k) => (
            <button key={kind} className="chip" data-kind={kind} aria-pressed={spotBusy === kind} type="button"
              data-first={k === 0 ? true : undefined} onClick={() => sendSpot(kind)}>{label}</button>
          ))}
        </div>
        <p className="muted nomargin">Tap what you see and the report is sent. Tap outside or drag down to close. A report flags the stop for other hunters. It changes nothing until time and other hunters settle what happened.</p>
      </Sheet>

      <Sheet open={leave !== null} onClose={() => setLeave(null)} id="hunt-sheet" labelledBy="hm-title">
        {leave && (
          <>
            <h3 className="hm-title" id="hm-title">Leave {leave.length} for next time?</h3>
            <p className="sub hm-sub">Nothing is lost. Saved items come first on your next trip.</p>
            <div className="group hm-leavelist">
              {leave.map(it => (
                <div className="row hm-leaverow" key={it.name}>
                  <div className="grow"><span className="name">{it.name}{qtyTag(it) ? ` - ${qtyTag(it)}` : ""}</span>
                    {qIsReportedByMe(sess, it) ? <span className="sub">Reported missing</span> : null}</div>
                  <div className="hm-seg" role="group" aria-label={`What to do with ${it.name}`}>
                    {([["saved", "Next trip"], ["dropped", "Drop"]] as const).map(([how, label]) => (
                      <button key={how} type="button" className="hm-segbtn" data-act="how" data-how={how}
                        aria-pressed={choice[it.name] === how} onClick={() => setChoice(c => ({ ...c, [it.name]: how }))}>{label}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <button type="button" className="btn primary wide hm-main" data-act="checkout" disabled={leaveBusy} onClick={checkout}>Check out</button>
            <button type="button" className="btn wide" data-act="keep" data-first onClick={() => setLeave(null)}>Keep hunting</button>
          </>
        )}
      </Sheet>

      <AskSheet open={askOpen} onClose={() => setAskOpen(false)} context={askContext} onChange={repaint} />
    </>
  );
}

/* ---------------- Ask Arya (huntask.js) ---------------- */

type AskRes = { reply?: string; applied?: string[]; skipped?: string[]; added?: { item_id: string }[]; proposed?: { text: string; action: unknown }[] };

function AskSheet({ open, onClose, context, onChange }: { open: boolean; onClose: () => void; context: () => Record<string, unknown>; onChange: () => void }) {
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [card, setCard] = useState<{ q: string; res: AskRes | null } | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const cap = useRef<Capture | null>(null);
  const [rec, setRec] = useState(false);

  // Closing the sheet (or the screen) lets the microphone go; a capture
  // or transcript that lands after that is dropped.
  const dead = useRef(false);
  const seq = useRef(0);
  const cancelMic = () => { seq.current++; cap.current?.cancel(); cap.current = null; setRec(false); };
  useEffect(() => { if (!open) { cancelMic(); setText(""); setCard(null); setStatus(""); } }, [open]);
  useEffect(() => { dead.current = false; return () => { dead.current = true; seq.current++; cap.current?.cancel(); cap.current = null; }; }, []);

  const ctx = open ? context() : {};
  const quick = ["Where's the {item}?", "Is there a cheaper one?", "I can't find it"]
    .map(q => q.replace("{item}", String(ctx.next_item || "next item")));

  const send = async (t: string) => {
    t = String(t || "").trim();
    if (!t) return;
    setText("");
    setCard({ q: t, res: null });
    try {
      const res = await post<AskRes>("/api/chat", { messages: [{ role: "user", content: t }], surface: "hunt", context: context() });
      setCard({ q: t, res });
      onChange();
    } catch (e) { setCard(null); toast(errText(e)); }
  };
  const act = async (res: AskRes, what: "no" | "yes" | "done") => {
    if (what !== "yes") { setCard(null); return; }
    setBusy(true);
    try {
      const r = await post<{ applied?: string[] }>("/api/chat/apply", { actions: (res.proposed || []).map(p => p.action) });
      setCard(null);
      toast((r.applied || []).join(" ") || "Done.");
      onChange();
    } catch (e) { toast(errText(e)); }
    setBusy(false);
  };
  const mic = async () => {
    const my = seq.current;
    const gone = () => dead.current || my !== seq.current;
    if (rec && cap.current) {
      const c = cap.current; cap.current = null; setRec(false);
      setStatus("Transcribing…");
      try { const t = await transcribeBlob(c.stop()); if (gone()) return; setStatus(""); await send(t); }
      catch (e) { if (!gone()) setStatus(errText(e)); }
      return;
    }
    if (!voiceSupported()) { setStatus("Voice is not available here."); return; }
    try {
      const c = await startCapture();
      if (gone()) { c.cancel(); return; }
      cap.current = c; setRec(true); setStatus("Listening… tap the mic to stop.");
    }
    catch { if (!gone()) setStatus("Microphone is not available."); }
  };

  return (
    <Sheet open={open} onClose={onClose} id="ask-sheet" labelledBy="ask-title">
      <span className="sheetgrip"></span>
      <h3 id="ask-title" className="largetitle" style={{ fontSize: 22 }}>Ask Arya</h3>
      <div className="chiprow">
        {quick.map(q => <button key={q} className="chip" type="button" data-q={q} onClick={() => send(q)}>{q}</button>)}
      </div>
      <div className="addline">
        <input type="text" id="ask-text" placeholder="Ask anything…" autoComplete="off" enterKeyHint="send" value={text} data-first
          onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); send(text); } }} />
        <button id="ask-mic" className="iconbtn" type="button" aria-label="Ask by voice" aria-pressed={rec} onClick={mic}><IconMic /></button>
        <button id="ask-go" className="btn primary" type="button" onClick={() => send(text)}>Ask</button>
      </div>
      <p id="ask-status" className="muted nomargin">{status}</p>
      <div id="ask-answer">
        {card && (
          <div className="group pad answercard" role="status">
            <p className="muted nomargin" style={{ fontSize: 14 }}>{card.q}</p>
            <p style={{ margin: "4px 0 0" }}>{!card.res ? "Arya is thinking…" : (() => {
              const res = card.res;
              const skipped = (res.skipped || []).map((s, i) => <span key={i} className="sub">{s}</span>);
              if ((res.proposed || []).length) return <>{skipped}<strong>{res.proposed!.map(p => p.text).join(" ")}</strong></>;
              return <>{res.reply || (res.applied || []).join(" ") || "Done."}{skipped}</>;
            })()}</p>
            {card.res && (
              <div className="sheetacts">
                {(card.res.proposed || []).length ? (
                  <>
                    <button className="btn secondary" type="button" onClick={() => act(card.res!, "no")}>Not now</button>
                    <button className="btn primary" type="button" disabled={busy} onClick={() => act(card.res!, "yes")}>{card.res.proposed!.length > 1 ? "Yes, do these" : "Yes, do it"}</button>
                  </>
                ) : <button className="btn secondary" type="button" onClick={() => act(card.res!, "done")}>Got it</button>}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="sheetacts"><button className="btn secondary" type="button" data-ask="close" onClick={onClose}>Close</button></div>
    </Sheet>
  );
}
