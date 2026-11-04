import { useRef, useState, type ChangeEvent } from "react";
import { useSession } from "../app/session";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";
import { post } from "../lib/api";
import { useNav } from "../app/nav";
import { afterFinish } from "../screens/haul/state";
import { qLoadSessions, type Session } from "../screens/hunt/model";
import { useTranslation } from "../i18n";
import { pickerProps } from "./picker";
import { ReadingBlock } from "./ReadingBlock";
import { fitPhoto } from "../lib/photo";
import { fmtShort } from "../lib/format";
import { t as tt } from "../i18n";

/* Demo only (owner, 2026-11-04): an earlier-dated receipt was accepted,
 * so the screen says why, and that a real account would not allow it. */
export function demoDateNote(sess?: { demo_date_waived?: string | null } | null): string | null {
  const d = sess?.demo_date_waived;
  return d ? tt("addReceiptSheet.demoDateWaived", { date: fmtShort(String(d).slice(0, 10)) }) : null;
}

/* The Add receipt sheet (pwa quest.js openAddReceipt / qArSettle):
 * attaches this trip's receipt to a finished hunt. Moved out of
 * Receipts.tsx so Profile can raise it too. target = null is closed. */
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const isPdfFile = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name || "");
export async function decode(original: File) {
  const pdf = isPdfFile(original);
  const file = pdf ? original : await fitPhoto(original);
  const r = await fetch(pdf ? "/decode/pdf" : "/decode/photo", {
    method: "POST",
    headers: { "Content-Type": pdf ? "application/pdf" : (file.type || "image/jpeg") },
    body: file,
  });
  if (!r.ok) {
    const e = new Error(((await r.json().catch(() => ({}))) as { detail?: string }).detail || `HTTP ${r.status}`) as Error & { status?: number };
    e.status = r.status;
    throw e;
  }
  return r.json();
}

export type ReceiptTarget = { sessionId: string; label: string };

/* goesToHaul: the caller already opens the haul review, so the toast
 * offers no second way there (quest.js openAddReceipt opts). Otherwise
 * the toast carries See haul (haul.js afterFinish). */
export function AddReceiptSheet({ target, onClose, onDone, goesToHaul }:
  { target: ReceiptTarget | null; onClose: () => void; onDone: (sess?: Session) => void; goesToHaul?: boolean }) {
  const { t } = useTranslation();
  const nav = useNav();
  const { demo } = useSession();
  const { toast } = useToast();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  // Closing mid-read means nothing is attached (quest.js qArSettle).
  const live = useRef(target);
  live.current = target;

  const close = () => { setStatus(""); onClose(); };
  const settle = async (run: () => Promise<Session>) => {
    if (!live.current) return;
    const sess = await run();
    close();
    const note = demoDateNote(sess);
    toast(note || t("addReceiptSheet.attached"),
      goesToHaul ? undefined : { action: t("addReceiptSheet.seeHaul"), onAction: () => { afterFinish(nav, sess); } });
    await qLoadSessions().catch(() => {});
    onDone(sess);
  };
  const photo = async (ev: ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0];
    ev.target.value = "";
    if (!f || !target) return;
    const sid = target.sessionId;
    setStatus("");
    setReading(true);
    try {
      const rid = (await decode(f)).receipt.receipt_id;
      setReading(false);
      await settle(() => post<Session>(`/api/quest/sessions/${sid}/receipt`, { receipt_id: rid }));
    } catch (e) {
      setReading(false);
      toast(t("finish.couldNotFilePhoto", { error: errMsg(e) }));
    }
  };
  const sample = async () => {
    if (!target) return;
    const sid = target.sessionId;
    setBusy(true);
    try { await settle(() => post<Session>(`/api/quest/sessions/${sid}/sample-receipt`, {})); } catch (e) { toast(errMsg(e)); }
    setBusy(false);
  };

  return (
    <Sheet open={!!target} onClose={close} id="ar-sheet">
      <div className="row"><span className="name">{t("common.addReceipt")}</span><button id="ar-close" className="btn" type="button" onClick={close}>{t("common.notNow")}</button></div>
      <p className="muted" id="ar-for">{target ? t("addReceiptSheet.forTarget", { label: target.label, state: t("common.finishedReceiptMissing") }) : ""}</p>
      <input type="file" id="ar-photo" accept="application/pdf,image/*" aria-label={t("addReceiptSheet.thisTripSReceiptPhoto")} hidden disabled={reading} onChange={photo} />
      <p className="nomargin"><label className={"btn primary wide receiptbtn" + (reading ? " dis" : "")} htmlFor="ar-photo" aria-disabled={reading || undefined} {...pickerProps("ar-photo")}>{reading ? t("receiptRead.button") : t("addReceiptSheet.snapTheReceiptPhoto")}</label></p>
      <p className="nomargin demo-only" hidden={!demo || reading}><button id="ar-sample" className="btn wide" type="button" disabled={busy || reading} onClick={sample}>{t("addReceiptSheet.useASampleReceipt")}{" "}<span className="demotag">{t("common.demo")}</span></button></p>
      {reading ? <ReadingBlock id="ar-reading" demo={demo} /> : <p id="ar-status" className="muted nomargin">{status}</p>}
      <p className="muted nomargin">{t("addReceiptSheet.theHuntStaysClosedAttaching")}</p>
    </Sheet>
  );
}
