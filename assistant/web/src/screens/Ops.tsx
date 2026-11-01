import { useCallback, useEffect, useState } from "react";
import { useNav } from "../app/nav";
import { get, post } from "../lib/api";
import { Button, Chip, Group, Row, Section } from "../ui/kit";
import { useToast } from "../ui/Toast";
import { useTranslation } from "../i18n";

/* Ops (owner, 2026-10-31, mock RMftW9ZtxwxWfJXMbdKuXr): how Arya is doing
 * and the switches that stop spend fast. Owner only: the row in Settings
 * shows for the owner and /api/ops answers 403 to anyone else. Reads
 * api/ops_summary.py; the switches post to /api/ops/controls (pause,
 * demo reads, photo reader), /auth/registration and /api/usage/unfreeze. */

type Need = { title: string; sub: string; chip?: string; bad?: boolean; freeze?: string };
type Call = { key: string; label: string; calls: number; failed: number; usd: number; p95_ms: number | null; bad: boolean };
type OpsData = {
  updated: number;
  needs: Need[];
  box: { disk_free_gb: number; disk_total_gb: number; disk_ok: boolean; backup: { hours: number | null; ok: boolean } | null };
  spend: { app: { spent: number; cap: number }; demo: { spent: number; cap: number }; credit: { left: number; total: number } };
  calls: Call[];
  controls: { ai_paused: boolean; demo_live: boolean; photo_reader: "spark" | "wonder" | "auto"; registration_open: boolean };
  meta_says: { usd: number; at: number } | null;
  changes: { ts: string; user: string; set: Record<string, unknown> }[];
  people: { accounts: number; top: [string, number][]; waitlist: number; feedback_new: number };
};

