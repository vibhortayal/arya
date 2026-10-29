import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { useNav } from "../app/nav";
import { useSession } from "../app/session";
import { useToast } from "../ui/Toast";
import { AddReceiptSheet, decode, isPdfFile, type ReceiptTarget } from "../ui/AddReceiptSheet";
import { Empty, Row } from "../ui/kit";
import { get, post } from "../lib/api";
import { fmtDate, fmtShort, money } from "../lib/format";

/* Port of pwa/index.html #view-receipts and app.js renderReceipts,
 * renderScan (review queue), renderCurator, fileReceiptPhoto and the
 * Add-receipt sheet (quest.js openAddReceipt). A row opens the
 * receipt detail: nav.show("receipt", { receipt_id }). */

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Line = { receipt_id: string; idx: number; decoded_name?: string; raw: string; date?: string;
  suggested?: { name: string; source?: string }; alternatives?: string[] };
type Unresolved = { item_id: string; name: string; candidates?: string[]; sources?: Record<string, string> };
type Proposal = { id: string; kind: string; into_name?: string; names: string[]; reason: string };
type Rec = { receipt_id: string; merchant: string; purchased_at: string; items?: number; returns_total?: number;
  by?: string; mine?: boolean; totals_reconcile?: boolean; total?: number | null };
type Unsettled = { session_id: string; store: string; finished_at?: string; items_collected: number; items_total: number };
type Archive = { receipts: Rec[]; unsettled?: Unsettled[] };

