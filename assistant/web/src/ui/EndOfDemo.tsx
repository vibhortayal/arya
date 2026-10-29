import { useState, useSyncExternalStore } from "react";
import { post } from "../lib/api";
import { asset } from "../lib/format";
import { Sheet } from "./Sheet";
import { useTranslation } from "../i18n";
import "./enddemo.css";

/* End of the demo (owner-approved wireframe 2026-10-29): a thank-you,
 * "open to a few people for now", one feedback box with the visitor's
 * email (the way into the beta), the owner's LinkedIn and GitHub, and a
 * small "peek inside the code" line. Sends to POST /api/demo/feedback.
 * Opened from the demo bar's "Finish demo" link, and by the demo tour's
 * last step through openEndOfDemo(). */
const LINKEDIN = "https://www.linkedin.com/in/vibhortayal";
const GITHUB = "https://github.com/vibhortayal";
const REPO = "https://github.com/vibhortayal/arya";

let isOpen = false;
const subs = new Set<() => void>();
const set = (v: boolean) => { isOpen = v; subs.forEach(f => f()); };
export const openEndOfDemo = () => set(true);

export function EndOfDemo() {
  const { t } = useTranslation();
  const open = useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f); }; }, () => isOpen);
  const [text, setText] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");   // honeypot: a person never fills it
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");
  const close = () => set(false);

  const send = async () => {
    setBusy(true); setErr("");
    try {
      await post("/api/demo/feedback", { text, email, website });
      setSent(true);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  return (
    <Sheet open={open} onClose={close} id="end-demo" className="fr-welcome end-demo" labelledBy="end-demo-title">
      <span className="sheetgrip" />
      <div className="ed-head">
        <img className="fr-face" src={asset("assets/characters/basket.webp")} alt="" />
        <div>
          <p className="fr-k">{t("endDemo.kicker")}</p>
          <h3 id="end-demo-title">{t("endDemo.title")}</h3>
        </div>
      </div>
      {sent ? (
        <div className="fr-card ed-thanks" id="ed-thanks">
          <h3 className="fr-h">{t("endDemo.thanksTitle")}</h3>
          <p className="fr-s">{t("endDemo.thanksLine")}</p>
        </div>
      ) : (
        <>
          <p className="ed-line">{t("endDemo.line1")} <b>{t("endDemo.openToFew")}</b> {t("endDemo.line2")}</p>
          <label className="field" htmlFor="ed-text">{t("endDemo.feedback")}
            <textarea id="ed-text" rows={3} maxLength={1000} placeholder={t("endDemo.feedbackHint")}
              value={text} onChange={e => setText(e.target.value)} data-first />
          </label>
          <label className="field" htmlFor="ed-email">{t("endDemo.email")} <span className="muted">{t("endDemo.emailWhy")}</span>
            <input id="ed-email" type="text" inputMode="email" autoCapitalize="off" autoComplete="email" placeholder="you@example.com" maxLength={200}
              value={email} onChange={e => setEmail(e.target.value)} />
          </label>
          <input className="ed-hp" type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true"
            value={website} onChange={e => setWebsite(e.target.value)} />
          <p className="muted ed-fine">{t("endDemo.fine")}</p>
          <button className="btn primary wide fr-go" id="ed-send" type="button" disabled={busy || !text.trim() || !email.trim()} onClick={send}>
            {t("endDemo.send")}
          </button>
          {err && <p className="ed-err" id="ed-err" role="alert">{err}</p>}
        </>
      )}
      <p className="fr-k ed-direct">{t("endDemo.direct")}</p>
      <div className="group ed-links">
        <a className="navrow" href={LINKEDIN} target="_blank" rel="noopener noreferrer"><span className="grow">LinkedIn<span className="sub">linkedin.com/in/vibhortayal</span></span><span className="chev">›</span></a>
        <a className="navrow" href={GITHUB} target="_blank" rel="noopener noreferrer"><span className="grow">GitHub<span className="sub">github.com/vibhortayal</span></span><span className="chev">›</span></a>
      </div>
      <p className="muted ed-code">
        <a href={REPO} target="_blank" rel="noopener noreferrer">{t("endDemo.peek")}</a> {t("endDemo.star")}
      </p>
      <button className="linkbtn fr-skip" id="ed-keep" type="button" onClick={close}>{t("endDemo.keep")}</button>
    </Sheet>
  );
}