function Pill({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return <span className={"opschip " + (ok ? "ok" : "bad")}>{children}</span>;
}

function Bar({ pct, bad }: { pct: number; bad?: boolean }) {
  return <span className="opsbar" aria-hidden="true"><span className={bad ? "bad" : ""} style={{ width: `${Math.min(100, Math.max(2, pct))}%` }} /></span>;
}

const usd = (n: number) => n.toFixed(2);

function MetaSays({ says, ledger, busy, onSave }: { says: { usd: number; at: number } | null; ledger: number; busy: boolean; onSave: (v: number | null) => void }) {
  const { t } = useTranslation();
  const [v, setV] = useState(says ? String(says.usd) : "");
  const gap = says ? says.usd - ledger : 0;
  return (
    <div className="row prefrow inline"><div className="grow"><span className="name">{t("opsSettings.metaSays")}</span>
      <span className="sub">{says ? t("opsSettings.metaGap", { ledger: ledger.toFixed(2), says: says.usd.toFixed(2), gap: Math.abs(gap).toFixed(2), dir: gap >= 0 ? t("opsSettings.more") : t("opsSettings.less") }) : t("opsSettings.metaSub", { ledger: ledger.toFixed(2) })}</span></div>
      <div className="prefpicks">
        <input id="ops-meta" className="curpick" style={{ width: 92, textAlign: "right" }} inputMode="decimal" placeholder="0.00" aria-label={t("opsSettings.metaSays")} value={v} disabled={busy}
          onChange={ev => setV(ev.target.value)}
          onBlur={() => { const n = Number(v); if (v.trim() === "") { if (says) onSave(null); } else if (!says || n !== says.usd) onSave(n); }} />
      </div></div>
  );
}

export function Ops() {
  const { t } = useTranslation();
  const nav = useNav();
  const { toast } = useToast();
  const [d, setD] = useState<OpsData | null>(null);
  const [confirmPause, setConfirmPause] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    get<OpsData>("/api/ops").then(setD, () => toast(t("ops.couldNotLoad")));
  }, [t, toast]);
  useEffect(() => { load(); }, [nav.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); load(); } catch { toast(t("ops.couldNotSave")); }
    setBusy(false);
  };
  const setControl = (body: Record<string, unknown>) => save(() => post("/api/ops/controls", body));

  const ago = (() => {
    if (!d) return "";
    const m = Math.max(0, Math.round((Date.now() / 1000 - d.updated) / 60));
    return m < 1 ? t("ops.justNow") : t("ops.minAgo", { count: m });
  })();
  const quiet = !!d && d.needs.length === 0;

  return (
    <>
      <p><a href="#" id="ops-back" onClick={ev => { ev.preventDefault(); nav.back("profile"); }}><span aria-hidden="true">‹ </span>{t("common.back")}</a></p>
      <h1 className="largetitle" style={{ fontSize: 28 }}>{t("ops.title")}</h1>
      {d && (
        <>
          <p className="muted" style={{ margin: "0 0 6px" }}>{t("ops.intro", { ago })}</p>

          {!quiet && (
            <>
              <Section title={t("ops.needsLook")} />
              <Group>
                {d.needs.map((n, i) => (
                  <Row key={i} name={n.title} sub={n.sub}
                    right={n.freeze
                      ? <Chip disabled={busy} onClick={() => save(async () => { await post("/api/usage/unfreeze", { user: n.freeze }); toast(t("ops.unfrozen", { user: n.freeze })); })}>{t("ops.unfreeze")}</Chip>
                      : n.chip ? <Pill ok={false}>{n.chip}</Pill> : undefined} />
                ))}
              </Group>
            </>
          )}

          <Section title={t("ops.box")} />
          <Group>
            <Row name={t("ops.site")} sub={t("ops.siteSub")} right={<Pill ok>{t("ops.ok")}</Pill>} />
            <Row name={t("ops.disk")} sub={t("ops.diskSub", { free: d.box.disk_free_gb, total: d.box.disk_total_gb })}
              right={<Pill ok={d.box.disk_ok}>{d.box.disk_ok ? t("ops.ok") : t("ops.check")}</Pill>} />
            {d.box.backup && (
              <Row name={t("ops.backup")} sub={d.box.backup.hours === null ? t("ops.backupNone") : t("ops.backupAge", { h: Math.round(d.box.backup.hours) })}
                right={<Pill ok={d.box.backup.ok}>{d.box.backup.ok ? t("ops.ok") : t("ops.check")}</Pill>} />
            )}
          </Group>

          <Section title={t("ops.spend")} />
          <Group>
            <Row name={t("ops.spendReal")} sub={<>{t("ops.spendOf", { spent: usd(d.spend.app.spent), cap: usd(d.spend.app.cap) })}<Bar pct={d.spend.app.cap ? (d.spend.app.spent / d.spend.app.cap) * 100 : 0} bad={d.spend.app.spent >= d.spend.app.cap * 0.8} /></>} />
            <Row name={t("ops.spendDemo")} sub={<>{t("ops.spendOf", { spent: usd(d.spend.demo.spent), cap: usd(d.spend.demo.cap) })}<Bar pct={d.spend.demo.cap ? (d.spend.demo.spent / d.spend.demo.cap) * 100 : 0} bad={d.spend.demo.spent >= d.spend.demo.cap * 0.8} /></>} />
            <Row name={t("ops.credit")} sub={<>{t("ops.spendOf", { spent: Math.round(d.spend.credit.left), cap: Math.round(d.spend.credit.total) })}<Bar pct={d.spend.credit.total ? (d.spend.credit.left / d.spend.credit.total) * 100 : 0} bad={d.spend.credit.left < d.spend.credit.total * 0.1} /></>} />
          </Group>

          <Group>
            <MetaSays says={d.meta_says} ledger={d.spend.credit.total - d.spend.credit.left} busy={busy} onSave={v => setControl({ meta_says: v })} />
          </Group>

          <Section title={t("ops.calls")} />
          {d.calls.length === 0
            ? <p className="muted small" style={{ margin: "0 4px" }}>{t("ops.noCalls")}</p>
            : (
              <Group>
                {d.calls.map(c => (
                  <Row key={c.key} name={c.label}
                    sub={<>{t("ops.callsSub", { calls: c.calls, failed: c.failed, usd: usd(c.usd) })}
                      {c.p95_ms !== null && <><br />{t("ops.slowest", { s: (c.p95_ms / 1000).toFixed(1) })}</>}</>}
                    right={c.bad ? <Pill ok={false}>{t("ops.failedPct", { pct: Math.round((c.failed / c.calls) * 100) })}</Pill> : <Pill ok>{t("ops.ok")}</Pill>} />
                ))}
              </Group>
            )}

          <Section title={t("ops.controls")} />
          <Group>
            <div className="row">
              <span className="grow"><span className="name">{t("ops.pause")}</span><span className="sub">{t("ops.pauseSub")}</span></span>
              <button className="sw" id="ops-pause" type="button" role="switch" aria-checked={d.controls.ai_paused || confirmPause}
                aria-label={t("ops.pause")} disabled={busy}
                onClick={() => d.controls.ai_paused ? setControl({ ai_paused: false }) : setConfirmPause(c => !c)}><i></i></button>
            </div>
            {confirmPause && !d.controls.ai_paused && (
              <div className="pad" id="ops-pause-confirm">
                <p className="muted nomargin">{t("ops.pauseConfirm")}</p>
                <p style={{ display: "flex", gap: 10, margin: "10px 0 0" }}>
                  <Button kind="danger" grow disabled={busy} onClick={async () => { await setControl({ ai_paused: true }); setConfirmPause(false); }}>{t("ops.pauseYes")}</Button>
                  <Button kind="secondary" grow onClick={() => setConfirmPause(false)}>{t("ops.cancel")}</Button>
                </p>
              </div>
            )}
            <div className="row prefrow inline"><div className="grow"><span className="name">{t("ops.reader")}</span><span className="sub">{t("ops.readerSub")}</span></div>
              <div className="prefpicks">
                <select id="ops-reader" className="curpick" aria-label={t("ops.reader")} value={d.controls.photo_reader} disabled={busy}
                  onChange={ev => setControl({ photo_reader: ev.target.value })}>
                  <option value="spark">{t("ops.readerSpark")}</option>
                  <option value="wonder">{t("ops.readerWonder")}</option>
                  <option value="auto">{t("ops.readerAuto")}</option>
                </select>
              </div></div>
            <div className="row">
              <span className="grow"><span className="name">{t("ops.demoLive")}</span><span className="sub">{t("ops.demoLiveSub")}</span></span>
              <button className="sw" id="ops-demo" type="button" role="switch" aria-checked={d.controls.demo_live}
                aria-label={t("ops.demoLive")} disabled={busy} onClick={() => setControl({ demo_live: !d.controls.demo_live })}><i></i></button>
            </div>
            <div className="row">
              <span className="grow"><span className="name">{t("ops.registration")}</span><span className="sub">{d.controls.registration_open ? t("ops.registrationOn") : t("ops.registrationOff")}</span></span>
              <button className="sw" id="ops-registration" type="button" role="switch" aria-checked={d.controls.registration_open}
                aria-label={t("ops.registration")} disabled={busy}
                onClick={() => save(() => post("/auth/registration", { open: !d.controls.registration_open }))}><i></i></button>
            </div>
          </Group>

          <Section title={t("opsSettings.settings")} />
          <Group>
            {(["models", "limits", "caps", "accounts", "data"] as const).map(pg => (
              <button key={pg} className="navrow" id={"ops-set-" + pg} type="button" onClick={() => nav.show("ops-settings", { page: pg })}>
                <span className="grow">{t("opsSettings.title_" + pg)}<span className="sub">{t("opsSettings.sub_" + pg)}</span></span><span className="chev">›</span></button>
            ))}
          </Group>

          <Section title={t("opsSettings.changeLog")} />
          {(d.changes ?? []).length === 0
            ? <p className="muted small" style={{ margin: "0 4px" }}>{t("opsSettings.noChanges")}</p>
            : <Group>{(d.changes ?? []).slice(0, 8).map((c, i) => (
                <Row key={i} name={Object.keys(c.set).join(", ")} sub={`${c.user.split("@")[0]} · ${c.ts.replace("T", " ").slice(0, 16)}`} />))}</Group>}

          <Section title={t("ops.people")} />
          <Group>
            <div className="row"><span className="grow"><span className="name">{t("ops.top")}</span>
              <span className="sub">{d.people.top.length ? d.people.top.slice(0, 3).map(([u, v]) => `${u.split("@")[0]} $${usd(v)}`).join(" · ") : t("ops.topNone")}</span></span></div>
            <button className="navrow" id="ops-waitlist" type="button" onClick={() => nav.show("waitlist")}>
              <span className="grow">{t("ops.waitlist")}<span className="sub">{t("ops.waitlistSub", { count: d.people.waitlist })}</span></span><span className="chev">›</span></button>
            <button className="navrow" id="ops-feedback" type="button" onClick={() => nav.show("feedback")}>
              <span className="grow">{t("ops.feedback")}<span className="sub">{t("ops.feedbackSub", { count: d.people.feedback_new })}</span></span><span className="chev">›</span></button>
          </Group>
          <p className="muted small" style={{ margin: "10px 4px 30px" }}>{t("ops.footer")}</p>
        </>
      )}
    </>
  );
}
