import { useEffect, useState } from "react";
import { useNav } from "../app/nav";
import { useSession } from "../app/session";
import { get, post } from "../lib/api";
import { Chip, Empty, Row } from "../ui/kit";
import { useTranslation } from "../i18n";
import { openEndOfDemo } from "../ui/EndOfDemo";

/* Port of Feature request / Contact us (pwa/index.html #view-feedback,
 * app.js "Feature request / Contact us"). One note, a kind; the
 * username rides the session. A demo visitor's Send opens the Finish
 * demo sheet, the demo's one feedback door; the owner also sees what came in. */
type Kind = "idea" | "bug" | "question";
type Note = { text: string; kind: string; user: string; at: number; contact?: string };

export function Feedback() {
  const { t } = useTranslation();
  const nav = useNav();
  const { demo } = useSession();
  const [kind, setKind] = useState<Kind>("idea");
  const [text, setText] = useState("");
  const [status, setStatus] = useState(demo ? t("feedback.signInToSend") : "");
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<Note[] | null>(null);

  const loadInbox = () => {
    get<{ notes: Note[] }>("/api/feedback").then(d => setNotes(d.notes), () => setNotes(null));
  };
  useEffect(() => {
    setStatus(demo ? t("feedback.signInToSend") : "");
    loadInbox();
  }, [nav.key, demo]);

  const send = async () => {
    setBusy(true);
    try {
      await post("/api/feedback", { kind, text });
      setText("");
      setStatus(t("feedback.sent"));
      loadInbox();
    } catch (e) { setStatus(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  return (
    <>
      <p><a href="#" id="fb-back" onClick={e => { e.preventDefault(); nav.back("profile"); }}><span aria-hidden="true">‹ </span>{t("common.back")}</a></p>
      <h1 className="largetitle" style={{ fontSize: 28 }}>{t("feedback.featureRequestContactUs")}</h1>
      <div className="group pad">
        <p className="muted nomargin">{t("feedback.weReadEveryNoteIt")}</p>
        {/* The demo's one feedback door is the Finish demo sheet, which asks
          * for an email so the owner can reply (retest 2026-10-31 #14). */}
        {demo ? <p><button id="fb-send" className="btn primary wide" type="button" onClick={openEndOfDemo} style={{ marginTop: 10 }}>{t("feedback.sendFromFinish")}</button></p> : <>
        <div className="row" id="fb-kinds" style={{ marginTop: 10, gap: 8 }}>
          {(["idea", "bug", "question"] as Kind[]).map(k => (
            <Chip key={k} data-kind={k} pressed={kind === k} onClick={() => setKind(k)}>{k[0].toUpperCase() + k.slice(1)}</Chip>
          ))}
        </div>
        <label className="field" htmlFor="fb-text" style={{ marginTop: 10 }}>{t("feedback.yourNote")}</label>
        <textarea id="fb-text" rows={5} maxLength={1000} placeholder={t("feedback.whatWouldMakeAryaBetter")}
          value={text} onChange={e => setText(e.target.value)} />
        <p className="muted nomargin" id="fb-count">{text.length} / 1000</p>
        <p><button id="fb-send" className="btn primary wide" type="button" disabled={busy} onClick={send}>{t("common.send")}</button></p>
        </>}
        <p className="muted nomargin" id="fb-status">{status}</p>
      </div>
      <div id="fb-owner" hidden={notes === null}>
        {notes && (
          <>
            <h3 className="sect">{t("feedback.received")}</h3>
            <div className="group">
              {notes.length
                ? notes.map((n, i) => (
                  <Row key={i} name={n.text} sub={`${n.kind} · ${n.user}${n.contact ? " · " + n.contact : ""} · ${new Date(n.at * 1000).toLocaleDateString()}`} />
                ))
                : <Empty>{t("feedback.nothingYet")}</Empty>}
            </div>
          </>
        )}
      </div>
    </>
  );
}
