import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { useNav } from "../app/nav";
import { useSession } from "../app/session";
import { useToast } from "../ui/Toast";
import { AddReceiptSheet, decode, isPdfFile, type ReceiptTarget } from "../ui/AddReceiptSheet";
import { Empty, Row } from "../ui/kit";
import { get, post } from "../lib/api";
import { fmtDate, fmtShort, fmtWeekday, lineSavings, money } from "../lib/format";
import { useTranslation } from "../i18n";
import { pickerProps } from "../ui/picker";

/* Port of pwa/index.html #view-receipts and app.js renderReceipts,
 * renderScan (review queue), renderCurator, fileReceiptPhoto and the
 * Add-receipt sheet (quest.js openAddReceipt). A row opens the
 * receipt detail: nav.show("receipt", { receipt_id }). */

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
/* Lines of one product (same item number, else same printed text)
 * across receipts are asked about once. */
const lineKey = (l: Line) => l.sku ? "sku:" + l.sku : "raw:" + String(l.raw || "").toLowerCase().split(/\s+/).filter(Boolean).join(" ");
type FileResult = { ok: boolean; duplicate?: boolean; reason?: string; stop?: boolean };
/* The server refuses every read the same way: 401 signed out, 429 an
 * account limit, 503 reading paused / budget / no key. Trying the next
 * file would fail identically. */
const isSystemic = (e: unknown) => [401, 429, 503].includes((e as { status?: number })?.status ?? 0);

type Line = { receipt_id: string; idx: number; decoded_name?: string; raw: string; date?: string;
  merchant?: string; sku?: string; qty?: number; line_total?: number | null; confidence?: number;
  suggested?: { name: string; source?: string }; alternatives?: string[] };
type Unresolved = { item_id: string; name: string; candidates?: string[]; sources?: Record<string, string> };
type Proposal = { id: string; kind: string; into_name?: string; names: string[]; reason: string };
type Rec = { receipt_id: string; merchant: string; purchased_at: string; items?: number; returns_total?: number;
  by?: string; mine?: boolean; totals_reconcile?: boolean; total?: number | null };
type Unsettled = { session_id: string; store: string; finished_at?: string; items_collected: number; items_total: number };
type Archive = { receipts: Rec[]; unsettled?: Unsettled[] };

