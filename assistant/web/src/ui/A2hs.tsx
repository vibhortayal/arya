import { useState } from "react";
import { useInstallPrompt } from "../app/a2hs";
import { asset } from "../lib/format";
import { Sheet } from "./Sheet";

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
  return (
    <Sheet open={open} onClose={onClose} id="a2hs-sheet" title="Add Arya to your Home Screen">
      <ol className="steps">
        <li><span>Tap <b>Share</b> at the bottom of Safari.</span></li>
        <li><span>Scroll and tap <b>Add to Home Screen</b>.</span></li>
        <li><span>Leave <b>Open as Web App</b> <i className="tog" aria-hidden="true"></i> switched <b>on</b>.<span className="keepon">If it is off, Arya opens as a plain Safari tab with the address bar, and reminders cannot work.</span></span></li>
        <li><span>Tap <b>Add</b>, then open Arya from your Home Screen.</span></li>
      </ol>
    </Sheet>
  );
}

/* Today: one dismissible card once there is a list and it is the
 * second visit or later; a dismiss holds for 30 days. */
export function A2hsCard({ hasList, demo }: { hasList: boolean; demo: boolean }) {
  const a = useA2hs(demo);
  const [, bump] = useState(0);
  const dismissed = !!st.dismissed && Date.now() - st.dismissed < DISMISS_DAYS * 864e5;
  const show = a.available && !dismissed && st.visits >= 2 && hasList;
  return (
    <>
      {show && (
        <div className="group a2hs">
          <img className="rowface" src={asset("assets/characters/basket.webp")} alt="" />
          <div className="grow"><b>Add Arya to your Home Screen</b><span className="sub">Full screen, with reminders.</span></div>
          <button className="chip" type="button" data-a2hs-go onClick={a.go}>{a.deferred ? "Install" : "Show how"}</button>
          <button className="a2hs-x" type="button" data-a2hs-x aria-label="Dismiss"
            onClick={() => { st.dismissed = Date.now(); save(); bump(n => n + 1); }}>&times;</button>
        </div>
      )}
      <A2hsSteps open={a.steps} onClose={a.closeSteps} />
    </>
  );
}

/* Profile: an always-there row while there is something to offer. */
export function A2hsRow({ demo }: { demo: boolean }) {
  const a = useA2hs(demo);
  return (
    <>
      <button className="navrow" id="btn-a2hs" type="button" hidden={!a.available} onClick={a.go}>
        <span className="grow">Add to Home Screen<span className="sub">Opens full screen and lets reminders work</span></span><span className="chev">›</span></button>
      <A2hsSteps open={a.steps} onClose={a.closeSteps} />
    </>
  );
}
