import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ViewId, ViewParams } from "./views";

/* The plain-JS app's show(id): one view at a time, every view opens at
 * its top, and the item page goes back to the view that opened it.
 * A stack lets any screen go back to where it came from. */
type Entry = { view: ViewId; params: ViewParams; key: number };
type Nav = {
  view: ViewId;
  params: ViewParams;
  /* Bumps on every show(), so a screen can refetch when re-opened. */
  key: number;
  show: (view: ViewId, params?: ViewParams) => void;
  replace: (view: ViewId, params?: ViewParams) => void;
  /* Drop the whole stack: Back from `view` lands on `under`
   * (quest.js `Q.stack = ["view-community"]` once a hunt is made). */
  reset: (view: ViewId, params?: ViewParams, under?: ViewId) => void;
  back: (fallback?: ViewId) => void;
  /* A tab bar tap: the stack becomes [Today, tab], so Back goes up to
   * Today and then leaves, not through every tab visited (#35). */
  tab: (view: ViewId) => void;
  /* Full-screen modes (the hunt) hide the tab bar, avatar and demo bar. */
  chrome: boolean;
  setChrome: (on: boolean) => void;
  /* How many views are stacked: Back from 1 leaves the app. */
  depth: number;
};

const Ctx = createContext<Nav | null>(null);

/* The phone's Back (Android, the browser's back) used to leave the app:
 * nothing was ever put in the history (QA 2026-10-30). One guard entry
 * sits on top; Back first closes what is open (a sheet, a list's page:
 * useBackHandler, newest first), then goes back one view, and leaves
 * the app only from the first view. */
const backHandlers: (() => boolean)[] = [];

/* While `active`, Back calls fn first; fn returns true when it handled it. */
export function useBackHandler(fn: () => boolean, active = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return;
    const h = () => ref.current();
    backHandlers.push(h);
    return () => { const i = backHandlers.lastIndexOf(h); if (i >= 0) backHandlers.splice(i, 1); };
  }, [active]);
}

export function NavProvider({ initial = "home", children }: { initial?: ViewId; children: ReactNode }) {
  const seq = useRef(0);
  const [stack, setStack] = useState<Entry[]>([{ view: initial, params: {}, key: 0 }]);
  const [chrome, setChrome] = useState(true);
  const top = stack[stack.length - 1];

  // Re-showing the view on top replaces it (quest.js questShow pushes
  // only a new id; app.js never kept an item page as lastView), so one
  // Back always leaves the screen.
  const show = useCallback((view: ViewId, params: ViewParams = {}) => {
    setStack(s => [...(s[s.length - 1].view === view ? s.slice(0, -1) : s).slice(-20), { view, params, key: ++seq.current }]);
  }, []);
  const replace = useCallback((view: ViewId, params: ViewParams = {}) => {
    setStack(s => [...s.slice(0, -1), { view, params, key: ++seq.current }]);
  }, []);
  const reset = useCallback((view: ViewId, params: ViewParams = {}, under: ViewId = "community") => {
    setStack([{ view: under, params: {}, key: ++seq.current }, { view, params, key: ++seq.current }]);
  }, []);
  const tab = useCallback((view: ViewId) => {
    setStack(() => [...(view === "home" ? [] : [{ view: "home" as ViewId, params: {}, key: ++seq.current }]), { view, params: {}, key: ++seq.current }]);
  }, []);
  const back = useCallback((fallback: ViewId = "home") => {
    setStack(s => (s.length > 1 ? s.slice(0, -1).map((e, i, a) => (i === a.length - 1 ? { ...e, key: ++seq.current } : e))
      : [{ view: fallback, params: {}, key: ++seq.current }]));
  }, []);

  const stackRef = useRef(stack);
  stackRef.current = stack;
  useEffect(() => {
    const arm = () => { try { history.pushState({ aryaBack: 1 }, ""); } catch { /* no history API */ } };
    arm();
    const onPop = () => {
      for (let i = backHandlers.length - 1; i >= 0; i--) if (backHandlers[i]()) { arm(); return; }
      if (stackRef.current.length > 1) { back(); arm(); return; }
      history.back(); // the first view: Back leaves the app
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [back]);

  // Every view opens at its top, not wherever the last one was left
  // (QA 2026-10-28).
  useEffect(() => { window.scrollTo(0, 0); }, [top.view, top.key]);

  const nav = useMemo<Nav>(() => ({ view: top.view, params: top.params, key: top.key, show, replace, reset, back, tab, chrome, setChrome, depth: stack.length }),
    [top, show, replace, reset, back, tab, chrome, stack.length]);

  // Test and parity hook: tools/parity.mjs opens screens directly.
  useEffect(() => { (window as any).__aryaShow = show; }, [show]);

  return <Ctx.Provider value={nav}>{children}</Ctx.Provider>;
}

export function useNav(): Nav {
  const n = useContext(Ctx);
  if (!n) throw new Error("useNav outside NavProvider");
  return n;
}
