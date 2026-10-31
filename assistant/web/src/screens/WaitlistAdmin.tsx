import { useEffect, useState } from "react";
import { useBackHandler, useNav } from "../app/nav";
import { get, post } from "../lib/api";
import { fmtShort } from "../lib/format";
import { Sheet } from "../ui/Sheet";
import { useToast } from "../ui/Toast";
import { Empty } from "../ui/kit";
import { t, useTranslation } from "../i18n";

/* Waitlist admin (owner, 2026-10-30; sections 2026-10-31): three sections,
 * Waiting on top, then Approved, then Rejected, oldest first in each. Tick
 * people in one section at a time; the buttons follow that section. Reject
 * keeps the row (the person cannot rejoin into Waiting and sees nothing
 * different); Delete, on rejected rows, erases it. Only accounts named in
 * ARYA_WAITLIST_ADMINS get past the server; Settings shows the row only
 * to them. */
type WlRow = { email: string; at: number; approved: boolean; rejected: boolean };
type Sec = "waiting" | "approved" | "rejected";
const secOf = (r: WlRow): Sec => r.rejected ? "rejected" : r.approved ? "approved" : "waiting";
const SECTIONS: Sec[] = ["waiting", "approved", "rejected"];

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
  const bySec = (k: Sec) => list.filter(r => secOf(r) === k);
  const pickedSec: Sec | null = picked.length ? secOf(list.find(r => r.email === picked[0]) as WlRow) : null;
  const waiting = bySec("waiting").length;
  // Ticking a person in another section starts a new pick, so the buttons always match one section.
  const toggle = (r: WlRow) => setPicked(p => p.includes(r.email) ? p.filter(x => x !== r.email)
    : pickedSec && pickedSec !== secOf(r) ? [r.email] : [...p, r.email]);

  const run = async (kind: "approve" | "reject" | "restore" | "remove", sendEmail = false) => {
    setBusy(true);
    try {
      if (kind === "approve") {
        const r = await post<{ approved: number; emailed: number }>("/auth/waitlist/approve", { emails: picked, send_email: sendEmail });
        toast(sendEmail && r.emailed < r.approved
          ? t("waitlistAdmin.approvedSomeFailed", { n: r.approved, sent: r.emailed })
          : t("waitlistAdmin.approvedToast", { count: r.approved }));
      } else if (kind === "reject") {
        const r = await post<{ rejected: number }>("/auth/waitlist/reject", { emails: picked });
        toast(t("waitlistAdmin.rejectedToast", { count: r.rejected }));
      } else if (kind === "restore") {
        const r = await post<{ restored: number }>("/auth/waitlist/restore", { emails: picked });
        toast(t("waitlistAdmin.restoredToast", { count: r.restored }));
      } else {
        const r = await post<{ removed: number }>("/auth/waitlist/remove", { emails: picked });
        toast(t("waitlistAdmin.removedToast", { count: r.removed }));
      }
      setAsk(null); setPicked([]); await load();
    } catch (e) { toast(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  const n = picked.length;
  const none = n === 0;

  return (
    <>
      <p><a href="#" id="wl-back" onClick={e => { e.preventDefault(); nav.back("profile"); }}><span aria-hidden="true">‹ </span>{t("common.back")}</a></p>
      <h1 className="largetitle" style={{ fontSize: 28 }}>{t("waitlistAdmin.title")}</h1>
      {rows && <p className="muted" id="wl-sub" style={{ margin: "0 0 10px" }}>{waiting ? t("waitlistAdmin.waiting", { count: waiting }) : t("waitlistAdmin.nobody")}</p>}
      {rows && list.length === 0 && <Empty>{t("waitlistAdmin.empty")}</Empty>}
      {rows && list.length > 0 && SECTIONS.map(k => {
        const items = bySec(k);
        return (
          <div key={k} id={"wl-sec-" + k}>
            <h3 className="sect">{t("waitlistAdmin.sec." + k)} <span className="cnt">{items.length}</span></h3>
            {items.length === 0 ? <p className="empty wl-empty">{t("waitlistAdmin.none." + k)}</p> : (
              <div className="group wl-list2">
                {items.map(r => (
                  <div key={r.email} className={"row listrow wl-row" + (picked.includes(r.email) ? " checked" : "")}>
                    <button className="check" type="button" role="checkbox" aria-checked={picked.includes(r.email)} aria-label={r.email} onClick={() => toggle(r)}>{CHECK}</button>
                    <span className="grow"><span className="name">{r.email}</span>
                      <span className="sub">{k === "waiting" ? joined(r.at) : t("waitlistAdmin." + k + "Line", { when: joined(r.at) })}</span></span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {rows && list.length > 0 && (
        <div className="wl-bar">
          {pickedSec === "approved" ? (
            <button className="btn secondary" id="wl-restore" type="button" onClick={() => run("restore")}>{t("waitlistAdmin.backToWaiting")}</button>
          ) : (
            <button className="btn primary" id="wl-approve" type="button" disabled={none} onClick={() => setAsk("approve")}>
              {none ? t("waitlistAdmin.approve") : t("waitlistAdmin.approveN", { count: n })}</button>
          )}
          {pickedSec === "rejected" ? (
            <>
              <button className="btn secondary" id="wl-restore" type="button" onClick={() => run("restore")}>{t("waitlistAdmin.backToWaiting")}</button>
              <button className="btn danger" id="wl-remove" type="button" onClick={() => setAsk("remove")}>{t("waitlistAdmin.delete")}</button>
            </>
          ) : (
            <button className="btn danger" id="wl-reject" type="button" disabled={none} onClick={() => run("reject")}>{t("waitlistAdmin.reject")}</button>
          )}
        </div>
      )}

      <Sheet open={ask === "approve"} onClose={() => setAsk(null)} id="wl-approve-sheet" title={t("waitlistAdmin.approveTitle", { count: n })}>
        <p className="muted">{t("waitlistAdmin.approveBody")}</p>
        <p><button className="btn primary wide" id="wl-approve-mail" type="button" disabled={busy} onClick={() => run("approve", true)}>{t("waitlistAdmin.approveAndEmail")}</button></p>
        <p><button className="btn secondary wide" id="wl-approve-quiet" type="button" disabled={busy} onClick={() => run("approve", false)}>{t("waitlistAdmin.approveQuiet")}</button></p>
      </Sheet>
      <Sheet open={ask === "remove"} onClose={() => setAsk(null)} id="wl-remove-sheet" title={t("waitlistAdmin.deleteTitle", { count: n })}>
        <p className="muted">{t("waitlistAdmin.deleteBody")}</p>
        <p><button className="btn danger wide" id="wl-remove-go" type="button" disabled={busy} onClick={() => run("remove")}>{t("waitlistAdmin.delete")}</button></p>
      </Sheet>
    </>
  );
}