export function Receipts() {
  const { t } = useTranslation();
  const nav = useNav();
  const { currency } = useSession();
  const { toast, showErr } = useToast();
  const [queue, setQueue] = useState<{ lines: Line[]; unresolved: Unresolved[] }>({ lines: [], unresolved: [] });
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [archive, setArchive] = useState<Archive>({ receipts: [] });
  // No "No receipts filed yet." until the archive has actually loaded.
  const [loaded, setLoaded] = useState(false);
  const [who, setWho] = useState("all");
  const [status, setStatus] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const [ar, setAr] = useState<ReceiptTarget | null>(null);
  // Files a bulk add could not read, each with the reason, kept on screen
  // (a toast alone vanished before the owner could read it).
  const [failures, setFailures] = useState<{ name: string; reason: string }[]>([]);

  const loadScan = useCallback(async () => {
    const q = await get("/api/review");
    setQueue({ lines: q.lines || [], unresolved: q.unresolved || [] });
  }, []);
  const loadCurator = useCallback(async () => {
    const d = await get("/api/curator").catch(() => ({ proposals: [] }));
    setProposals(d.proposals || []);
  }, []);
  const loadArchive = useCallback(async () => {
    setArchive(await get("/api/quest/receipts").catch(() => ({ receipts: [] })));
    setLoaded(true);
  }, []);
  const loadAll = useCallback(
    () => Promise.all([loadScan().catch(() => {}), loadCurator().catch(() => {}), loadArchive()]).then(() => {}),
    [loadScan, loadCurator, loadArchive]);

  useEffect(() => { loadAll().catch(showErr); }, [nav.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const attempt = async (f: () => Promise<void>) => { try { await f(); } catch (e) { toast(errMsg(e)); } };

  /* The review queue itself lives on its own screen (ToCheck.tsx); here
   * only how much there is to check. */
  const toCheck = (() => {
    const keys = new Map<string, number>();
    for (const l of queue.lines) keys.set(lineKey(l), (keys.get(lineKey(l)) || 0) + 1);
    return { items: keys.size + queue.unresolved.length + proposals.length, lines: queue.lines.length };
  })();

  /* ---- Archive ---- */
  const people = [...new Set(archive.receipts.filter(r => r.by && !r.mine).map(r => r.by as string))];
  const shared = archive.receipts.some(r => r.by);
  const whoNow = !shared || (who !== "all" && who !== "mine" && !people.includes(who)) ? "all" : who;
  const mineCount = archive.receipts.filter(r => r.mine).length;
  const count = !archive.receipts.length ? ""
    : shared && people.length
      ? t("receipts.countShared", { count: archive.receipts.length, people: people.length + 1, mine: mineCount })
      : t("receipts.countMine", { count: archive.receipts.length });
  const shown = archive.receipts.filter(r => whoNow === "all" || (whoNow === "mine" ? r.mine : r.by === whoNow));
  const unsettled = archive.unsettled || [];

  const dismiss = (sid: string) => attempt(async () => {
    if (!confirm(t("receipts.confirmDismiss"))) return;
    await post(`/api/quest/sessions/${encodeURIComponent(sid)}/delete`, {});
    toast(t("receipts.huntDismissed"));
    loadArchive().catch(showErr);
  });

  /* ---- Filing a photo or PDF ---- */
  const fileOne = async (file: File, label: string | undefined, withPreview: boolean, quiet: boolean) => {
    if (!file || !file.size) {
      if (!quiet) toast(t("common.receiptFile.empty"));
      return { ok: false, reason: t("common.receiptFile.empty") } as FileResult;
    }
    setStatus(label || t("common.receiptFile.reading"));
    if (withPreview) setPreview(null);
    try {
      const out = await decode(file);
      const rec = out.receipt || {};
      setStatus("");
      if (out.demo) {
        if (withPreview) setPreview(rec); else setStatus(t("common.receiptFile.demo"));
        return { ok: true } as FileResult;
      }
      if (out.duplicate) {
        if (!quiet) toast(t("common.receiptFile.duplicate", { merchant: rec.merchant || t("common.receiptFile.thatReceipt"), date: fmtDate(rec.purchased_at) }));
        return { ok: true, duplicate: true } as FileResult;
      }
      const saved = lineSavings(rec.lines || []);
      if (!quiet) toast(t(saved ? "common.receiptFile.filedSaved" : "common.receiptFile.filed", { merchant: rec.merchant || t("common.receiptFile.theReceipt"), n: (rec.lines || []).length, amount: money(saved) }));
      loadScan().catch(showErr);
      loadArchive().catch(() => {});
      return { ok: true } as FileResult;
    } catch (e) {
      setStatus("");
      if (!quiet) toast(t(isPdfFile(file) ? "common.receiptFile.couldNotReadFile" : "common.receiptFile.couldNotReadPhoto", { error: errMsg(e) }));
      return { ok: false, reason: errMsg(e), stop: isSystemic(e) } as FileResult;
    }
  };

  const onFiles = async (ev: ChangeEvent<HTMLInputElement>) => {
    const files = [...(ev.target.files || [])];
    ev.target.value = "";
    if (!files.length) return;
    if (files.length === 1) { await fileOne(files[0], undefined, true, false); return; }
    let filed = 0, dup = 0, skipped = 0;
    const bad: { name: string; reason: string }[] = [];
    setFailures([]);
    for (let i = 0; i < files.length; i++) {
      const res = await fileOne(files[i], t("receipts.readingN", { i: i + 1, n: files.length, name: files[i].name }), false, true);
      if (res.duplicate) dup++; else if (res.ok) filed++; else bad.push({ name: files[i].name, reason: res.reason || "" });
      // A paused reader, a spent budget or a missing key fails every file
      // the same way: stop, say why, and do not burn through the rest.
      if (res.stop) { skipped = files.length - i - 1; break; }
    }
    setStatus("");
    setFailures(bad);
    const why = bad.length ? t("receipts.bulkWhy", { reason: bad[0].reason }) : "";
    toast(t("receipts.bulkDone", { count: filed, dup: dup ? t("receipts.bulkDup", { n: dup }) : "",
      failed: bad.length ? t("receipts.bulkFailed", { n: bad.length }) + why : "",
      skipped: skipped ? t("receipts.bulkSkipped", { n: skipped }) : "" }));
    loadScan().catch(showErr);
    loadArchive().catch(() => {});
  };

  return (
    <>
      <p><a href="#" id="rc-back" className="backlink" onClick={ev => { ev.preventDefault(); nav.back("home"); }}><span aria-hidden="true">‹ </span>{t("common.back")}</a></p>
      <h1 className="largetitle" style={{ fontSize: 28 }}>{t("common.receipts")}</h1>
      <p className="muted small" id="rc-ai-note">{t("ai.receiptsLine")}</p>
      <p id="rc-count" className="subtitle">{count}</p>
      {toCheck.items > 0 && (
        <div className="group" id="eye-group">
          <button className="navrow" id="btn-tocheck" type="button" onClick={() => nav.show("tocheck")}>
            <span className="grow">{t("receipts.needsYourEye")}<span className="sub">{t("toCheck.rowSub", { items: toCheck.items, lines: toCheck.lines })}</span></span>
            <span className="opschip bad">{toCheck.items}</span><span className="chev">›</span></button>
        </div>)}
      <div className="group pad">
        <label className="btn primary wide receiptbtn" htmlFor="rc-photo" {...pickerProps("rc-photo")}>{t("receipts.addReceipts")}</label>
        <p className="muted nomargin">{t("receipts.addAReceiptPhotoOr")}</p>
        <input type="file" id="rc-photo" accept="application/pdf,image/*" multiple hidden onChange={onFiles} />
        <p className="muted nomargin" id="rc-photo-status">{status}</p>
        {failures.length > 0 && (
          <div id="rc-photo-failures" role="alert">
            <p className="muted nomargin"><strong>{t("receipts.failedHead", { count: failures.length })}</strong></p>
            {failures.slice(0, 5).map(f => <p key={f.name} className="muted small nomargin">{f.name}: {f.reason}</p>)}
            {failures.length > 5 && <p className="muted small nomargin">{t("receipts.failedMore", { n: failures.length - 5 })}</p>}
            <p className="nomargin"><button type="button" className="chip" onClick={() => setFailures([])}>{t("common.dismiss")}</button></p>
          </div>
        )}
        <div id="rc-photo-preview">
          {preview && (
            <div className="group pad" style={{ marginTop: 10 }}>
              <p className="nomargin"><strong>{preview.merchant || t("common.receipt")}</strong> <span className="sub">{t("receipts.readLiveKeptForThis")}</span></p>
              {(preview.lines || []).map((l: any, i: number) => (
                <Row key={i} name={l.decoded_name || l.raw || "line"} right={l.line_total != null ? money(l.line_total, currency) : ""} />
              ))}
              {preview.total != null && <Row name={t("common.total")} right={money(preview.total, currency)} />}
            </div>
          )}
        </div>
      </div>
      <h3 className="sect">{t("receipts.archive")}</h3>
      <div id="rc-who" className="segs" role="group" aria-label={t("receipts.whoseReceipts")} hidden={!people.length}>
        {people.length > 0 && ([["all", t("receipts.everyone")], ["mine", t("receipts.mine")], ...people.map(p => [p, cap(p)])] as string[][]).map(([k, label]) => (
          <button key={k} type="button" className={whoNow === k ? "on" : ""} data-rc-who={k} aria-pressed={whoNow === k} onClick={() => setWho(k)}>{label}</button>
        ))}
      </div>
      <div id="rc-archive" className="group">
        {!loaded ? null : !unsettled.length && !shown.length ? <Empty>{t("receipts.noReceiptsFiledYet")}</Empty> : <>
          {unsettled.map(e => (
            <div key={e.session_id} className="sessrow">
              <span className="grow"><span className="name">{e.store}</span>
                <span className="sub">{t("receipts.ofItemsCollected", { slice: fmtShort(String(e.finished_at || "").slice(0, 10)), items_collected: e.items_collected, items_total: e.items_total })}</span></span>
              <span className="misstag">{t("receipts.receiptMissing")}</span>
              <button className="btn" data-upload={e.session_id} data-store={e.store} type="button"
                onClick={() => { setAr({ sessionId: e.session_id, label: e.store }); }}>{t("common.addReceipt")}</button>
              <button className="btn" data-dismiss={e.session_id} type="button" onClick={() => dismiss(e.session_id)}>{t("common.dismiss")}</button>
            </div>
          ))}
          {shown.map(r => (
            <button key={r.receipt_id} className="sessrow" data-receipt={r.receipt_id} type="button"
              onClick={() => nav.show("receipt", { receipt_id: r.receipt_id, id: r.receipt_id })}>
              <span className="grow"><span className="name">{r.merchant}</span>
                <span className="sub">{fmtWeekday(String(r.purchased_at).slice(0, 10))} · {r.items ? t("common.itemCount", { count: r.items }) : r.returns_total ? t("receipts.returnOnly", { amount: money(r.returns_total, currency) }) : t("receipts.noLinesRead")}
                  {r.items && r.returns_total ? t("receipts.returns", { amount: money(r.returns_total, currency) }) : ""}
                  {r.by ? (r.mine ? t("receipts.byYou") : <> · <span className="byp">{cap(r.by)}</span></>) : ""}</span></span>
              <span className="money">{r.totals_reconcile && !(r.returns_total && !r.items) ? "✓ " : ""}{r.total != null && !(r.returns_total && !r.items) ? money(r.total, currency) : ""}</span>
            </button>
          ))}
        </>}
      </div>

      {/* Old onDone was renderReceipts: the filed lines can land in Needs your eye. */}
      <AddReceiptSheet target={ar} onClose={() => setAr(null)} onDone={() => loadAll().catch(showErr)} />
    </>
  );
}
