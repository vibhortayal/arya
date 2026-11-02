import { useEffect, useRef, useState, type FormEvent } from "react";
import { askList, type NeedList } from "../lib/listPick";
import { orderLists } from "../ui/ListPick";
import { withBar } from "../lib/bar";
import { clearOnSignOut, useSession } from "../app/session";
import { ApiError, get, post } from "../lib/api";
import { isOwnKeyOffer, requestOwnKey } from "../lib/ownKey";
import { startCapture, transcribeBlob, voiceSupported, type Capture } from "../lib/recorder";
import { ListeningCard } from "../ui/Listening";
import { useToast } from "../ui/Toast";
import { useNav } from "../app/nav";
import { IconMic } from "../ui/icons";
import { pickerProps } from "../ui/picker";
import { decode } from "../ui/AddReceiptSheet";
import { languageToast, offerFor, offerRefused, refuseOffer } from "../lib/language";
import "../ui/language.css";
import { t, useTranslation } from "../i18n";
import { EditList, EditTitle } from "../ui/EditList";
import { fitPhoto } from "../lib/photo";

/* Port of "Ask Arya + voice" (pwa/app.js, pwa/index.html #view-chat).
 * The log and the history outlive the screen, as the old DOM did.
 * An "offer" line is the one-time "Reply in <language> from now on?"
 * card (assistant/docs/MULTILINGUAL-ASK.md): on Auto, after a reply to
 * a non-English message; at most once per session, never after No. */
/* Photos (owner 2026-10-30, mockup NHfgHczqWEcnSvUGpKd3Rm): the Photo chip
 * opens the camera, then Arya asks what to do with it. Add to my list,
 * File a receipt, Check my fridge and Read the date use the readers that
 * already exist; Ask about this photo sends it once with the next
 * question and keeps nothing. No voice out: Arya's replies are text. */
type Chip = { label: string; run: () => void };
type Line = { kind: "me" | "arya" | "sys" | "actionchip" | "offer" | "map" | "err" | "photo" | "choose" | "working" | "thinking"; text: string; code?: string; offer?: string;
  url?: string; file?: File; sub?: string; chips?: Chip[]; job?: number };
type Msg = { role: "user" | "assistant"; content: string; applied?: string[] };
const lines: Line[] = [];
const history: Msg[] = [];
let offered = false;
/* Bumps on sign out: the log and history are this account's only, and
 * a reply still in flight from before must not land in the next one. */
let epoch = 0;
clearOnSignOut(() => {
  lines.length = 0; history.length = 0; epoch++; offered = false;
});
/* Suggested questions: en.json keys, sent as the question text. */
/* Starter chips come from the household's own data (relevant cards,
 * owner 2026-10-30): a running-low item, dated food, a cheaper store,
 * this month's spend. A new account gets list-building ones. Four at
 * most; Map my store always follows (owner rule, #183). */
