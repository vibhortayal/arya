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
 * one card; ten cards show at a time. Moved here from Receipts.tsx.
 *
 * Smart suggestions (owner, 2026-11-01; mockup 4RWY3Q5tjLScQkJdNUdrpm):
 * each card leads with Arya's guess (api clean.suggest_review, PR #366)
 * over the printed text, with Use this name, Fix and Keep printed. Sure
 * guesses (confidence 0.85 or more, owner) can all be used with one tap
 * and one Undo. Opening the screen asks for guesses still missing. */
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const PAGE = 10;
/* "Sure" (owner, 2026-11-01): a guess at this confidence or more joins
 * the one-tap batch; below it the card says "not sure". */
export const SURE = 0.85;
/* The store sections a guess can carry (api/dictionary/enrich.py SECTIONS). */
export const SECTIONS = ["produce", "dairy & eggs", "meat & seafood", "bakery", "frozen", "pantry", "beverages",
  "snacks", "household", "personal care", "other"] as const;

export type Line = { receipt_id: string; idx: number; decoded_name?: string; raw: string; date?: string;
  merchant?: string; sku?: string; qty?: number; line_total?: number | null; confidence?: number;
  suggested?: { name: string; source?: string; section?: string; confidence?: number; by?: string } | null;
  suggest_tried?: boolean; alternatives?: string[]; status?: string };
type Unresolved = { item_id: string; name: string; candidates?: string[]; sources?: Record<string, string> };
type Proposal = { id: string; kind: string; into_name?: string; names: string[]; reason: string };
/* Lines of one product (same item number, else same printed text)
 * across receipts are asked about once. */
export const lineKey = (l: Line) => l.sku ? "sku:" + l.sku : "raw:" + String(l.raw || "").toLowerCase().split(/\s+/).filter(Boolean).join(" ");

/* Sure guesses first, then not-sure ones, then lines with no guess;
 * inside each, the item on the most receipts first. */
