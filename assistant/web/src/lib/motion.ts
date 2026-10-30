/* One answer to "should this move?": the Display switch (html.nomotion)
 * or the system's Reduce Motion. The CSS side lives in styles.css
 * (.nomotion and the prefers-reduced-motion blocks); code that animates
 * in JS (confetti, scroll, timers, the game) asks here so the switch
 * reaches it too. */
export function motionOff(): boolean {
  try {
    if (document.documentElement.classList.contains("nomotion")) return true;
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  } catch { return false; }
}
