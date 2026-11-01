import { useCallback, useEffect, useState } from "react";
import { useNav } from "../app/nav";
import { useSession } from "../app/session";
import { useToast } from "../ui/Toast";
import { Row } from "../ui/kit";
import { get, post } from "../lib/api";
import { fmtDate, fmtShort, money, qtyFmt } from "../lib/format";
import { useTranslation } from "../i18n";

/* To check (owner, 2026-11-01, option A): everything Arya is unsure about
 * on receipts, on its own screen so a big batch no longer pushes the
 * receipt list off Receipts. Lines of one product on several receipts are
 * one row; ten rows show at a time. Moved here from Receipts.tsx. */
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const PAGE = 10;

type Line = { receipt_id: string; idx: number; decoded_name?: string; raw: string; date?: string;
  merchant?: string; sku?: string; qty?: number; line_total?: number | null; confidence?: number;
  suggested?: { name: string; source?: string }; alternatives?: string[] };
type Unresolved = { item_id: string; name: string; candidates?: string[]; sources?: Record<string, string> };
type Proposal = { id: string; kind: string; into_name?: string; names: string[]; reason: string };
/* Lines of one product (same item number, else same printed text)
 * across receipts are asked about once. */
const lineKey = (l: Line) => l.sku ? "sku:" + l.sku : "raw:" + String(l.raw || "").toLowerCase().split(/\s+/).filter(Boolean).join(" ");