export const isSure = (g: Line[]) => (g[0].suggested?.confidence ?? 0) >= SURE && !!g[0].suggested?.name;
const rank = (g: Line[]) => (isSure(g) ? 0 : g[0].suggested?.name ? 1 : 2);
export function orderCards(lines: Line[]): Line[][] {
  const byKey = new Map<string, Line[]>();
  for (const l of lines) byKey.set(lineKey(l), [...(byKey.get(lineKey(l)) || []), l]);
  return [...byKey.values()].sort((a, b) => rank(a) - rank(b) || b.length - a.length);
}

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
  const [sect, setSect] = useState<Record<string, string>>({});
  // While Arya is guessing names still missing, those cards say so.
  const [reading, setReading] = useState(false);

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
    // Ask Arya for the guesses still missing (PR #366), then show them.
    let live = true;
    get<{ lines?: Line[] }>("/api/review").then(q => {
      if (!(q.lines || []).some(l => !l.suggested && !l.suggest_tried)) return;
      setReading(true);
      return post("/api/review/smart-pass", {}).then(() => { if (live) return loadScan(); });
    }).catch(() => {}).finally(() => { if (live) setReading(false); });
    return () => { live = false; };
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

  const cards = orderCards(queue.lines);
  const hasReview = queue.lines.length > 0 || queue.unresolved.length > 0;
  const hasCur = proposals.length > 0;
  const vCards = cards.slice(0, shown);
  const hidden = cards.length - vCards.length;
  const sure = cards.filter(isSure);
  const guessed = cards.filter(g => !!g[0].suggested?.name).length;
  const editor = (key: string, onSave: (name: string) => void, saveAttr: string, saveVal: string, label?: string, section?: boolean) => (
    <div className={"editor" + (section ? " tc-ed" : "")} data-editor={key} hidden={!open[key]}>
      <input type="text" placeholder={t("receipts.correctName")} aria-label={t("receipts.correctName")} value={draft[key] || ""}
        onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))} />
      {section && (
        <select aria-label={t("toCheck.section")} value={sect[key] || ""} onChange={e => setSect(x => ({ ...x, [key]: e.target.value }))}>
          <option value="">{t("toCheck.section")}</option>
          {SECTIONS.map(v => <option key={v} value={v}>{t(`toCheck.sections.${v}`)}</option>)}
        </select>)}
      <button className="chip" {...{ [saveAttr]: saveVal }} type="button"
        onClick={() => { const n = (draft[key] || "").trim(); if (!n) { toast(t("receipts.typeNameFirst")); return; } onSave(n); }}>{label || t("common.save")}</button>
    </div>
  );
  // Fix opens with Arya's guess and its section already filled in.
  const openFix = (key: string, g: Line[]) => {
    const s0 = g[0].suggested;
    if (!open[key]) {
      setDraft(d => ({ ...d, [key]: d[key] || s0?.name || "" }));
      setSect(x => ({ ...x, [key]: x[key] || s0?.section || "" }));
    }
    toggle(key);
  };
  const useSure = () => attempt(async () => {
    const items = sure.map(g => ({ receipt_id: g[0].receipt_id, idx: g[0].idx, name: g[0].suggested!.name, section: g[0].suggested!.section }));
    const out = await post<{ done: number; undo: unknown[] }>("/api/review/accept", { items });
    const names = sure.slice(0, 2).map(g => g[0].suggested!.name.split(" - ")[0]);
    const list = out.done > 2 ? t("toCheck.bulkMore", { names: names.join(", "), count: out.done - 2 }) : names.slice(0, out.done).join(", ");
    toast(t("toCheck.bulkDone", { count: out.done, names: list }), { action: t("receipts.undo"), onAction: () => {
      post("/api/review/undo", { changes: out.undo }).then(() => loadScan()).catch(showErr);
    } });
    loadScan().catch(() => {});
  });

  const lines = queue.lines.length;
  const items = cards.length + queue.unresolved.length + proposals.length;
  return (
    <>
      <p><a href="#" id="tc-back" className="backlink" onClick={ev => { ev.preventDefault(); nav.back("receipts"); }}><span aria-hidden="true">‹ </span>{t("common.back")}</a></p>
      <h1 className="largetitle" style={{ fontSize: 28 }}>{t("receipts.needsYourEye")}</h1>
      <p className="subtitle" id="tc-count">{items ? (lines > items ? t("toCheck.count", { items, lines }) : t("toCheck.rowSub", { count: items })) : ""}</p>
      {loaded && !hasReview && !hasCur && <p className="muted" id="tc-empty">{t("toCheck.allClear")}</p>}
      {sure.length > 0 && (
        <div className="group tc-bulk" id="tc-bulk">
          <b>{t("toCheck.bulkTitle", { count: guessed })}</b>
          <p>{t("toCheck.bulkLine", { count: sure.length })}</p>
          <button className="btn primary wide" id="tc-use-sure" type="button" onClick={useSure}>{t("toCheck.bulkUse", { count: sure.length })}</button>
        </div>)}
      <div id="review" className="group eyegroup" hidden={!hasReview}>
        {vCards.map(g => {
          const first = g[0];
          const key = "g:" + lineKey(first);
          const sg = first.suggested?.name ? first.suggested : null;
          const printed = first.decoded_name || first.raw;
          const kick = sg ? t(isSure(g) ? "toCheck.guess" : "toCheck.guessUnsure")
            : reading && !first.suggest_tried ? t("toCheck.reading") : first.suggest_tried ? t("toCheck.unreadable") : "";
          const meta = [sg && t("toCheck.printed", { raw: first.raw }), first.sku && t("receipts.itemNo", { sku: first.sku }),
            first.line_total != null && (g.length > 1 ? t("receipts.eachPrice", { amount: money(first.line_total, currency) }) : money(first.line_total, currency)),
            g.length > 1 ? t("receipts.onReceipts", { count: g.length }) : [first.merchant, first.date && fmtShort(first.date)].filter(Boolean).join(" · ")].filter(Boolean).join(" · ");
          const rename = (name: string, section?: string) => reviewLine(first.receipt_id, first.idx, { action: "rename", name, ...(section ? { section } : {}) }, t("receipts.setTo", { name }));
          return (
            <div key={key} style={{ display: "contents" }} data-card={key} data-sure={isSure(g) ? "1" : undefined}>
              <div className="row"><div className="grow">
                {kick && <span className={"tc-kick" + (sg && isSure(g) ? "" : " unsure")}>{kick}</span>}
                <span className={"name" + (sg ? "" : " tc-raw")}>{sg ? sg.name : printed}{!sg && g.length > 1 && <span className="sub" style={{ display: "inline" }}> ×{g.length}</span>}</span>
                <span className="sub">{meta}</span>
                {sg?.section && <span className="tc-sect">{t(`toCheck.sections.${sg.section}`)}</span>}
                {sg?.source && <a className="sub" href={sg.source} target="_blank" rel="noopener">{t("receipts.source")}</a>}
              </div></div>
              {open["d:" + key] && (g.length > 1 ? g.map(l => (
                <div className="detail" key={`${l.receipt_id}:${l.idx}`}>
                  <Row name={[l.merchant, l.date && fmtShort(l.date)].filter(Boolean).join(" · ")} right={l.line_total != null ? money(l.line_total, currency) : ""} />
                </div>)) : (
                <div className="detail" id={"detail-" + key}>
                  {first.line_total != null && <Row name={t("receipts.paid")} right={`${money(first.line_total, currency)}${first.qty && first.qty !== 1 ? ` (${qtyFmt(first.qty)} × ${money(first.line_total / first.qty, currency)})` : ""}`} />}
                  {first.merchant && <Row name={t("receipts.where")} right={first.merchant} />}
                  {first.date && <Row name={t("receipts.when")} right={fmtDate(first.date)} />}
                  <Row name={t("receipts.printedAs")} right={first.raw} />
                  {first.sku && <Row name={t("receipts.itemNumber")} right={first.sku} />}
                  {first.confidence != null && <Row name={t("receipts.confidence")} right={`${t(first.confidence >= 0.8 ? "receipts.confHigh" : first.confidence >= 0.65 ? "receipts.confMedium" : "receipts.confLow")} (${Math.round(first.confidence * 100)}%)`} />}
                </div>))}
              <div className="actions">
                {sg ? <>
                  <button className="btn primary tc-use" data-use={key} type="button" onClick={() => rename(sg.name, sg.section)}>{t("toCheck.use")}</button>
                  <button className="chip" data-group-fix={key} type="button" onClick={() => openFix(key, g)}>{t("toCheck.fix")}</button>
                  <button className="chip" data-group-confirm={key} type="button" onClick={() => reviewLine(first.receipt_id, first.idx, { action: "confirm" }, t("toCheck.kept"))}>{t("toCheck.keep")}</button>
                </> : <>
                  <button className="chip" data-group-fix={key} type="button" onClick={() => openFix(key, g)}>{t("toCheck.typeName")}</button>
                  <button className="chip" data-group-confirm={key} type="button" onClick={() => reviewLine(first.receipt_id, first.idx, { action: "confirm" }, t("toCheck.kept"))}>{t("toCheck.keep")}</button>
                  {(first.alternatives || []).map(a => (
                    <button key={a} className="chip" data-alt={key} data-name={a} type="button" onClick={() => rename(a)}>{t("receipts.itIs", { a })}</button>))}
                </>}
                <button className="linkbtn tc-details" data-group-more={key} type="button" aria-expanded={!!open["d:" + key]} onClick={() => toggle("d:" + key)}>{t(open["d:" + key] ? "toCheck.hideDetails" : "toCheck.details")}</button>
              </div>
              {editor(key, name => rename(name, sect[key] || undefined), "data-save-group", key, g.length > 1 ? t("toCheck.saveAll", { count: g.length }) : undefined, true)}
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
