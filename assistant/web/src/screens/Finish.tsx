import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useNav } from "../app/nav";
import { useSession } from "../app/session";
import { useToast } from "../ui/Toast";
import { decode } from "../ui/AddReceiptSheet";
import { post } from "../lib/api";
import { Q, qLoadSessions, qProgress, qSetState, type Session } from "./hunt/model";
import { afterFinish } from "./haul/state";
import { useTranslation } from "../i18n";

/* Port of pwa/index.html #view-finish and quest.js openFinish,
 * qCloseHunt, qAttach, qSample, closeToScore. Every way out (snap,
 * e-receipt, sample, skip) closes the hunt first, then goes on the way
 * haul.js afterFinish does: Check your receipt, the reveal, or (Express)
 * the Score. Back returns to the live hunt, untouched.
 * Opened with nav.show("finish", { session }). */
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function Finish() {
  const { t } = useTranslation();
  const nav = useNav();
  const { demo } = useSession();
  const { toast } = useToast();
  const sess = (nav.params.session as Session | undefined) || Q.current;
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const going = useRef(false);

  useEffect(() => { if (sess) Q.current = sess; setStatus(""); }, [sess, nav.key]);

  if (!sess) return <p className="empty">{t("finish.nothingToFinishGoBack")}</p>;

  const p = qProgress(sess);
  const nLeft = (sess.left || []).length;
  const sub = (nLeft
    ? t("finish.inCartLeft", { done: p.done, left: nLeft, store: sess.store })
    : p.left === 0
    ? t("finish.everyItem", { store: sess.store })
    : t("finish.collectedAt", { done: p.done, total: p.total, store: sess.store })) +
    (sess.mode === "express" ? t("finish.snapExpress") : t("finish.snapQuest"));

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
    setStatus(t("common.receiptFile.reading"));
    try {
      const rid = (await decode(f)).receipt.receipt_id;
      setStatus("");
      await closeToScore(attach(rid));
    } catch (e) {
      setStatus("");
      toast(t("finish.couldNotFilePhoto", { error: errMsg(e) }));
    }
    ev.target.value = "";
  };
  const onEreceipt = async (ev: ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    setStatus(t("finish.readingFile"));
    let rid: string;
    try {
      rid = (await decode(f)).receipt.receipt_id;
    } catch (e) {
      setStatus("");
      ev.target.value = "";
      toast(t("finish.couldNotReadFile", { error: errMsg(e) }));
      return;
    }
    setStatus("");
    try { await closeToScore(attach(rid)); }
    catch (e) { toast(t("finish.couldNotAttach", { error: errMsg(e) })); }
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
      <p><a href="#" className="qback" onClick={ev => { ev.preventDefault(); nav.back(); }}><span aria-hidden="true">‹ </span>{t("finish.backToTheHunt")}</a></p>
      <h2 className="largetitle" style={{ fontSize: 28 }}>{t("finish.addYourReceipt")}</h2>
      <p className="muted" id="fin-sub">{sub}</p>
      <p className="muted">{t("finish.aryaReadsItemsAndThe")}</p>
      <div className="group pad">
        <input type="file" id="fin-photo" accept="image/*" aria-label={t("finish.receiptPhoto")} hidden onChange={onPhoto} />
        <p className="nomargin"><label className="btn primary wide receiptbtn" htmlFor="fin-photo">{t("finish.snapTheReceipt")}</label></p>
        <input type="file" id="fin-ereceipt" accept="application/pdf,image/*" aria-label={t("finish.eReceiptPdfOrScreenshot")} hidden onChange={onEreceipt} />
        <p className="nomargin real-only" style={{ marginTop: 10 }} hidden={demo}><label className="btn wide" htmlFor="fin-ereceipt">{t("finish.addAnEReceiptPdf")}</label></p>
        <p className="nomargin demo-only" hidden={!demo} style={{ marginTop: 10 }}><button id="fin-sample" className="btn wide" type="button" disabled={busy} onClick={sample}>{t("finish.useASampleReceipt")}{" "}<span className="demotag">{t("common.demo")}</span></button></p>
        <p id="fin-status" className="muted nomargin">{status}</p>
      </div>
      <p><button id="fin-skip" className="btn secondary wide" type="button" onClick={skip}>{t("finish.noReceiptToday")}</button></p>
      <p className="muted" id="fin-bonus" hidden={sess.mode === "express"}>{t("finish.your50BonusWaitsIt")}</p>
      <p className="muted">{t("finish.aBlurryOrPartialPhoto")}</p>
    </>
  );
}