export type ChipHome = {
  as_of?: string; running_low?: { name: string }[]; use_soon?: unknown[];
  lists?: { name: string }[]; price_by_store?: Record<string, Record<string, { median: number }>>;
  list?: { items?: { item_id: string; name: string; on_list?: boolean; checked?: boolean }[] };
} | null;
export function askChips(h: ChipHome, today: Date = new Date()): string[] {
  const out: string[] = [];
  if (!h) return [t("ask.suggest.addEggs")];
  const low = h.running_low?.[0];
  if (low) out.push(t("ask.suggest.needIt", { name: low.name }));
  if (h.use_soon?.length) out.push(t("ask.suggest.useFirst"));
  const onList = (h.list?.items || []).filter(i => i.on_list && !i.checked);
  const gap = onList.find(i => {
    const by = Object.values(h.price_by_store?.[i.item_id] || {}).map(p => p.median).filter(m => m > 0);
    return by.length >= 2 && Math.max(...by) - Math.min(...by) >= 0.25;
  });
  if (gap) out.push(t("ask.suggest.cheaper", { name: gap.name }));
  const month = today.toLocaleString("en", { month: "long" });
  if (h.as_of && h.as_of.slice(0, 7) === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`) out.push(t("ask.suggest.spendIn", { month }));
  if (!out.length) {
    const first = h.lists?.[0]?.name;
    out.push(first ? t("ask.suggest.addTo", { list: first }) : t("ask.suggest.addEggs"));
    out.push(t("ask.suggest.howKnow"));
  }
  return out.slice(0, 4);
}

/* "map my store", "help me scan this store", "teach Arya the aisles":
 * Arya answers by opening Map my store (owner, 2026-10-29). */
export const wantsMapStore = (q: string) =>
  /\b(map|mapping|scan|scanning|teach)\b/i.test(q) && /\b(store|shop|aisles?|shelves|supermarket)\b/i.test(q) && !/\breceipts?\b/i.test(q);

/* A photo asked about is shrunk first: the question and the picture go in
 * one request, so it stays well under the server's cap. */
export async function shrinkPhoto(f: File, max = 1600): Promise<{ media_type: string; data: string }> {
  const b64 = (blob: Blob) => new Promise<string>((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1] || "");
    r.onerror = () => no(r.error);
    r.readAsDataURL(blob);
  });
  try {
    const bmp = await createImageBitmap(f);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>(ok => c.toBlob(ok, "image/jpeg", 0.85));
    if (blob) return { media_type: "image/jpeg", data: await b64(blob) };
  } catch { /* fall through: compress the way receipts are */ }
  const small = await fitPhoto(f);
  if (small.size > 5_000_000) throw new Error(t("ask.photoTooLarge"));
  return { media_type: small.type || "image/jpeg", data: await b64(small) };
}
type ExpiryRead = { readable: boolean; name?: string | null; date?: string | null; kind?: string; match?: { item_id: string; name: string } | null };
const readJson = async (r: Response) => {
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { detail?: string }).detail || `HTTP ${r.status}`);
  return r.json();
};
const post_photo = async (url: string, original: File) => {
  const f = await fitPhoto(original);
  return fetch(url, { method: "POST", headers: { "Content-Type": f.type || "image/jpeg" }, body: f }).then(readJson);
};

export function Chat() {
  const { t } = useTranslation();
  const { language, languages, setLanguage, layouts = {}, saveLayout } = useSession();
  // Edit mode (card library, 2026-10-30): your own quick questions.
  const [editing, setEditing] = useState(false);
  const [newQ, setNewQ] = useState("");
  const { toast } = useToast();
  const nav = useNav();
  const [log, setLog] = useState<Line[]>(() => lines.slice());
  const [text, setText] = useState("");
  const [pending, setPending] = useState<{ file: File; url: string } | null>(null);
  const [listening, setListening] = useState(false);
  const [reading, setReading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // An answer is on its way: Send waits, so a second tap never asks twice (#4).
  const [busy, setBusy] = useState(false);
  const [home, setHome] = useState<ChipHome>(null);
  useEffect(() => { let live = true; get<ChipHome>("/api/home").then(h => live && setHome(h), () => {}); return () => { live = false; }; }, []);
  const capture = useRef<Capture | null>(null);
  const job = useRef(0);
  const picker = useRef<HTMLInputElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const naming = useRef<((name: string) => Promise<void>) | null>(null);
  const logEl = useRef<HTMLDivElement>(null);

  const toEnd = () => (logEl.current?.lastElementChild as HTMLElement | null | undefined)?.scrollIntoView?.({ block: "end" });
  useEffect(() => { toEnd(); }, [log]);

  // The mic never outlives the screen.
  useEffect(() => () => { capture.current?.cancel(); capture.current = null; }, []);

  const add = (...l: Line[]) => { lines.push(...l); setLog(lines.slice()); };
  const dropOffer = () => {
    const i = lines.findIndex(l => l.kind === "offer");
    if (i >= 0) lines.splice(i, 1);
    setLog(lines.slice());
  };
  const offerNo = () => { refuseOffer(); dropOffer(); };
  const offerYes = async (code: string) => {
    try {
      const r = await post<{ language: string }>("/api/settings", { language: code });
      setLanguage(r.language);
      dropOffer();
      toast(languageToast(r.language, languages));
    } catch (e) { toast(e instanceof Error ? e.message : String(e)); }
  };

  const drop = (l: Line) => { const i = lines.indexOf(l); if (i >= 0) lines.splice(i, 1); };

  /* ---- Photo: pick, choose, run ---- */
  /* One-time notice the first time a photo or voice is read (owner, 2026-10-31). */
  const aiOnce = () => {
    try { if (localStorage.getItem("arya-ai-notice")) return; localStorage.setItem("arya-ai-notice", "1"); } catch { return; }
    toast(t("ai.once"));
  };
  const onPhoto = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0];
    ev.target.value = "";
    if (!f) return;
    if (!f.type.startsWith("image/")) { toast(t("ask.photoNotImage")); return; }
    aiOnce();
    add({ kind: "photo", text: "", url: URL.createObjectURL(f) }, { kind: "choose", text: "", file: f });
  };
  const failed = (w: Line, retry: () => void) => {
    drop(w);
    add({ kind: "arya", text: t("ask.photoFail"), sub: t("ask.photoFailBody"), chips: [{ label: t("ask.tryAnotherPhoto"), run: retry }] });
  };
  /* One reader at a time; Cancel (or the next photo) makes a late answer
   * from an older job land nowhere. */
  const run = async (c: Line, kind: "list" | "receipt" | "fridge" | "date") => {
    const f = c.file!;
    drop(c);
    const w: Line = { kind: "working", text: t("ask.reading." + kind), job: ++job.current };
    add(w);
    const mine = epoch, jid = job.current;
    const live = () => mine === epoch && jid === job.current;
    const done = (...l: Line[]) => { if (!live()) return; drop(w); add(...l); };
    try {
      if (kind === "list") {
        const out = await post_photo("/api/list/from-photo", f) as { kind: string; names: string[]; added: number; needs_list?: NeedList };
        if (out.needs_list) {
          // Every item on a list: one chip per list (the usual one first),
          // or the sheet to make a list first.
          const names = out.names || [];
          const fileOn = async (l: { id: string; name: string }) => {
            try {
              await post("/api/list/from-text", { text: names.join("\n"), list_id: l.id });
              add({ kind: "arya", text: t("listPick.addedTo", { what: names.join(", "), list: l.name }) });
            } catch (e) { add({ kind: "arya", text: e instanceof Error ? e.message : String(e) }); }
          };
          const lists = orderLists(out.needs_list.lists || [], out.needs_list.suggested);
          if (!lists.length) {
            done({ kind: "arya", text: t("listPick.firstTitle"), chips: [{ label: t("listPick.makeAList"), run: async () => { const p = await askList({ ...out.needs_list!, names }); if (p) await fileOn(p); } }] });
          } else {
            done({ kind: "arya", text: t("listPick.whichFor", { what: names.join(", ") }), chips: lists.slice(0, 6).map(l => ({ label: l.name, run: () => fileOn(l) })) });
          }
        } else if (out.kind === "receipt") {
          done({ kind: "arya", text: t("ask.looksLikeReceipt"), chips: [{ label: t("ask.opt.receipt"), run: () => run({ kind: "choose", text: "", file: f }, "receipt") }] });
        } else if (!out.added) {
          done({ kind: "arya", text: t("ask.noListFound"), sub: t("ask.nothingChanged") });
        } else {
          done({ kind: "arya", text: t("ask.addedItems", { names: out.names.join(", ") }) });
        }
      } else if (kind === "receipt") {
        const out = await decode(f);
        const rec = out.receipt || {};
        if (out.demo) done({ kind: "arya", text: t("common.receiptFile.demo") });
        else if (out.duplicate) done({ kind: "arya", text: t("common.receiptFile.duplicate", { merchant: rec.merchant || t("common.receiptFile.thatReceipt"), date: rec.purchased_at ? String(rec.purchased_at).slice(0, 10) : "" }) });
        else done({ kind: "arya", text: t("common.receiptFile.filed", { merchant: rec.merchant || t("common.receiptFile.theReceipt"), n: (rec.lines || []).length }) });
      } else if (kind === "fridge") {
        const rec = await post_photo("/eyes/photo", f) as { sightings?: { name: string }[] };
        const names = (rec.sightings || []).map(x => x.name);
        done(names.length
          ? { kind: "arya", text: t("ask.fridgeSaw", { names: names.join(", ") }), sub: t("ask.fridgeKept") }
          : { kind: "arya", text: t("ask.fridgeNone"), sub: t("ask.fridgeKept") });
      } else {
        const rd = await post_photo("/api/expiry/read", f) as ExpiryRead;
        if (!rd.readable || !rd.date) done({ kind: "arya", text: t("ask.dateNone"), sub: t("ask.nothingChanged"), chips: [{ label: t("ask.tryAnotherPhoto"), run: () => picker.current?.click() }] });
        else {
          const when = new Date(rd.date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
          const name = rd.match?.name || rd.name || t("ask.thisItem");
          const track = async (nm: string | null | undefined) => {
            try {
              await post("/api/expiry/save", { item_id: rd.match?.item_id, name: nm, date: rd.date, kind: rd.kind });
              const typed = !!naming.current;
              naming.current = null;
              add({ kind: "sys", text: t("ask.dateTracked", { name: (typed && nm) || name, date: when }) });
            } catch (e) { add({ kind: "sys", text: t("ask.trackFail") }); }
          };
          done({ kind: "arya", text: t("ask.dateRead", { name, date: when }), chips: [{ label: t("ask.trackIt"), run: async () => {
            if (rd.match?.item_id || rd.name) await track(rd.name);
            else { naming.current = track; add({ kind: "arya", text: t("ask.nameIt") }); input.current?.focus(); }
          } }] });
        }
      }
    } catch (e) {
      if (live()) failed(w, () => picker.current?.click());
    }
  };
  const cancelWork = (w: Line) => { job.current++; drop(w); setLog(lines.slice()); };
  const askAbout = (c: Line) => {
    drop(c);
    const p = lines.filter(l => l.kind === "photo").pop();
    setPending({ file: c.file!, url: p?.url || URL.createObjectURL(c.file!) });
    setLog(lines.slice());
    input.current?.focus();
  };

  /* A failed answer leaves a "Try again" chip that asks the same question
   * again (UI/UX pass, issue 8): the failed bubbles go, the question stays. */
  const retry = (q: string) => {
    const i = lines.findIndex(l => l.kind === "err" && l.code === q);
    if (i >= 0) lines.splice(i, 1);
    send(q, true);
  };
  const send = async (raw: string, again = false) => {
    const q = raw.trim();
    if (!q) { toast(t("ask.typeFirst")); input.current?.focus(); return; }
    setText("");
    if (naming.current) { const go = naming.current; add({ kind: "me", text: q }); await go(q.slice(0, 80)); return; }
    if (wantsMapStore(q)) {
      add({ kind: "me", text: q }, { kind: "map", text: t("ask.mapStoreReply") });
      return;
    }
    history.push({ role: "user", content: q });
    const pic = again ? null : pending;
    if (pic) { setPending(null); add({ kind: "photo", text: "", url: pic.url }); }
    if (!again) add({ kind: "me", text: q }); else setLog(lines.slice());
    const mine = epoch;
    // "Arya is thinking…" shows at once, so the wait never looks broken
    // (speed audit #4, #30).
    const think: Line = { kind: "thinking", text: t("common.aryaThinking") };
    add(think);
    setBusy(true);
    const stop = () => { drop(think); if (mine === epoch) setBusy(false); };
    try {
      const image = pic ? await shrinkPhoto(pic.file) : undefined;
      const res = await post<{ reply: string; applied?: string[]; skipped?: string[] }>("/api/chat", withBar(image ? { messages: history, image } : { messages: history }));
      stop();
      if (mine !== epoch) return;
      history.push({ role: "assistant", content: res.reply, ...(res.applied?.length ? { applied: res.applied } : {}) });
      const offer = !offered && !offerRefused() ? offerFor(language, q, languages) : null;
      if (offer) offered = true;
      // The ✓ lines confirm the actions; an empty reply adds no bubble of its own (retest #9).
      add(...(res.reply.trim() || !(res.applied || []).length ? [{ kind: "arya" as const, text: res.reply }] : []),
        ...(res.applied || []).map(a => ({ kind: "actionchip" as const, text: "✓ " + a })),
        ...(res.skipped || []).map(a => ({ kind: "sys" as const, text: a })),
        ...(offer ? [{ kind: "offer" as const, text: offer.name, code: offer.code }] : []));
    } catch (e) {
      stop();
      if (mine !== epoch) { setLog(lines.slice()); return; }
      history.pop();
      // Arya's daily limit (or a failed own key): a card that offers the shopper's own Meta key.
      if (e instanceof ApiError && isOwnKeyOffer(e.offer)) { add({ kind: "err", text: e.message, code: q, offer: e.offer }); return; }
      add({ kind: "err", text: t("ask.couldNotAnswer", { error: e instanceof Error ? e.message : String(e) }), code: q });
    }
  };

  const mic = async () => {
    if (!capture.current) aiOnce();
    if (capture.current) {
      const wav = capture.current.stop();
      capture.current = null;
      setListening(false);
      setReading(true);
      setNote(null);
      try {
        const said = await transcribeBlob(wav);
        if (said) { setNote(null); send(said); }
        else setNote(t("ask.voiceEmpty"));
      } catch (e) {
        setNote(t("common.voice.failed", { error: e instanceof Error ? e.message : String(e) }));
      }
      setReading(false);
      return;
    }
    if (!voiceSupported()) {
      setNote(t("common.voice.unsupported"));
      return;
    }
    try {
      capture.current = await startCapture();
      setListening(true);
      setNote(null);
    } catch {
      setNote(t("common.voice.refused"));
    }
  };

  /* Cancel on the Listening card: the recording is dropped, nothing is sent. */
  const cancelMic = () => {
    capture.current?.cancel();
    capture.current = null;
    setListening(false);
    setNote(null);
  };

  /* The quick questions: Arya's own (askChips) until the person edits
   * them; then theirs, kept as they arranged them. */
  const chips = layouts.ask?.chips ?? askChips(home);
  const ideas = [...askChips(home), t("ask.ideas.useSoon"), t("ask.ideas.dinners"), t("ask.ideas.cheapest")].filter((q, k, a) => !chips.includes(q) && a.indexOf(q) === k);
  const saveChips = (next: string[] | null, msg?: string) => {
    const prev = layouts.ask?.chips ?? null;
    saveLayout("ask", { chips: next }).catch(e => toast(e instanceof Error ? e.message : String(e)));
    if (msg) toast(msg, { action: t("common.undo"), onAction: () => { saveLayout("ask", { chips: prev }).catch(() => {}); } });
  };
  function addQ(ev: FormEvent) {
    ev.preventDefault();
    const q = newQ.trim().slice(0, 120);
    if (!q || chips.includes(q)) return;
    saveChips([...chips, q], t("edit.added", { name: q }));
    setNewQ("");
  }

  // Help's "Still stuck?" and its ask box open Ask with the question
  // already sent. Once per arrival (nav.key changes on every show()).
  const asked = useRef(-1);
  useEffect(() => {
    const q = nav.params.ask;
    if (typeof q !== "string" || !q.trim() || asked.current === nav.key) return;
    asked.current = nav.key;
    void send(q);
  }, [nav.key]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {log.length === 0
        ? <EditTitle id="ask-editbtn" title={t("common.askArya")} editTitle={t("ask.editTitle")} editing={editing} onToggle={() => setEditing(e => !e)} />
        : <div className="titlerow"><h1 className="largetitle">{t("common.askArya")}</h1>
            {/* Back to the starter questions and Edit (retest 2026-10-31 #9). */}
            <button type="button" id="ask-new" className="linkbtn titleedit" onClick={() => { lines.length = 0; history.length = 0; epoch++; setBusy(false); setLog([]); }}>{t("ask.newChat")}</button></div>}
      {editing && log.length === 0 ? (
        <>
          <EditList id="ask-edit" on={chips} off={ideas} name={q => q} sub={() => ""} desc={() => ""}
            hint={t("ask.editHint")} moreTitle={t("ask.ideasTitle")}
            onChange={saveChips} onReset={() => saveChips(null)} />
          <form id="ask-addq" className="addq" onSubmit={addQ}>
            <input type="text" id="ask-newq" value={newQ} maxLength={120} placeholder={t("ask.addQuestion")} aria-label={t("ask.addQuestion")}
              onChange={e => setNewQ(e.target.value)} />
            <button type="submit" className="btn primary" disabled={!newQ.trim()}>{t("common.add")}</button>
          </form>
        </>
      ) : <>
      <div id="chat-log" ref={logEl}>
        {log.length === 0 ? (
          <div id="chat-empty">
            <p className="muted">{t("ask.askAboutYourListYour")}</p>
            {chips.map(q => <button key={q} className="chip" type="button" data-ask={q} onClick={() => send(q)}>{q}</button>)}
            <button id="ask-map-store" className="chip" type="button" onClick={() => nav.show("mapper")}>{t("quest.mapMyStore")}</button>
          </div>
        ) : log.map((l, i) => l.kind === "offer" ? (
          <div key={i} className="bubble arya offer" id="lang-offer">
            <div className="group"><div className="row">
              <span className="name">{t("ask.replyInFromNowOn", { text: l.text })}</span>
              <span className="sub">{t("ask.youCanChangeThisAny")}</span>
              <div className="offer-btns">
                <button className="btn secondary" type="button" id="lang-offer-no" onClick={offerNo}>{t("ask.noThanks")}</button>
                <button className="btn primary" type="button" id="lang-offer-yes" onClick={() => offerYes(l.code!)}>{t("ask.yes", { text: l.text })}</button>
              </div>
            </div></div>
          </div>
        ) : l.kind === "map" ? (
          <div key={i} className="bubble arya">
            <p>{l.text}</p>
            <button className="btn primary" type="button" data-map-open onClick={() => nav.show("mapper")}>{t("quest.mapMyStore")}</button>
          </div>
        ) : l.kind === "err" && l.offer ? (
          <div key={i} className="group ok-capcard" role="alert" data-own-key-card>
            <b>{l.text}</b>
            <span className="sub">{t(l.offer === "own-key-fix" ? "ownKey.capFixBody" : "ownKey.capBody")}</span>
            <button className="btn primary wide" type="button" data-own-key-go onClick={requestOwnKey}>{t(l.offer === "own-key-fix" ? "ownKey.capFixButton" : "ownKey.capButton")}</button>
          </div>
        ) : l.kind === "err" ? (
          <div key={i} className="bubble arya" role="alert">
            <p>{l.text}</p>
            <button className="chip" type="button" data-ask-retry onClick={() => retry(l.code!)}>{t("ask.tryAgain")}</button>
          </div>
        ) : l.kind === "photo" ? (
          <div key={i} className="bubble me photo"><img src={l.url} alt={t("ask.yourPhoto")} onLoad={toEnd} /></div>
        ) : l.kind === "choose" ? (
          <div key={i} className="bubble arya choose" id="photo-choose">
            <p><b>{t("ask.gotPhoto")}</b> {t("ask.whatToDo")}</p>
            {(["list", "receipt", "fridge", "date"] as const).map(k => (
              <button key={k} type="button" className="pick" data-photo-do={k} onClick={() => run(l, k)}>
                <b>{t("ask.opt." + k)}</b><span className="muted">{t("ask.opt." + k + "Sub")}</span>
              </button>
            ))}
            <button type="button" className="pick" data-photo-do="ask" onClick={() => askAbout(l)}>
              <b>{t("ask.opt.ask")}</b><span className="muted">{t("ask.opt.askSub")}</span>
            </button>
            <p className="muted small">{t("ask.chooserNote")}</p>
            <button type="button" className="linkbtn tall" data-photo-never onClick={() => { drop(l); setLog(lines.slice()); }}>{t("ask.neverMind")}</button>
          </div>
        ) : l.kind === "thinking" ? (
          <div key={i} className="bubble arya thinking" role="status" aria-label={l.text}>
            <span className="dots" aria-hidden="true"><i /><i /><i /></span>
          </div>
        ) : l.kind === "working" ? (
          <div key={i} className="bubble arya" role="status">
            <p>{l.text}</p>
            <p className="muted small">{t("ask.workingNote")}</p>
            <button type="button" className="linkbtn tall" data-photo-cancel onClick={() => cancelWork(l)}>{t("common.cancel")}</button>
          </div>
        ) : l.chips || l.sub ? (
          <div key={i} className="bubble arya">
            <p>{l.text}</p>
            {l.sub ? <p className="muted small">{l.sub}</p> : null}
            {(l.chips || []).map(c => <button key={c.label} type="button" className="chip tall" data-photo-chip onClick={c.run}>{c.label}</button>)}
          </div>
        ) : <div key={i} className={"bubble " + l.kind}>{l.text}</div>)}
      </div>
      <form id="chat-form" onSubmit={(ev: FormEvent) => { ev.preventDefault(); if (!busy) send(text); }}>
        {(listening || reading) && <ListeningCard id="ask-listen" capture={capture.current} reading={reading} onStop={mic} onCancel={cancelMic} />}
        {pending ? (
          <div className="spchip" id="ask-photo-strip">
            <img src={pending.url} alt="" />
            <span className="grow"><b>{t("ask.photoWord")}</b> <span className="muted">· {t("ask.notSaved")}</span></span>
            <button type="button" className="linkbtn tall" data-photo-remove onClick={() => setPending(null)}>{t("ask.removePhoto")}</button>
          </div>
        ) : null}
        <input type="text" id="chat-input" ref={input} placeholder={pending ? t("ask.askAboutPhoto") : t("common.askArya")} autoComplete="off" aria-label={t("ask.message")}
          value={text} onChange={e => setText(e.target.value)} />
        <button type="submit" className="btn primary" id="chat-send" disabled={busy || (!text.trim() && !pending)}>{t("common.send")}</button>
        <div className="caprow">
          {/* While listening, the card holds the one Stop and send (owner, 2026-11-01). */}
          {!listening && !reading && <button id="btn-mic" type="button" className="chip" aria-label={t("ask.speakYourMessage")} onClick={mic}><IconMic />{t("ask.talk")}</button>}
          <label className="chip" htmlFor="ask-photo" {...pickerProps("ask-photo")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6H8l1.3-2h5.4L16 6h1.5A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-8z" /><circle cx="12" cy="12.5" r="3.2" /></svg>
            {t("ask.photoWord")}
          </label>
          <input type="file" id="ask-photo" ref={picker} accept="image/*" hidden onChange={onPhoto} />
        </div>
        <p className="muted small" id="ask-ai-note" style={{ textAlign: "center", margin: "8px 4px 0" }}>{t("ai.askLine")}</p>
      </form>
      <p id="voice-note" className="muted" hidden={note === null}>{note}</p>
      </>}
    </>
  );
}
