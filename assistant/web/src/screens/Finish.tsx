import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useNav } from "../app/nav";
import { useSession } from "../app/session";
import { useToast } from "../ui/Toast";
import { decode } from "../ui/AddReceiptSheet";
import { post } from "../lib/api";
import { Q, qLoadSessions, qProgress, qSetState, type Session } from "./hunt/model";
import { afterFinish } from "./haul/state";

/* Port of pwa/index.html #view-finish and quest.js openFinish,
 * qCloseHunt, qAttach, qSample, closeToScore. Every way out (snap,
 * e-receipt, sample, skip) closes the hunt first, then goes on the way
 * haul.js afterFinish does: Check your receipt, the reveal, or (Express)
 * the Score. Back returns to the live hunt, untouched.
 * Opened with nav.show("finish", { session }). */
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function Finish() {
  const nav = useNav();
  const { demo } = useSession();
  const { toast } = useToast();
  const sess = (nav.params.session as Session | undefined) || Q.current;
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const going = useRef(false);

  useEffect(() => { if (sess) Q.current = sess; setStatus(""); }, [sess, nav.key]);

  if (!sess) return <p className="empty">Nothing to finish. Go back to Today.</p>;

  const p = qProgress(sess);
  const nLeft = (sess.left || []).length;
  const sub = (nLeft
    ? `${p.done} in your cart, ${nLeft} left for next time at ${sess.store}.`
    : p.left === 0
    ? `Every item collected at ${sess.store}.`
    : `${p.done} of ${p.total} collected at ${sess.store}.`) +
    (sess.mode === "express" ? " Snap the receipt and the trip is done." : " The receipt is the scorecard — snap it and the hunt is settled.");

  const closeToScore = async (settle: (() => Promise<Session>) | null) => {
    if (going.current) return;
    going.current = true;
    try {
      if (sess.state === "playing" || sess.state === "paused" || sess.state === "not_started") await qSetState(sess, "finished");
      if (settle) Object.assign(sess, await settle());
      await qLoadSessions().catch(() => {});
      // haul.js afterFinish: the receipt check, the reveal, or (Express) the Score.
      await afterFinish(nav, sess, { replace: true });
    } finally { going.current = false; }
  };
  const attach = (rid: string) => () => post<Session>(`/api/quest/sessions/${sess.id}/receipt`, { receipt_id: rid });

  const onPhoto = async (ev: ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    setStatus("Reading the receipt — this can take up to a minute.");
    try {
      const rid = (await decode(f)).receipt.receipt_id;
      setStatus("");
      await closeToScore(attach(rid));
    } catch (e) {
      setStatus("");
      toast("Could not file that photo: " + errMsg(e));
    }
    ev.target.value = "";
  };
  const onEreceipt = async (ev: ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    setStatus("Reading the receipt. This can take up to a minute.");
    let rid: string;
    try {
      rid = (await decode(f)).receipt.receipt_id;
    } catch (e) {
      setStatus("");
      ev.target.value = "";
      toast("Could not read that file: " + errMsg(e) + " You can add the receipt later from Receipts.");
      return;
    }
    setStatus("");
    try { await closeToScore(attach(rid)); }
    catch (e) { toast("Arya read the file, but could not attach it: " + errMsg(e)); }
    ev.target.value = "";
  };
  const sample = async () => {
    setBusy(true);
    try { await closeToScore(() => post<Session>(`/api/quest/sessions/${sess.id}/sample-receipt`, {})); }
    catch (e) { toast(errMsg(e)); }
    setBusy(false);
  };
  const skip = async () => {
    try { await closeToScore(null); } catch (e) { toast(errMsg(e)); }
  };

  return (
    <>
      <p><a href="#" className="qback" onClick={ev => { ev.preventDefault(); nav.back(); }}>‹ Back to the hunt</a></p>
      <h2 className="largetitle" style={{ fontSize: 28 }}>Add your receipt</h2>
      <p className="muted" id="fin-sub">{sub}</p>
      <p className="muted">Arya reads items and the total. Your photo stays private to you. Nothing here is shared.</p>
      <div className="group pad">
        <input type="file" id="fin-photo" accept="image/*" aria-label="Receipt photo" hidden onChange={onPhoto} />
        <p className="nomargin"><label className="btn primary wide receiptbtn" htmlFor="fin-photo">Snap the receipt</label></p>
        <input type="file" id="fin-ereceipt" accept="application/pdf,image/*" aria-label="E-receipt, PDF or screenshot" hidden onChange={onEreceipt} />
        <p className="nomargin real-only" style={{ marginTop: 10 }} hidden={demo}><label className="btn wide" htmlFor="fin-ereceipt">Add an e-receipt (PDF or screenshot)</label></p>
        <p className="nomargin demo-only" hidden={!demo} style={{ marginTop: 10 }}><button id="fin-sample" className="btn wide" type="button" disabled={busy} onClick={sample}>Use a sample receipt <span className="demotag">Demo</span></button></p>
        <p id="fin-status" className="muted nomargin">{status}</p>
      </div>
      <p><button id="fin-skip" className="btn secondary wide" type="button" onClick={skip}>No receipt today</button></p>
      <p className="muted" id="fin-bonus" hidden={sess.mode === "express"}>Your +50 bonus waits. It never expires. Add the receipt any time from Receipts.</p>
      <p className="muted">A blurry or partial photo is fine. Arya keeps what it can read.</p>
    </>
  );
}
