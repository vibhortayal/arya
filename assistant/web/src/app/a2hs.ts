import { useEffect, useState } from "react";

/* The browser's install prompt (pwa/a2hs.js). beforeinstallprompt
 * fires once, early, often before Profile is open: catch it at load
 * and keep it here so the Profile row can use it later. */
let deferred: any = null;
const subs = new Set<() => void>();
const notify = () => subs.forEach(f => f());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", ev => { ev.preventDefault(); deferred = ev; notify(); });
  window.addEventListener("appinstalled", () => { deferred = null; notify(); });
}

/* The saved prompt, or null; take() hands it out once. */
export function useInstallPrompt(): { prompt: any; take: () => any } {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump(n => n + 1);
    subs.add(f);
    return () => { subs.delete(f); };
  }, []);
  return { prompt: deferred, take: () => { const ev = deferred; deferred = null; notify(); return ev; } };
}

/* Browsers inside other apps (Instagram, Facebook, Mail links and so on)
 * cannot add to the Home Screen. User-agent clues are a guess, so the
 * sheet only hints; it never blocks. */
export const inAppBrowser = () =>
  /FBAN|FBAV|FB_IAB|Instagram|Snapchat|TikTok|musical_ly|Twitter|LinkedInApp|MicroMessenger|; wv\)/i.test(navigator.userAgent);
