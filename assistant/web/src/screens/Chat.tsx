import { useEffect, useRef, useState, type FormEvent } from "react";
import { clearOnSignOut, useSession } from "../app/session";
import { get, post } from "../lib/api";
import { startCapture, transcribeBlob, voiceSupported, type Capture } from "../lib/recorder";
import { useToast } from "../ui/Toast";
import { useNav } from "../app/nav";
import { IconMic, IconSpeaker } from "../ui/icons";
import { languageToast, offerFor, offerRefused, refuseOffer, voiceLang } from "../lib/language";
import "../ui/language.css";
import { t, useTranslation } from "../i18n";

/* Port of "Ask Arya + voice" (pwa/app.js, pwa/index.html #view-chat).
 * The log and the history outlive the screen, as the old DOM did.
 * An "offer" line is the one-time "Reply in <language> from now on?"
 * card (assistant/docs/MULTILINGUAL-ASK.md): on Auto, after a reply to
 * a non-English message; at most once per session, never after No. */
type Line = { kind: "me" | "arya" | "sys" | "actionchip" | "offer" | "map"; text: string; code?: string };
type Msg = { role: "user" | "assistant"; content: string };
const lines: Line[] = [];
const history: Msg[] = [];
let offered = false;
/* Bumps on sign out: the log and history are this account's only, and
 * a reply still in flight from before must not land in the next one. */
let epoch = 0;
clearOnSignOut(() => {
  lines.length = 0; history.length = 0; epoch++; offered = false;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
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

const readSpeak = () => { try { return localStorage.getItem("arya-speak") === "1"; } catch { return false; } };

export function Chat() {
  const { t } = useTranslation();
  const { language, languages, setLanguage } = useSession();
  const { toast } = useToast();
  const nav = useNav();
  const [log, setLog] = useState<Line[]>(() => lines.slice());
  const [text, setText] = useState("");
  const [speakOn, setSpeakOn] = useState(readSpeak);
  const [listening, setListening] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [home, setHome] = useState<ChipHome>(null);
  useEffect(() => { let live = true; get<ChipHome>("/api/home").then(h => live && setHome(h), () => {}); return () => { live = false; }; }, []);
  const capture = useRef<Capture | null>(null);
  const speakRef = useRef(speakOn);
  const input = useRef<HTMLInputElement>(null);
  const logEl = useRef<HTMLDivElement>(null);
  speakRef.current = speakOn;

  useEffect(() => {
    (logEl.current?.lastElementChild as HTMLElement | null | undefined)?.scrollIntoView?.({ block: "end" });
  }, [log]);

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

  const toggleSpeak = () => {
    const next = !speakOn;
    setSpeakOn(next);
    try { localStorage.setItem("arya-speak", next ? "1" : "0"); } catch { /* ignore */ }
    if (!next && "speechSynthesis" in window) speechSynthesis.cancel();
  };
  const speak = (t: string) => {
    if (!speakRef.current || !("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(t);
    u.lang = voiceLang(language, t);
    speechSynthesis.speak(u);
  };

  const send = async (raw: string) => {
    const q = raw.trim();
    if (!q) { toast(t("ask.typeFirst")); input.current?.focus(); return; }
    setText("");
    if (wantsMapStore(q)) {
      add({ kind: "me", text: q }, { kind: "map", text: t("ask.mapStoreReply") });
      return;
    }
    history.push({ role: "user", content: q });
    add({ kind: "me", text: q });
    const mine = epoch;
    try {
      const res = await post<{ reply: string; applied?: string[]; skipped?: string[] }>("/api/chat", { messages: history });
      if (mine !== epoch) return;
      history.push({ role: "assistant", content: res.reply });
      const offer = !offered && !offerRefused() ? offerFor(language, q, languages) : null;
      if (offer) offered = true;
      add({ kind: "arya", text: res.reply },
        ...(res.applied || []).map(a => ({ kind: "actionchip" as const, text: "✓ " + a })),
        ...(res.skipped || []).map(a => ({ kind: "sys" as const, text: a })),
        ...(offer ? [{ kind: "offer" as const, text: offer.name, code: offer.code }] : []));
      speak(res.reply);
    } catch (e) {
      if (mine !== epoch) return;
      add({ kind: "arya", text: t("ask.couldNotAnswer", { error: e instanceof Error ? e.message : String(e) }) });
    }
  };

  const mic = async () => {
    if (capture.current) {
      const wav = capture.current.stop();
      capture.current = null;
      setListening(false);
      setNote(t("common.voice.transcribing"));
      try {
        const said = await transcribeBlob(wav);
        if (said) { setNote(null); send(said); }
        else setNote(t("ask.voiceEmpty"));
      } catch (e) {
        setNote(t("common.voice.failed", { error: e instanceof Error ? e.message : String(e) }));
      }
      return;
    }
    if (!voiceSupported()) {
      setNote(t("common.voice.unsupported"));
      return;
    }
    try {
      capture.current = await startCapture();
      setListening(true);
      setNote(t("ask.listening"));
    } catch {
      setNote(t("common.voice.refused"));
    }
  };

  return (
    <>
      <h2 className="largetitle">{t("common.askArya")}</h2>
      <div id="chat-log" ref={logEl}>
        {log.length === 0 ? (
          <div id="chat-empty">
            <p className="muted">{t("ask.askAboutYourListYour")}</p>
            {askChips(home).map(q => <button key={q} className="chip" type="button" data-ask={q} onClick={() => send(q)}>{q}</button>)}
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
        ) : <div key={i} className={"bubble " + l.kind}>{l.text}</div>)}
      </div>
      <form id="chat-form" onSubmit={(ev: FormEvent) => { ev.preventDefault(); send(text); }}>
        <button id="btn-mic" type="button" className={"iconbtn" + (listening ? " listening" : "")} aria-label={t("ask.speakYourMessage")} onClick={mic}><IconMic /></button>
        <input type="text" id="chat-input" ref={input} placeholder={t("common.askArya")} autoComplete="off" aria-label={t("ask.message")}
          value={text} onChange={e => setText(e.target.value)} />
        <button id="btn-speak" type="button" className={"iconbtn" + (speakOn ? " on" : "")} aria-label={t("ask.toggleSpokenReplies")}
          aria-pressed={speakOn} onClick={toggleSpeak}><IconSpeaker /></button>
        <button type="submit" className="btn primary" id="chat-send">{t("common.send")}</button>
      </form>
      <p id="voice-note" className="muted" hidden={note === null}>{note}</p>
    </>
  );
}
