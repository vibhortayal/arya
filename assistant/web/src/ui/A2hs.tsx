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
export const isAndroid = () => /android/i.test(navigator.userAgent);

/* Something to offer (the install prompt, or iPhone steps), and the go action. */
export function useA2hs(demo: boolean) {
  const { prompt: deferred, take } = useInstallPrompt();
  const [steps, setSteps] = useState(false);
  // Android without the browser's prompt (another browser, or Chrome
  // before it offers) gets the steps too (owner, 2026-11-01).
  const available = !installed() && !demo && (!!deferred || isIOS() || isAndroid());
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

/* The steps, one copy for the landing, Today and Settings. An iPhone /
 * Android switch starts on this phone's kind (owner, 2026-11-01). */
export function A2hsSteps({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [os, setOs] = useState<"ios" | "android">(() => (isAndroid() ? "android" : "ios"));
  return (
    <Sheet open={open} onClose={onClose} id="a2hs-sheet" title={t("a2hs.getTheAryaApp")}>
      <p className="muted a2hs-intro">{t("a2hs.intro")}</p>
      <div className="a2hs-seg" role="group" aria-label={t("a2hs.whichPhone")}>
        {(["ios", "android"] as const).map(o => (
          <button key={o} type="button" data-os={o} aria-pressed={os === o} className={os === o ? "on" : undefined}
            onClick={() => setOs(o)}>{t(o === "ios" ? "a2hs.iphone" : "a2hs.android")}</button>
        ))}
      </div>
      {os === "android" ? (
        <ol className="steps" id="a2hs-android">
          <li><span><Trans i18nKey="a2hs.android1" components={{ b: <b /> }} /></span></li>
          <li><span><Trans i18nKey="a2hs.android2" components={{ b: <b /> }} /></span></li>
          <li><span><Trans i18nKey="a2hs.android3" components={{ b: <b /> }} /></span></li>
        </ol>
      ) : <>
      <ol className="steps" id="a2hs-ios">
        <li><span><Trans i18nKey="a2hs.step1" components={{ b: <b /> }} /></span></li>
        <li><span><Trans i18nKey="a2hs.step2" components={{ b: <b /> }} /></span></li>
        <li><span><Trans i18nKey="a2hs.step3" components={{ b: <b />, tog: <i className="tog" aria-hidden="true" /> }} /><span className="keepon">{t("a2hs.ifItIsOffArya")}</span></span></li>
        <li><span><Trans i18nKey="a2hs.step4" components={{ b: <b /> }} /></span></li>
      </ol>
      <p className="muted small a2hs-tip">{t("a2hs.findShare")}</p>
      </>}
      {inAppBrowser() && (
        <p className="muted small a2hs-tip">{t("a2hs.otherApp")} <CopyLink id="a2hs-copy" /></p>
      )}
      {os === "ios" && <p className="muted small a2hs-tip">{t("a2hs.tip")}</p>}
    </Sheet>
  );
}

/* Landing (owner, 2026-11-01): in place of "apps coming soon", a card
 * on any phone where Arya is not installed yet. Install runs the
 * browser's prompt where there is one; otherwise Show me how. */
export function A2hsLandCard() {
  const { t } = useTranslation();
  const a = useA2hs(false);
  if (!a.available || !(isIOS() || isAndroid())) return <A2hsSteps open={a.steps} onClose={a.closeSteps} />;
  return (
    <>
      <div className="a2land" id="land-a2hs">
        <img src="/icons/apple-touch-180.png" width="48" height="48" alt="" />
        <div className="grow"><b>{t("a2hs.addAryaToYourHome")}</b><span className="sub">{t("a2hs.landSub")}</span></div>
        <button className="btn primary" type="button" id="land-a2hs-go" onClick={a.go}>{a.deferred ? t("a2hs.install") : t("a2hs.showMeHow")}</button>
      </div>
      <A2hsSteps open={a.steps} onClose={a.closeSteps} />
    </>
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
