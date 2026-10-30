import { useEffect, useState } from "react";
import { useBackHandler, useNav } from "../app/nav";
import { get, post } from "../lib/api";
import { fmtShort } from "../lib/format";
import { Sheet } from "../ui/Sheet";
import { useToast } from "../ui/Toast";
import { Empty } from "../ui/kit";
import { t, useTranslation } from "../i18n";

/* Waitlist admin (owner, 2026-10-30): who left an email, oldest first.
 * Tick people, then Approve (they can sign in by email code or Google) or
 * Remove. Anyone left unticked keeps waiting. Only accounts named in
 * ARYA_WAITLIST_ADMINS get past the server; Settings shows the row only
 * to them. */
type WlRow = { email: string; at: number; approved: boolean };

const CHECK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4.5 12.5 10 18 19.5 6.5" /></svg>
);

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function joined(at: number): string {
  const d = day(at * 1000);
  if (d === day(Date.now())) return t("waitlistAdmin.joinedToday");
  if (d === day(Date.now() - 864e5)) return t("waitlistAdmin.joinedYesterday");
  return t("waitlistAdmin.joinedOn", { date: fmtShort(d) });
}

export function WaitlistAdmin() {
  const { t } = useTranslation();
  const nav = useNav();
  const { toast } = useToast();
  const [rows, setRows] = useState<WlRow[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [ask, setAsk] = useState<"approve" | "remove" | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => get<{ rows: WlRow[] }>("/auth/waitlist/list").then(d => setRows(d.rows), () => setRows([]));
  useEffect(() => { setPicked([]); load(); }, [nav.key]);
  useBackHandler(() => { setAsk(null); return true; }, ask !== null);

  const list = rows || [];
  const toApprove = picked.filter(e => !list.find(r => r.email === e)?.approved);
  const toggle = (e: string) => setPicked(p => p.includes(e) ? p.filter(x => x !== e) : [...p, e]);
  const allPicked = list.length > 0 && picked.length === list.length;
  const waiting = list.filter(r => !r.approved).length;

  const run = async (kind: "approve" | "remove", sendEmail = false) => {
    setBusy(true);
    try {
      if (kind === "approve") {
        const r = await post<{ approved: number; emailed: number }>("/auth/waitlist/approve", { emails: toApprove, send_email: sendEmail });
        toast(sendEmail && r.emailed < r.approved
          ? t("waitlistAdmin.approvedSomeFailed", { n: r.approved, sent: r.emailed })
          : t("waitlistAdmin.approvedToast", { count: r.approved }));
      } else {
        const r = await post<{ removed: number }>("/auth/waitlist/remove", { emails: picked });
        toast(t("waitlistAdmin.removedToast", { count: r.removed }));
      }
      setAsk(null); setPicked([]); await load();
    } catch (e) { toast(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  return (
    <>
      <p><a href="#" id="wl-back" onClick={e => { e.preventDefault(); nav.back("profile"); }}><span aria-hidden="true">‹ </span>{t("common.back")}</a></p>
      <h1 className="largetitle" style={{ fontSize: 28 }}>{t("waitlistAdmin.title")}</h1>
      {rows && <p className="muted" id="wl-sub" style={{ margin: "0 0 10px" }}>{waiting ? t("waitlistAdmin.waiting", { count: waiting }) : t("waitlistAdmin.nobody")}</p>}
      {rows && list.length === 0 && <Empty>{t("waitlistAdmin.empty")}</Empty>}
      {list.length > 0 && (
        <>
          <div className="row wl-tools">
            <button className="chip" id="wl-all" type="button" onClick={() => setPicked(allPicked ? [] : list.map(r => r.email))}>{allPicked ? t("waitlistAdmin.clear") : t("waitlistAdmin.selectAll")}</button>
            <span className="grow" /><span className="muted">{t("waitlistAdmin.oldestFirst")}</span>
          </div>
          <div className="group wl-list">
            {list.map(r => (
              <div key={r.email} className={"row listrow wl-row" + (picked.includes(r.email) ? " checked" : "")}>
                <button className="check" type="button" role="checkbox" aria-checked={picked.includes(r.email)} aria-label={r.email} onClick={() => toggle(r.email)}>{CHECK}</button>
                <span className="grow"><span className="name">{r.email}</span>
                  <span className="sub">{r.approved ? t("waitlistAdmin.approvedLine", { when: joined(r.at) }) : joined(r.at)}</span></span>
              </div>
            ))}
          </div>
          <div className="wl-bar">
            <button className="btn primary" id="wl-approve" type="button" disabled={!toApprove.length} onClick={() => setAsk("approve")}>
              {toApprove.length ? t("waitlistAdmin.approveN", { count: toApprove.length }) : t("waitlistAdmin.approve")}</button>
            <button className="btn danger" id="wl-remove" type="button" disabled={!picked.length} onClick={() => setAsk("remove")}>{t("waitlistAdmin.remove")}</button>
          </div>
        </>
      )}

      <Sheet open={ask === "approve"} onClose={() => setAsk(null)} id="wl-approve-sheet" title={t("waitlistAdmin.approveTitle", { count: toApprove.length })}>
        <p className="muted">{t("waitlistAdmin.approveBody")}</p>
        <p><button className="btn primary wide" id="wl-approve-mail" type="button" disabled={busy} onClick={() => run("approve", true)}>{t("waitlistAdmin.approveAndEmail")}</button></p>
        <p><button className="btn secondary wide" id="wl-approve-quiet" type="button" disabled={busy} onClick={() => run("approve", false)}>{t("waitlistAdmin.approveQuiet")}</button></p>
      </Sheet>
      <Sheet open={ask === "remove"} onClose={() => setAsk(null)} id="wl-remove-sheet" title={t("waitlistAdmin.removeTitle", { count: picked.length })}>
        <p className="muted">{t("waitlistAdmin.removeBody")}</p>
        <p><button className="btn danger wide" id="wl-remove-go" type="button" disabled={busy} onClick={() => run("remove")}>{t("waitlistAdmin.remove")}</button></p>
      </Sheet>
    </>
  );
}