export function ToCheck() {
  const { t } = useTranslation();
  const nav = useNav();
  const { currency } = useSession();
  const { toast, showErr } = useToast();
  const [queue, setQueue] = useState<{ lines: Line[]; unresolved: Unresolved[] }>({ lines: [], unresolved: [] });
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [shown, setShown] = useState(PAGE);
  const [loaded, setLoaded] = useState(false);

  const loadScan = useCallback(async () => {
    const q = await get("/api/review");
    setQueue({ lines: q.lines || [], unresolved: q.unresolved || [] });
  }, []);
  const loadCurator = useCallback(async () => {
    const d = await get("/api/curator").catch(() => ({ proposals: [] }));
    setProposals(d.proposals || []);
  }, []);
  useEffect(() => {
    Promise.all([loadScan().catch(() => {}), loadCurator()]).then(() => setLoaded(true)).catch(showErr);
  }, [nav.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const attempt = async (f: () => Promise<void>) => { try { await f(); } catch (e) { toast(errMsg(e)); } };

  /* ---- Needs your eye: review queue ---- */
  const reviewLine = (r: string, idx: number, body: object, msg: string) => attempt(async () => {
    const out = await post<{ also?: number; undo?: unknown[] }>("/api/review/line", { receipt_id: r, idx, ...body });
    if (out?.also) {
      toast(msg + " " + t("receipts.alsoFixed", { count: out.also }), { action: t("receipts.undo"), onAction: () => {
        post("/api/review/undo", { changes: out.undo }).then(() => loadScan()).catch(showErr);
      } });
    } else toast(msg);
    loadScan().catch(() => {});
  });
  const resolve = (item_id: string, name: string) => attempt(async () => {
    await post("/api/review/resolve", { item_id, name });
    toast(t("receipts.settledAs", { name }));
    loadScan().catch(() => {});
  });
  // Opening an editor focuses its field, every time (old renderScan).
  const toggle = (key: string) => {
    const opening = !open[key];
    setOpen(o => ({ ...o, [key]: !o[key] }));
    if (opening) requestAnimationFrame(() =>
      document.querySelector<HTMLInputElement>(`[data-editor="${CSS.escape(key)}"] input`)?.focus());
  };

  const byKey = new Map<string, Line[]>();
  for (const l of queue.lines) byKey.set(lineKey(l), [...(byKey.get(lineKey(l)) || []), l]);
  const groups = [...byKey.values()].filter(g => g.length > 1);
  const singles = queue.lines.filter(l => (byKey.get(lineKey(l)) || []).length === 1);
  const hasReview = queue.lines.length > 0 || queue.unresolved.length > 0;
  const hasCur = proposals.length > 0;
  const vGroups = groups.slice(0, shown);
  const vSingles = singles.slice(0, Math.max(0, shown - groups.length));
  const hidden = groups.length + singles.length - vGroups.length - vSingles.length;
  const editor = (key: string, onSave: (name: string) => void, saveAttr: string, saveVal: string) => (
    <div className="editor" data-editor={key} hidden={!open[key]}>
      <input type="text" placeholder={t("receipts.correctName")} aria-label={t("receipts.correctName")} value={draft[key] || ""}
        onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))} />
      <button className="chip" {...{ [saveAttr]: saveVal }} type="button"
        onClick={() => { const n = (draft[key] || "").trim(); if (!n) { toast(t("receipts.typeNameFirst")); return; } onSave(n); }}>{t("common.save")}</button>
    </div>
  );

  const lines = queue.lines.length;
  const items = groups.length + singles.length + queue.unresolved.length + proposals.length;
  return (
    <>
      <p><a href="#" id="tc-back" className="backlink" onClick={ev => { ev.preventDefault(); nav.back("receipts"); }}><span aria-hidden="true">‹ </span>{t("common.back")}</a></p>
      <h1 className="largetitle" style={{ fontSize: 28 }}>{t("receipts.needsYourEye")}</h1>
      <p className="subtitle" id="tc-count">{items ? (lines > items ? t("toCheck.count", { items, lines }) : t("toCheck.rowSub", { count: items })) : ""}</p>
      {loaded && !hasReview && !hasCur && <p className="muted" id="tc-empty">{t("toCheck.allClear")}</p>}
      <div id="review" className="group eyegroup" hidden={!hasReview}>
        {vGroups.map(g => {
          const first = g[0];
          const key = "g:" + lineKey(first);
          const nm = first.decoded_name || first.raw;
          return (
            <div key={key} style={{ display: "contents" }}>
              <div className="row"><div className="grow"><span className="name">{nm} <span className="sub" style={{ display: "inline" }}>×{g.length}</span></span>
                <span className="sub">{[first.sku && t("receipts.itemNo", { sku: first.sku }), first.line_total != null && t("receipts.eachPrice", { amount: money(first.line_total, currency) }), t("receipts.onReceipts", { count: g.length })].filter(Boolean).join(" · ")}</span></div></div>
              {open["d:" + key] && g.map(l => (
                <div className="detail" key={`${l.receipt_id}:${l.idx}`}>
                  <Row name={[l.merchant, l.date && fmtShort(l.date)].filter(Boolean).join(" · ")} right={l.line_total != null ? money(l.line_total, currency) : ""} />
                </div>))}
              <div className="actions">
                <button className="chip" data-group-confirm={key} onClick={() => reviewLine(first.receipt_id, first.idx, { action: "confirm" }, t("receipts.confirmed"))}>{t("receipts.looksRightAll", { count: g.length })}</button>
                <button className="chip" data-group-menu={key} aria-expanded={!!open["m:" + key]} onClick={() => toggle("m:" + key)}>{t("receipts.more")}</button>
              </div>
              {open["m:" + key] && (
                <div className="actions">
                  <button className="chip" data-group-fix={key} onClick={() => toggle(key)}>{t("receipts.renameAll")}</button>
                  <button className="chip" data-group-more={key} aria-expanded={!!open["d:" + key]} onClick={() => toggle("d:" + key)}>{t(open["d:" + key] ? "receipts.hideThem" : "receipts.seeThem", { count: g.length })}</button>
                </div>)}
              {editor(key, name => reviewLine(first.receipt_id, first.idx, { action: "rename", name }, t("receipts.setTo", { name })), "data-save-group", key)}
            </div>
          );
        })}
        {vSingles.map(l => {
          const key = `${l.receipt_id}:${l.idx}`;
          return (
            <div key={key} style={{ display: "contents" }}>
              <div className="row"><div className="grow"><span className="name">{l.decoded_name || l.raw}</span>
                <span className="sub">{[l.merchant, l.date && fmtShort(l.date), l.line_total != null && money(l.line_total, currency)].filter(Boolean).join(" · ") || t("receipts.unverifiedFrom", { date: fmtDate(l.date), raw: l.raw })}</span></div></div>
              {open["d:" + key] && (
                <div className="detail" id={"detail-" + key}>
                  {l.line_total != null && <Row name={t("receipts.paid")} right={`${money(l.line_total, currency)}${l.qty && l.qty !== 1 ? ` (${qtyFmt(l.qty)} × ${money(l.line_total / l.qty, currency)})` : ""}`} />}
                  {l.merchant && <Row name={t("receipts.where")} right={l.merchant} />}
                  {l.date && <Row name={t("receipts.when")} right={fmtDate(l.date)} />}
                  <Row name={t("receipts.printedAs")} right={l.raw} />
                  {l.sku && <Row name={t("receipts.itemNumber")} right={l.sku} />}
                  {l.confidence != null && <Row name={t("receipts.confidence")} right={`${t(l.confidence >= 0.8 ? "receipts.confHigh" : l.confidence >= 0.65 ? "receipts.confMedium" : "receipts.confLow")} (${Math.round(l.confidence * 100)}%)`} />}
                </div>)}
              <div className="actions">
                <button className="chip" data-confirm={key} onClick={() => reviewLine(l.receipt_id, l.idx, { action: "confirm" }, t("receipts.confirmed"))}>{t("common.looksRight")}</button>
                {l.suggested && <>
                  <button className="chip" data-alt={key} data-name={l.suggested.name}
                    onClick={() => reviewLine(l.receipt_id, l.idx, { action: "rename", name: l.suggested!.name }, t("receipts.setTo", { name: l.suggested!.name }))}>{t("receipts.researched", { name: l.suggested.name })}</button>
                  {l.suggested.source && <a className="sub" href={l.suggested.source} target="_blank" rel="noopener">{t("receipts.source")}</a>}
                </>}
                {(l.alternatives || []).map(a => (
                  <button key={a} className="chip" data-alt={key} data-name={a}
                    onClick={() => reviewLine(l.receipt_id, l.idx, { action: "rename", name: a }, t("receipts.setTo", { name: a }))}>{t("receipts.itIs", { a })}</button>
                ))}
                <button className="chip" data-fix={key} onClick={() => toggle(key)}>{t("receipts.fixTheName")}</button>
                <button className="chip" data-more={key} aria-expanded={!!open["d:" + key]} onClick={() => toggle("d:" + key)}>{t(open["d:" + key] ? "receipts.fewerDetails" : "receipts.moreDetails")}</button>
              </div>
              {editor(key, name => reviewLine(l.receipt_id, l.idx, { action: "rename", name }, t("receipts.setTo", { name })), "data-save-line", key)}
            </div>
          );
        })}
        {queue.unresolved.map(u => {
          const key = `u:${u.item_id}`;
          const srcs = Object.entries(u.sources || {});
          return (
            <div key={key} style={{ display: "contents" }}>
              <div className="row"><div className="grow"><span className="name">{u.name}</span>
                <span className="sub">{t("receipts.nameNotSettledKeptOff")}</span></div></div>
              <div className="actions">
                {(u.candidates || []).map(cn => (
                  <button key={cn} className="chip" data-resolve={u.item_id} data-name={cn} onClick={() => resolve(u.item_id, cn)}>{t("receipts.itIsName", { cn })}</button>
                ))}
                <button className="chip" data-fix={key} onClick={() => toggle(key)}>{t("receipts.setTheName")}</button>
              </div>
              {srcs.length > 0 && (
                <div className="row"><span className="sub">{t("receipts.researchedLabel")}{" "}{srcs.map(([n, href], i) => (
                  <span key={n}>{i > 0 && " · "}<a href={href} target="_blank" rel="noopener">{n}</a></span>))}</span></div>
              )}
              {editor(key, name => resolve(u.item_id, name), "data-save-resolve", u.item_id)}
            </div>
          );
        })}
        {hidden > 0 && (
          <div className="actions"><button className="chip" id="tc-more" type="button" onClick={() => setShown(n => n + PAGE)}>{t("toCheck.showMore", { count: Math.min(PAGE, hidden) })}</button></div>)}
      </div>
      {/* The approved wireframe (owner, 2026-10-29; app.js
        * renderCurator): shown only when there is something to decide,
        * one card per question, Arya's voice only, no internal names,
        * no manual trigger. The card asks, the user decides, it goes. */}
      <div id="curator" hidden={!hasCur}>
        {proposals.map(p => {
          const merge = p.kind === "merge";
          return (
            <div key={p.id} className="group pad askcard">
              <p className="askq">{merge ? t("receipts.sameItemQ") : t("receipts.staySeparateQ")}</p>
              {p.names.map((n: string) => <p className="askitem" key={n}>{n}</p>)}
              <p className="sub">{merge
                ? t("receipts.mergeWhy")
                : t("receipts.splitWhy")}</p>
              <div className="actions">
                <button className="btn primary" data-curator-apply={p.id} data-kind={p.kind} onClick={() => attempt(async () => {
                  await post("/api/curator/decide", { id: p.id, action: "apply" });
                  toast(merge ? t("receipts.oneItemNow") : t("receipts.keptSeparate"));
                  loadCurator();
                })}>{merge ? t("receipts.yesSame") : t("receipts.yesSeparate")}</button>
                <button className="btn" data-curator-dismiss={p.id} data-kind={p.kind} onClick={() => attempt(async () => {
                  await post("/api/curator/decide", { id: p.id, action: "dismiss" });
                  toast(merge ? t("receipts.keptSeparate") : t("receipts.leftAsOne"));
                  loadCurator();
                })}>{merge ? t("receipts.noSeparate") : t("receipts.noSame")}</button>
              </div>
            </div>
          );
        })}
      </div>

    </>
  );
}
