import { useState } from "react";
import { inAppBrowser, useInstallPrompt } from "../app/a2hs";
import { asset } from "../lib/format";
import { Sheet } from "./Sheet";
import { Trans, useTranslation } from "../i18n";

/* Add to Home Screen (pwa/a2hs.js): one copy for Today's card and
 * Profile's row. Android and desktop Chrome: the button runs the
 * browser's own install prompt. iPhone: the browser cannot be triggered,
 * so it opens four steps worded for any browser (owner, 2026-10-30: no
 * browser names, menus change), including leaving "Open as Web App" on. Nothing
 * shows once Arya runs from the Home Screen, or in the demo. The
 * landing's "Get the app" pill (screens/Login.tsx) uses the same
 * useA2hs and A2hsSteps. */

const KEY = "arya.a2hs";
const DISMISS_DAYS = 30;
const st = { dismissed: 0 };
try { Object.assign(st, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch { /* private window */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* ignore */ } };

export const installed = () => (typeof matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches) || (navigator as any).standalone === true;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/* Something to offer (the install prompt, or iPhone steps), and the go action. */
export function useA2hs(demo: boolean) {
  const { prompt: deferred, take } = useInstallPrompt();
  const [steps, setSteps] = useState(false);
  const available = !installed() && !demo && (!!deferred || isIOS());
  const go = async () => {
    if (deferred) {
      const ev = take();
      try { await ev.prompt(); await ev.userChoice; } catch { /* closed */ }
      return;
    }
    setSteps(true);
  };
  return { deferred, available, go, steps, closeSteps: () => setSteps(false) };
}

/* "Copy link" text button; the label says what happened. */
export function CopyLink({ id }: { id: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<"" | "ok" | "fail">("");
  const copy = async () => {
    try { await navigator.clipboard.writeText(location.origin + location.pathname); setState("ok"); }
    catch { setState("fail"); }
  };
  return <button className="linkbtn" type="button" id={id} onClick={copy}>{t(state === "ok" ? "a2hs.linkCopied" : state === "fail" ? "a2hs.copyFailed" : "a2hs.copyLink")}</button>;
}

/* The iPhone steps, one copy for the landing, Today and Settings. */
export function A2hsSteps({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Sheet open={open} onClose={onClose} id="a2hs-sheet" title={t("a2hs.getTheAryaApp")}>
      <p className="muted a2hs-intro">{t("a2hs.intro")}</p>
      <ol className="steps">
        <li><span><Trans i18nKey="a2hs.step1" components={{ b: <b /> }} /></span></li>
        <li><span><Trans i18nKey="a2hs.step2" components={{ b: <b /> }} /></span></li>
        <li><span><Trans i18nKey="a2hs.step3" components={{ b: <b />, tog: <i className="tog" aria-hidden="true" /> }} /><span className="keepon">{t("a2hs.ifItIsOffArya")}</span></span></li>
        <li><span><Trans i18nKey="a2hs.step4" components={{ b: <b /> }} /></span></li>
      </ol>
      <p className="muted small a2hs-tip">{t("a2hs.findShare")}</p>
      {inAppBrowser() && (
        <p className="muted small a2hs-tip">{t("a2hs.otherApp")} <CopyLink id="a2hs-copy" /></p>
      )}
      <p className="muted small a2hs-tip">{t("a2hs.tip")}</p>
    </Sheet>
  );
}

/* Today: one dismissible card once there is a list (from the first
 * visit); a dismiss holds for 30 days. */
export function A2hsCard({ hasList, demo }: { hasList: boolean; demo: boolean }) {
  const { t } = useTranslation();
  const a = useA2hs(demo);
  const [, bump] = useState(0);
  const dismissed = !!st.dismissed && Date.now() - st.dismissed < DISMISS_DAYS * 864e5;
  const show = a.available && !dismissed && hasList;
  return (
    <>
      {show && (
        <div className="group a2hs">
          <img className="rowface" src={asset("assets/characters/basket.webp")} alt="" />
          <div className="grow"><b>{t("a2hs.addAryaToYourHome")}</b><span className="sub">{t("a2hs.fullScreenWithReminders")}</span></div>
          <button className="chip" type="button" data-a2hs-go onClick={a.go}>{a.deferred ? t("a2hs.install") : t("a2hs.showHow")}</button>
          <button className="a2hs-x" type="button" data-a2hs-x aria-label={t("common.dismiss")}
            onClick={() => { st.dismissed = Date.now(); save(); bump(n => n + 1); }}>&times;</button>
        </div>
      )}
      <A2hsSteps open={a.steps} onClose={a.closeSteps} />
    </>
  );
}

/* Profile: an always-there row while there is something to offer. */
export function A2hsRow({ demo }: { demo: boolean }) {
  const { t } = useTranslation();
  const a = useA2hs(demo);
  return (
    <>
      <button className="navrow" id="btn-a2hs" type="button" hidden={!a.available} onClick={a.go}>
        <span className="grow">{t("a2hs.addToHomeScreen")}<span className="sub">{t("a2hs.opensFullScreenAndLets")}</span></span><span className="chev">›</span></button>
      <A2hsSteps open={a.steps} onClose={a.closeSteps} />
    </>
  );
}
