import { useEffect, useState } from "react";
import { get, post } from "../lib/api";
import { useTranslation } from "../i18n";
import type { ReceiptJob } from "../lib/receiptJobs";

/* The card above Add receipts: sending, reading in the background,
 * paused (with the reason and Resume), or done (what was filed, what
 * could not be read and why). Polls while a batch is being read. */
const ACTIVE = ["uploading", "queued", "reading"];

const Bar = ({ pct }: { pct: number }) => (
  <div style={{ height: 8, borderRadius: 4, background: "var(--line, #e6e6ea)", margin: "8px 0" }} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
    <div style={{ height: 8, borderRadius: 4, background: "var(--accent)", width: `${Math.max(2, Math.min(100, pct))}%` }} />
  </div>);

export function ReceiptJobCard({ sending, onChange, onCheck, tick }:
  { sending: { sent: number; total: number } | null; onChange: () => void; onCheck: () => void; tick: unknown }) {
  const { t } = useTranslation();
  const [job, setJob] = useState<ReceiptJob | null>(null);

  useEffect(() => {
    let live = true, timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const d = await get<{ jobs: ReceiptJob[] }>("/api/receipts/jobs");
        const j = d.jobs.find(x => ACTIVE.includes(x.status) || x.status === "paused" || (x.status === "ready" && !x.seen)) || null;
        if (!live) return;
        setJob(prev => {
          if (prev && ACTIVE.includes(prev.status) && j && j.status === "ready") onChange();
          return j;
        });
        if (j && ACTIVE.includes(j.status)) timer = setTimeout(load, 4000);
      } catch { if (live) timer = setTimeout(load, 8000); }
    };
    load();
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps

  if (sending) {
    return (
      <div className="group pad" id="rc-job">
        <p className="nomargin"><strong>{sending.total === 1 ? t("receiptJob.sendingOne") : t("receiptJob.sending", { sent: sending.sent, total: sending.total })}</strong></p>
        <Bar pct={(sending.sent / sending.total) * 100} />
        <p className="muted small nomargin">{sending.total === 1 ? t("receiptJob.keepOpenOne") : t("receiptJob.keepOpen")}</p>
      </div>);
  }
  if (!job) return null;
  const seen = async () => { await post(`/api/receipts/jobs/${job.id}/seen`).catch(() => {}); setJob(null); };
  if (ACTIVE.includes(job.status)) {
    return (
      <div className="group pad" id="rc-job">
        <p className="nomargin"><strong>{job.total === 1 ? t("receiptJob.readingOne") : t("receiptJob.reading")}</strong></p>
        <Bar pct={job.total ? (job.done / job.total) * 100 : 0} />
        <p className="muted small nomargin">{t("receiptJob.progress", { done: job.done, total: job.total })}{job.failed ? " " + t("receiptJob.someFailed", { count: job.failed }) : ""} {t("receiptJob.canLeave")}</p>
      </div>);
  }
  if (job.status === "paused") {
    return (
      <div className="group pad" id="rc-job" role="alert">
        <p className="nomargin"><strong>{t("receiptJob.paused", { done: job.done, total: job.total })}</strong></p>
        <p className="muted small nomargin">{job.reason}</p>
        <p className="nomargin" style={{ marginTop: 8 }}><button type="button" className="chip" id="rc-job-resume"
          onClick={() => post<ReceiptJob>(`/api/receipts/jobs/${job.id}/resume`).then(setJob).catch(() => {})}>{t("receiptJob.resume")}</button></p>
      </div>);
  }
  return (
    <div className="group pad" id="rc-job">
      <p className="nomargin"><strong>{t("receiptJob.done", { count: job.done })}</strong></p>
      <p className="muted small nomargin">{t("receiptJob.summary", { filed: job.filed, dup: job.duplicate, failed: job.failed })}</p>
      {job.failures.slice(0, 5).map(f => <p key={f.name} className="muted small nomargin">{f.name}: {f.reason}</p>)}
      {job.failed > 5 && <p className="muted small nomargin">{t("receipts.failedMore", { n: job.failed - 5 })}</p>}
      <p className="nomargin" style={{ marginTop: 8 }}>
        {job.filed > 0 && <button type="button" className="chip" id="rc-job-check" onClick={() => { onCheck(); seen(); }}>{t("receiptJob.check")}</button>}{" "}
        <button type="button" className="chip" id="rc-job-dismiss" onClick={seen}>{t("common.dismiss")}</button></p>
    </div>);
}
