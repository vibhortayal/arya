import { useEffect, useRef } from "react";
import { CLIENT_ID, forgetKept, get } from "../lib/api";
import { useNav } from "./nav";
import { useSession } from "./session";
import { useToast } from "../ui/Toast";
import { t } from "../i18n";

/* An owner removed this person from their group: say so once (the
 * server keeps the note for a week; this phone remembers it was shown). */
const SEEN_KEY = "arya.removedSeen";
function tellRemoved(r: unknown, toast: (s: string) => void) {
  const x = r as { name?: string; at?: number } | undefined;
  if (!x || !x.at) return;
  try { if (localStorage.getItem(SEEN_KEY) === String(x.at)) return; localStorage.setItem(SEEN_KEY, String(x.at)); } catch { /* show it anyway */ }
  toast(t("groupJoin.removedFrom", { name: x.name || "" }));
}

/* Group live sync (group.js "live sync"): while the app is in front
 * and the account is in a group, one EventSource listens for "the
 * group changed" and the open screen reloads (a short pause gathers a
 * burst of saves into one reload). The tab's own changes come back
 * with its id and are skipped. A screen with a half-typed entry waits
 * until the field is left. The service worker never touches the
 * stream (sw.js). */
const RELOADS = new Set(["list", "home", "receipts", "profile"]);

export function useGroupLive(): void {
  const nav = useNav();
  const { demo } = useSession();
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const navRef = useRef(nav);
  navRef.current = nav;
  const es = useRef<EventSource | null>(null);
  const inGroup = useRef(false);
  const checkRef = useRef<null | (() => Promise<void>)>(null);

  useEffect(() => {
    if (demo || typeof EventSource === "undefined") return;
    let dead = false, pending: number | undefined, waitingForBlur = false;

    const reloadNow = () => {
      pending = undefined;
      const el = document.activeElement as HTMLElement | null;
      if (el && el.matches("input, textarea") && el.closest("#app-main")) {
        if (!waitingForBlur) {
          waitingForBlur = true;
          el.addEventListener("blur", () => { waitingForBlur = false; reloadNow(); }, { once: true });
        }
        return;
      }
      // Someone else changed the group: the 30 s keeps are out of date.
      forgetKept();
      const n = navRef.current;
      if (!RELOADS.has(n.view)) return;
      // A screen that can refresh in place takes the event (Today,
      // Lists); the rest are shown again. No blank flash (#3).
      const ev = new Event("arya-live", { cancelable: true });
      if (window.dispatchEvent(ev)) n.replace(n.view, n.params);
    };
    const disconnect = () => { es.current?.close(); es.current = null; };
    const connect = () => {
      if (es.current || document.hidden) return;
      const s = new EventSource("/api/group/live");
      s.addEventListener("change", ev => {
        let d: { client?: string } = {};
        try { d = JSON.parse((ev as MessageEvent).data); } catch { return; }
        if (d.client && d.client === CLIENT_ID) return;
        clearTimeout(pending);
        pending = window.setTimeout(reloadNow, 400);
      });
      s.addEventListener("left", () => { inGroup.current = false; disconnect(); forgetKept(); reloadNow(); void checkRef.current?.(); });
      // A 404 (no longer in a group) closes for good; a dropped
      // network reconnects on its own.
      s.onerror = () => { if (s.readyState === EventSource.CLOSED && es.current === s) disconnect(); };
      es.current = s;
    };
    const check = async () => {
      let g: { enabled?: boolean; group?: unknown; removed_from?: unknown } = {};
      try { g = await get("/api/group"); } catch { return; }
      if (dead) return;
      inGroup.current = !!(g.enabled && g.group);
      if (!g.group) tellRemoved(g.removed_from, toastRef.current);
      if (inGroup.current) connect(); else disconnect();
    };
    const onVisible = () => {
      if (document.hidden) { disconnect(); return; }
      if (!inGroup.current) return;
      connect();
      reloadNow();  // catch up on what changed in the background
    };
    (checkRef.current = check)();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      dead = true;
      clearTimeout(pending);
      document.removeEventListener("visibilitychange", onVisible);
      disconnect();
      checkRef.current = null;
    };
  }, [demo]);

  // Creating, joining or leaving a group all end on Settings: look again there.
  useEffect(() => {
    if (nav.view === "profile" && !es.current) checkRef.current?.();
  }, [nav.view]);
}
