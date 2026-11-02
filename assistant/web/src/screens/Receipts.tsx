import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useNav } from "../app/nav";
import { useSession } from "../app/session";
import { useToast } from "../ui/Toast";
import { AddReceiptSheet, decode, isPdfFile, type ReceiptTarget } from "../ui/AddReceiptSheet";
import { Empty, Row } from "../ui/kit";
import { get, post } from "../lib/api";
import { fmtDate, fmtShort, fmtWeekday, lineSavings, money } from "../lib/format";
import { useTranslation } from "../i18n";
import { pickerProps } from "../ui/picker";
import { ReceiptJobCard } from "../ui/ReceiptJobCard";
import { sendBatch } from "../lib/receiptJobs";

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

/* Archive filters. Dates are the receipt's own purchase day (YYYY-MM-DD),
 * compared as text, so there is no time zone to get wrong. */
const DATE_KEYS = ["all", "month", "30", "year", "custom"] as const;
const SORT_KEYS = ["new", "old", "high", "low", "store"] as const;
type DateKey = (typeof DATE_KEYS)[number];
type SortKey = (typeof SORT_KEYS)[number];
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const day = (r: Rec) => String(r.purchased_at).slice(0, 10);
const amt = (r: Rec) => (r.total != null ? r.total : 0);
function dateRange(key: DateKey, from: string, to: string, now = new Date()): [string, string] {
  if (key === "month") return [ymd(now).slice(0, 8) + "01", "9999"];
  if (key === "30") return [ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30)), "9999"];
  if (key === "year") return [`${now.getFullYear()}-01-01`, "9999"];
  if (key === "custom") return [from || "0000", to || "9999"];
  return ["0000", "9999"];
}
export function filterReceipts(list: Rec[], f: { query: string; date: DateKey; from: string; to: string; sort: SortKey }, now = new Date()): Rec[] {
  const q = f.query.trim().toLowerCase().replace(/^\$/, "").replace(/,/g, "");
  const [lo, hi] = dateRange(f.date, f.from, f.to, now);
  const out = list.filter(r => {
    const d = day(r);
    if (d < lo || d > hi) return false;
    if (!q) return true;
    const money = r.total != null ? Math.abs(r.total).toFixed(2) : "";
    return (r.merchant || "").toLowerCase().includes(q) || (r.by || "").toLowerCase().includes(q) || money.includes(q);
  });
  const newest = (a: Rec, b: Rec) => day(b).localeCompare(day(a));
  const cmp: Record<SortKey, (a: Rec, b: Rec) => number> = {
    new: newest,
    old: (a, b) => -newest(a, b),
    high: (a, b) => amt(b) - amt(a) || newest(a, b),
    low: (a, b) => amt(a) - amt(b) || newest(a, b),
    store: (a, b) => (a.merchant || "").localeCompare(b.merchant || "", undefined, { sensitivity: "base" }) || newest(a, b),
  };
  return out.sort(cmp[f.sort]);
}

