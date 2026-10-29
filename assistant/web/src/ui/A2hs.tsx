import { useState } from "react";
import { useInstallPrompt } from "../app/a2hs";
import { asset } from "../lib/format";
import { Sheet } from "./Sheet";
import { useTranslation } from "../i18n";

/* Add to Home Screen (pwa/a2hs.js): one copy for Today's card and
 * Profile's row. Android and desktop Chrome: the button runs the
 * browser's own install prompt. iPhone: Safari cannot be triggered, so
 * it opens four steps, including leaving "Open as Web App" on. Nothing
 * shows once Arya runs from the Home Screen, or in the demo. */

const KEY = "arya.a2hs";
const DISMISS_DAYS = 30;
/* Visits count once per page load, as the old script did. */
const st = { visits: 0, dismissed: 0 };
try { Object.assign(st, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch { /* private window */ }
st.visits += 1;
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* ignore */ } };
save();

const installed = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/* Something to offer (the install prompt, or iPhone steps), and the go action. */
function useA2hs(demo: boolean) {
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

function A2hsSteps({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Sheet open={open} onClose={onClose} id="a2hs-sheet" title={t("a2hs.addAryaToYourHome")}>
      <ol className="steps">
        <li><span>{t("a2hs.tap")}{" "}<b>{t("common.share")}</b>{" "}{t("a2hs.atTheBottomOfSafari")}</span></li>
        <li><span>{t("a2hs.scrollAndTap")}{" "}<b>{t("a2hs.addToHomeScreen")}</b>.</span></li>
        <li><span>{t("a2hs.leave")}{" "}<b>{t("a2hs.openAsWebApp")}</b> <i className="tog" aria-hidden="true"></i>{" "}{t("a2hs.switched")}{" "}<b>{t("a2hs.on")}</b>.<span className="keepon">{t("a2hs.ifItIsOffArya")}</span></span></li>
        <li><span>{t("a2hs.tap")}{" "}<b>{t("common.add")}</b>{t("a2hs.thenOpenAryaFromYour")}</span></li>
      </ol>
    </Sheet>
  );
}

/* Today: one dismissible card once there is a list and it is the
 * second visit or later; a dismiss holds for 30 days. */
export function A2hsCard({ hasList, demo }: { hasList: boolean; demo: boolean }) {
  const { t } = useTranslation();
  const a = useA2hs(demo);
  const [, bump] = useState(0);
  const dismissed = !!st.dismissed && Date.now() - st.dismissed < DISMISS_DAYS * 864e5;
  const show = a.available && !dismissed && st.visits >= 2 && hasList;
  return (
    <>
      {show && (
        <div className="group a2hs">
          <img className="rowface" src={asset("assets/characters/basket.webp")} alt="" />
          <div className="grow"><b>{t("a2hs.addAryaToYourHome")}</b><span className="sub">{t("a2hs.fullScreenWithReminders")}</span></div>
          <button className="chip" type="button" data-a2hs-go onClick={a.go}>{a.deferred ? "Install" : "Show how"}</button>
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