export function Receipts() {
  const nav = useNav();
  const { demo, currency } = useSession();
  const { toast, showErr } = useToast();
  const [queue, setQueue] = useState<{ lines: Line[]; unresolved: Unresolved[] }>({ lines: [], unresolved: [] });
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [archive, setArchive] = useState<Archive>({ receipts: [] });
  // No "No receipts filed yet." until the archive has actually loaded.
  const [loaded, setLoaded] = useState(false);
  const [who, setWho] = useState("all");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const [curBusy, setCurBusy] = useState(false);
  const [ar, setAr] = useState<ReceiptTarget | null>(null);

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

  /* ---- Needs your eye: review queue ---- */
  const reviewLine = (r: string, idx: number, body: object, msg: string) => attempt(async () => {
    await post("/api/review/line", { receipt_id: r, idx, ...body });
    toast(msg);
    loadScan().catch(() => {});
  });
  const resolve = (item_id: string, name: string) => attempt(async () => {
    await post("/api/review/resolve", { item_id, name });
    toast(`Settled as ${name}.`);
    loadScan().catch(() => {});
  });
  // Opening an editor focuses its field, every time (old renderScan).
  const toggle = (key: string) => {
    const opening = !open[key];
    setOpen(o => ({ ...o, [key]: !o[key] }));
    if (opening) requestAnimationFrame(() =>
      document.querySelector<HTMLInputElement>(`[data-editor="${CSS.escape(key)}"] input`)?.focus());
  };

  const hasReview = queue.lines.length > 0 || queue.unresolved.length > 0;
  const hasCur = proposals.length > 0;

  /* ---- Archive ---- */
  const people = [...new Set(archive.receipts.filter(r => r.by && !r.mine).map(r => r.by as string))];
  const shared = archive.receipts.some(r => r.by);
  const whoNow = !shared || (who !== "all" && who !== "mine" && !people.includes(who)) ? "all" : who;
  const mineCount = archive.receipts.filter(r => r.mine).length;
  const count = !archive.receipts.length ? ""
    : shared && people.length
      ? `${archive.receipts.length} receipts from ${people.length + 1} people · ${mineCount} yours`
      : `${archive.receipts.length} receipts · every one digitized, total-checked, returns netted`;
  const shown = archive.receipts.filter(r => whoNow === "all" || (whoNow === "mine" ? r.mine : r.by === whoNow));
  const unsettled = archive.unsettled || [];

  const dismiss = (sid: string) => attempt(async () => {
    if (!confirm("Dismiss this hunt? It leaves your Receipts list. This cannot be undone.")) return;
    await post(`/api/quest/sessions/${encodeURIComponent(sid)}/delete`, {});
    toast("Hunt dismissed.");
    loadArchive().catch(showErr);
  });

  /* ---- Filing a photo or PDF ---- */
  const fileOne = async (file: File, label: string | undefined, withPreview: boolean, quiet: boolean) => {
    if (!file || !file.size) {
      if (!quiet) toast("That file arrived empty — if it is still downloading, wait for it to finish, then try again.");
      return { ok: false } as { ok: boolean; duplicate?: boolean };
    }
    setStatus(label || "Reading the receipt — this can take up to a minute.");
    if (withPreview) setPreview(null);
    try {
      const out = await decode(file);
      const rec = out.receipt || {};
      setStatus("");
      if (out.demo) {
        if (withPreview) setPreview(rec); else setStatus("Read live — kept for this demo visit only.");
        return { ok: true };
      }
      if (out.duplicate) {
        if (!quiet) toast(`Already filed — ${rec.merchant || "that receipt"}, ${fmtDate(rec.purchased_at)}. Skipped, so the trip is not counted twice.`);
        return { ok: true, duplicate: true };
      }
      if (!quiet) toast(`Filed ${rec.merchant || "the receipt"} — ${(rec.lines || []).length} lines. Each receipt makes your price comparisons sharper. Anything unsure is in Receipts, under Needs your eye.`);
      loadScan().catch(showErr);
      loadArchive().catch(() => {});
      return { ok: true };
    } catch (e) {
      setStatus("");
      if (!quiet) toast(`Could not read that ${isPdfFile(file) ? "file" : "photo"}: ` + errMsg(e));
      return { ok: false };
    }
  };

  const onFiles = async (ev: ChangeEvent<HTMLInputElement>) => {
    const files = [...(ev.target.files || [])];
    ev.target.value = "";
    if (!files.length) return;
    if (files.length === 1) { await fileOne(files[0], undefined, true, false); return; }
    let filed = 0, dup = 0, failed = 0;
    for (let i = 0; i < files.length; i++) {
      const res = await fileOne(files[i], `Reading ${i + 1} of ${files.length} — ${files[i].name}…`, false, true);
      if (res.duplicate) dup++; else if (res.ok) filed++; else failed++;
    }
    setStatus("");
    toast(`Bulk upload done: ${filed} filed${dup ? ` · ${dup} already filed, skipped` : ""}${failed ? ` · ${failed} could not be read` : ""}.`);
    loadScan().catch(showErr);
    loadArchive().catch(() => {});
  };

  const editor = (key: string, onSave: (name: string) => void, saveAttr: string, saveVal: string) => (
    <div className="editor" data-editor={key} hidden={!open[key]}>
      <input type="text" placeholder="Correct name" aria-label="Correct name" value={draft[key] || ""}
        onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))} />
      <button className="chip" {...{ [saveAttr]: saveVal }} type="button"
        onClick={() => { const n = (draft[key] || "").trim(); if (!n) { toast("Type the correct name first."); return; } onSave(n); }}>Save</button>
    </div>
  );

  return (
    <>
      <p><a href="#" id="rc-back" className="backlink" onClick={ev => { ev.preventDefault(); nav.back("profile"); }}>‹ Back</a></p>
      <h2 className="largetitle" style={{ fontSize: 28 }}>Receipts</h2>
      <p id="rc-count" className="subtitle">{count}</p>
      <h3 className="sect" id="eye-head" hidden={!hasReview && !hasCur}>Needs your eye</h3>
      <div id="review" className="group eyegroup" hidden={!hasReview}>
        {queue.lines.map(l => {
          const key = `${l.receipt_id}:${l.idx}`;
          return (
            <div key={key} style={{ display: "contents" }}>
              <div className="row"><div className="grow"><span className="name">{l.decoded_name || l.raw}</span>
                <span className="sub">Unverified · {fmtDate(l.date)} · from “{l.raw}”</span></div></div>
              <div className="actions">
                <button className="chip" data-confirm={key} onClick={() => reviewLine(l.receipt_id, l.idx, { action: "confirm" }, "Confirmed. It leaves the queue.")}>Looks right</button>
                {l.suggested && <>
                  <button className="chip" data-alt={key} data-name={l.suggested.name}
                    onClick={() => reviewLine(l.receipt_id, l.idx, { action: "rename", name: l.suggested!.name }, `Set to ${l.suggested!.name}. The dictionary learned it.`)}>Researched: {l.suggested.name}</button>
                  {l.suggested.source && <a className="sub" href={l.suggested.source} target="_blank" rel="noopener">source</a>}
                </>}
                {(l.alternatives || []).map(a => (
                  <button key={a} className="chip" data-alt={key} data-name={a}
                    onClick={() => reviewLine(l.receipt_id, l.idx, { action: "rename", name: a }, `Set to ${a}. The dictionary learned it.`)}>It is {a}</button>
                ))}
                <button className="chip" data-fix={key} onClick={() => toggle(key)}>Fix the name</button>
              </div>
              {editor(key, name => reviewLine(l.receipt_id, l.idx, { action: "rename", name }, `Set to ${name}. The dictionary learned it.`), "data-save-line", key)}
            </div>
          );
        })}
        {queue.unresolved.map(u => {
          const key = `u:${u.item_id}`;
          const srcs = Object.entries(u.sources || {});
          return (
            <div key={key} style={{ display: "contents" }}>
              <div className="row"><div className="grow"><span className="name">{u.name}</span>
                <span className="sub">Name not settled — kept off your list until you settle it</span></div></div>
              <div className="actions">
                {(u.candidates || []).map(cn => (
                  <button key={cn} className="chip" data-resolve={u.item_id} data-name={cn} onClick={() => resolve(u.item_id, cn)}>It is {cn}</button>
                ))}
                <button className="chip" data-fix={key} onClick={() => toggle(key)}>Set the name</button>
              </div>
              {srcs.length > 0 && (
                <div className="row"><span className="sub">Researched: {srcs.map(([n, href], i) => (
                  <span key={n}>{i > 0 && " · "}<a href={href} target="_blank" rel="noopener">{n}</a></span>))}</span></div>
              )}
              {editor(key, name => resolve(u.item_id, name), "data-save-resolve", u.item_id)}
            </div>
          );
        })}
      </div>
      <div id="curator" className="group eyegroup" hidden={!hasCur}>
        {proposals.map(p => (
          <div key={p.id} style={{ display: "contents" }}>
            <div className="row"><div className="grow">
              <span className="name">{p.kind === "merge" ? <>Merge into &ldquo;{p.into_name}&rdquo;</> : <>Keep &ldquo;{p.names[0]}&rdquo; separate</>}</span>
              <span className="sub">{p.names.join(" + ")} — {p.reason}</span></div></div>
            <div className="actions">
              <button className="chip" data-curator-apply={p.id} onClick={() => attempt(async () => {
                await post("/api/curator/decide", { id: p.id, action: "apply" });
                toast("Applied. The products are one now.");
                loadCurator();
              })}>Apply</button>
              <button className="chip" data-curator-dismiss={p.id} onClick={() => attempt(async () => {
                await post("/api/curator/decide", { id: p.id, action: "dismiss" });
                loadCurator();
              })}>Dismiss</button>
            </div>
          </div>
        ))}
        {hasCur && (
          <div className="row"><span className="sub grow">The Curator reasons about which products are the same item. Nothing changes until you apply it.</span>
            {!demo && <button className="btn" id="btn-curator-run" type="button" disabled={curBusy} onClick={() => attempt(async () => {
              setCurBusy(true);
              try {
                const r = await post("/api/curator/run");
                toast(r.proposals ? `The Curator proposed ${r.proposals} change(s).` : "The Curator found nothing to change.");
                loadCurator();
              } finally { setCurBusy(false); }
            })}>Ask the Curator</button>}
          </div>
        )}
      </div>
      <div className="group pad">
        <label className="field">Add a receipt photo or PDF
          <input type="file" id="rc-photo" accept="application/pdf,image/*" multiple onChange={onFiles} />
        </label>
        <p className="muted nomargin" id="rc-photo-status">{status}</p>
        <div id="rc-photo-preview">
          {preview && (
            <div className="group pad" style={{ marginTop: 10 }}>
              <p className="nomargin"><strong>{preview.merchant || "Receipt"}</strong> <span className="sub">read live · kept for this demo visit only</span></p>
              {(preview.lines || []).map((l: any, i: number) => (
                <Row key={i} name={l.decoded_name || l.raw || "line"} right={l.line_total != null ? money(l.line_total, currency) : ""} />
              ))}
              {preview.total != null && <Row name="Total" right={money(preview.total, currency)} />}
            </div>
          )}
        </div>
      </div>
      <h3 className="sect">Archive</h3>
      <div id="rc-who" className="segs" role="group" aria-label="Whose receipts" hidden={!people.length}>
        {people.length > 0 && ([["all", "Everyone"], ["mine", "Mine"], ...people.map(p => [p, cap(p)])] as string[][]).map(([k, label]) => (
          <button key={k} type="button" className={whoNow === k ? "on" : ""} data-rc-who={k} aria-pressed={whoNow === k} onClick={() => setWho(k)}>{label}</button>
        ))}
      </div>
      <div id="rc-archive" className="group">
        {!loaded ? null : !unsettled.length && !shown.length ? <Empty>No receipts filed yet.</Empty> : <>
          {unsettled.map(e => (
            <div key={e.session_id} className="sessrow">
              <span className="grow"><span className="name">{e.store}</span>
                <span className="sub">{fmtShort(String(e.finished_at || "").slice(0, 10))} · {e.items_collected} of {e.items_total} items collected</span></span>
              <span className="misstag">Receipt missing</span>
              <button className="btn" data-upload={e.session_id} data-store={e.store} type="button"
                onClick={() => { setAr({ sessionId: e.session_id, label: e.store }); }}>Add receipt</button>
              <button className="btn" data-dismiss={e.session_id} type="button" onClick={() => dismiss(e.session_id)}>Dismiss</button>
            </div>
          ))}
          {shown.map(r => (
            <button key={r.receipt_id} className="sessrow" data-receipt={r.receipt_id} type="button"
              onClick={() => nav.show("receipt", { receipt_id: r.receipt_id, id: r.receipt_id })}>
              <span className="grow"><span className="name">{r.merchant}</span>
                <span className="sub">{fmtShort(String(r.purchased_at).slice(0, 10))} · {r.items ? `${r.items} item${r.items === 1 ? "" : "s"}` : "no lines read"}
                  {r.returns_total ? ` · returns −${money(r.returns_total, currency)}` : ""}
                  {r.by ? (r.mine ? " · you" : <> · <span className="byp">{cap(r.by)}</span></>) : ""}</span></span>
              <span className="money">{r.totals_reconcile ? "✓ " : ""}{r.total != null ? money(r.total, currency) : ""}</span>
            </button>
          ))}
        </>}
      </div>

      {/* Old onDone was renderReceipts: the filed lines can land in Needs your eye. */}
      <AddReceiptSheet target={ar} onClose={() => setAr(null)} onDone={() => loadAll().catch(showErr)} />
    </>
  );
}