export function Receipts() {
  const { t } = useTranslation();
  const nav = useNav();
  const { currency, demo } = useSession();
  const { toast, showErr } = useToast();
  const [queue, setQueue] = useState<{ lines: Line[]; unresolved: Unresolved[] }>({ lines: [], unresolved: [] });
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [archive, setArchive] = useState<Archive>({ receipts: [] });
  // No "No receipts filed yet." until the archive has actually loaded.
  const [loaded, setLoaded] = useState(false);
  const [who, setWho] = useState("all");
  const [query, setQuery] = useState("");
  const [dateKey, setDateKey] = useState<DateKey>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState<SortKey>("new");
  const [status, setStatus] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const [ar, setAr] = useState<ReceiptTarget | null>(null);
  // Files a bulk add could not read, each with the reason, kept on screen
  // (a toast alone vanished before the owner could read it).
  // A batch being sent to the server (it reads it in the background).
  const [sending, setSending] = useState<{ sent: number; total: number } | null>(null);
  const [jobTick, setJobTick] = useState(0);
  const [failures, setFailures] = useState<{ name: string; reason: string }[]>([]);
  /* Reading on this screen (the demo, or when a batch cannot be opened):
   * which file, and the outcome with the files to try again. */
  const [reading, setReading] = useState<{ i: number; n: number; name: string; filed: number } | null>(null);
  const [outcome, setOutcome] = useState<{ read: number; total: number; retry: File[] } | null>(null);

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
  const ofWho = useMemo(() => archive.receipts.filter(r => whoNow === "all" || (whoNow === "mine" ? r.mine : r.by === whoNow)),
    [archive.receipts, whoNow]);
  const shown = useMemo(() => filterReceipts(ofWho, { query, date: dateKey, from, to, sort }), [ofWho, query, dateKey, from, to, sort]);
  const filtered = !!query.trim() || dateKey !== "all";
  const clearFilters = () => { setQuery(""); setDateKey("all"); setFrom(""); setTo(""); };
  const sum = shown.reduce((n, r) => n + (r.total != null && !(r.returns_total && !r.items) ? r.total : 0), 0);
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
    if (label) setStatus(label);
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
    await readFiles(files);
  };

  const readFiles = async (files: File[]) => {
    setOutcome(null);
    setPreview(null);
    // Signed in, one file or many: send them to the server first, which
    // reads them while the app is closed (owner, 2026-11-01). If a batch
    // cannot be opened (the demo, no connection), read them here.
    if (!demo) {
      setFailures([]);
      let opened = false;
      try {
        setSending({ sent: 0, total: files.length });
        const out = await sendBatch(files, n => { opened = true; setSending({ sent: n, total: files.length }); });
        setSending(null);
        if (out.unsent.length) { setFailures(out.unsent); toast(t("receiptJob.unsent", { count: out.unsent.length, reason: out.unsent[0].reason })); }
        setJobTick(x => x + 1);
        return;
      } catch (e) {
        setSending(null);
        if (opened) { toast(errMsg(e)); setJobTick(x => x + 1); return; }
      }
    }
    if (files.length === 1) {
      setFailures([]);
      setReading({ i: 1, n: 1, name: files[0].name, filed: 0 });
      try { await fileOne(files[0], undefined, true, false); } finally { setReading(null); }
      return;
    }
    let filed = 0, dup = 0, skipped = 0;
    const bad: { name: string; reason: string }[] = [];
    const retry: File[] = [];
    setFailures([]);
    for (let i = 0; i < files.length; i++) {
      setReading({ i: i + 1, n: files.length, name: files[i].name, filed });
      const res = await fileOne(files[i], undefined, false, true);
      if (res.duplicate) dup++; else if (res.ok) filed++; else { bad.push({ name: files[i].name, reason: res.reason || "" }); retry.push(files[i]); }
      // A paused reader, a spent budget or a missing key fails every file
      // the same way: stop, say why, and do not burn through the rest.
      if (res.stop) { skipped = files.length - i - 1; retry.push(...files.slice(i + 1)); break; }
    }
    setReading(null);
    setStatus("");
    setFailures(bad);
    setOutcome({ read: filed + dup, total: files.length, retry });
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
            <span className="grow">{t("receipts.needsYourEye")}<span className="sub">{t("toCheck.rowSub", { count: toCheck.items })}</span></span>
            <span className="opschip bad">{toCheck.items}</span><span className="chev">›</span></button>
        </div>)}
      <ReceiptJobCard sending={sending} tick={jobTick}
        onChange={() => { loadScan().catch(() => {}); loadArchive().catch(() => {}); }}
        onCheck={() => nav.show("tocheck")} />
      <div className="group pad">
        <label className={"btn primary wide receiptbtn" + (reading ? " dis" : "")} htmlFor="rc-photo" aria-disabled={!!reading || undefined} {...pickerProps("rc-photo")}>{reading ? t("receiptRead.button") : t("receipts.addReceipts")}</label>
        <p className="muted nomargin">{t("receipts.addAReceiptPhotoOr")}</p>
        <input type="file" id="rc-photo" accept="application/pdf,image/*" multiple hidden disabled={!!reading} onChange={onFiles} />
        {reading ? (
          <div id="rc-reading" role="status" aria-live="polite">
            <p className="nomargin rcread-head"><strong>{reading.n === 1 ? t("receiptRead.readingOne") : t("receiptRead.readingN", { i: reading.i, n: reading.n })}</strong></p>
            <div className={"pbar" + (reading.n === 1 ? " ind" : "")} role="progressbar" aria-valuemin={0} aria-valuemax={reading.n}
              aria-valuenow={reading.n === 1 ? undefined : reading.i - 1}><i style={reading.n === 1 ? undefined : { width: `${Math.max(4, ((reading.i - 1) / reading.n) * 100)}%` }} /></div>
            <p className="muted small nomargin">{reading.n === 1 ? t("receiptRead.readingOneSub") : t("receiptRead.readingNSub", { name: reading.name, filed: reading.filed })} {t("receiptRead.stay")}</p>
            {demo && <p className="rcread-demo" id="rc-demo-note">{t("receiptRead.demoNote")}</p>}
          </div>
        ) : <p className="muted nomargin" id="rc-photo-status">{status}</p>}
        {failures.length > 0 && (
          <div id="rc-photo-failures" role="alert">
            {outcome && <p className="nomargin"><strong>{t("receiptRead.doneHead", { read: outcome.read, total: outcome.total })}</strong></p>}
            <p className="muted nomargin"><strong>{outcome ? t("receiptRead.failedLine", { count: failures.length }) : t("receipts.failedHead", { count: failures.length })}</strong></p>
            {failures.slice(0, 5).map(f => <p key={f.name} className="muted small nomargin">{f.name}: {f.reason}</p>)}
            {failures.length > 5 && <p className="muted small nomargin">{t("receipts.failedMore", { n: failures.length - 5 })}</p>}
            <p className="nomargin rcread-acts">
              {outcome && outcome.retry.length > 0 && <button type="button" className="chip" id="rc-retry" onClick={() => { const f = outcome.retry; setFailures([]); readFiles(f); }}>{t("receiptRead.tryAgain")}</button>}
              <button type="button" className="chip" onClick={() => { setFailures([]); setOutcome(null); }}>{t("common.dismiss")}</button></p>
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
      {archive.receipts.length > 0 && (
        <div id="rc-filter" className="rcfilter">
          <div className="rcfield">
            <input type="search" id="rc-search" className="lv-search" autoComplete="off" maxLength={80} value={query}
              placeholder={t("receipts.searchPlaceholder")} aria-label={t("receipts.searchPlaceholder")}
              onChange={e => setQuery(e.target.value)} />
          </div>
          <div className="rcbar">
            <select id="rc-date" className={"rcsel" + (dateKey !== "all" ? " act" : "")} aria-label={t("receipts.dateLabel")}
              value={dateKey} onChange={e => setDateKey(e.target.value as DateKey)}>
              {DATE_KEYS.map(k => <option key={k} value={k}>{t("receipts.date_" + k)}</option>)}
            </select>
            <select id="rc-sort" className={"rcsel" + (sort !== "new" ? " act" : "")} aria-label={t("receipts.sortLabel")}
              value={sort} onChange={e => setSort(e.target.value as SortKey)}>
              {SORT_KEYS.map(k => <option key={k} value={k}>{t("receipts.sort_" + k)}</option>)}
            </select>
          </div>
          {dateKey === "custom" && (
            <div className="rcdates">
              <input type="date" id="rc-from" value={from} max={to || undefined} aria-label={t("receipts.dateFrom")} onChange={e => setFrom(e.target.value)} />
              <span className="sub">{t("receipts.dateTo")}</span>
              <input type="date" id="rc-to" value={to} min={from || undefined} aria-label={t("receipts.dateToAria")} onChange={e => setTo(e.target.value)} />
            </div>)}
          <p className="rcsum" id="rc-sum" aria-live="polite">
            <span>{filtered
              ? t("receipts.sumFiltered", { shown: shown.length, all: ofWho.length }) + (shown.length ? " · " + money(sum, currency) : "")
              : t("receipts.sumAll", { count: shown.length }) + (shown.length ? " · " + money(sum, currency) : "")}</span>
            {filtered && <button type="button" className="rcclear" id="rc-clear" onClick={clearFilters}>{t("receipts.clear")}</button>}
          </p>
        </div>)}
      <div id="rc-archive" className="group">
        {!loaded ? null : !unsettled.length && !ofWho.length ? <Empty>{t("receipts.noReceiptsFiledYet")}</Empty> : <>
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
          {!shown.length && ofWho.length > 0 && (
            <div className="rcnone" id="rc-none"><strong>{t("receipts.noMatch")}</strong>
              <span className="sub">{t("receipts.noMatchSub")}</span>
              <button type="button" className="rcclear" onClick={clearFilters}>{t("receipts.clearFilters")}</button></div>)}
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
