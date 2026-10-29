import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

/* The one toast (pwa/app.js toast()): a dark pill under the header.
 * Errors go here, never into content labels. */
type Opts = { action?: string; onAction?: () => void };
type ToastFn = (msg: string, opts?: Opts) => void;
const Ctx = createContext<{ toast: ToastFn; showErr: (e: unknown) => void } | null>(null);

/* How long a toast stays up: 60 ms a character, at least 4 s, and at
 * least 7 s when it carries an action (Undo). */
export const toastMs = (msg: string, hasAction: boolean) => Math.max(hasAction ? 7000 : 4000, 60 * String(msg ?? "").length);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ msg: string; opts?: Opts; n: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const hide = () => { clearTimeout(timer.current); setT(null); };

  const toast = useCallback<ToastFn>((msg, opts) => {
    clearTimeout(timer.current);
    setT(prev => ({ msg, opts, n: (prev?.n || 0) + 1 }));
    timer.current = window.setTimeout(() => setT(null), toastMs(msg, !!opts?.action));
  }, []);
  const showErr = useCallback((e: unknown) => toast("Could not load: " + (e instanceof Error ? e.message : String(e))), [toast]);

  return (
    <Ctx.Provider value={{ toast, showErr }}>
      {children}
      <div id="toast" role="status" aria-live="polite" hidden={!t}>
        {t?.msg}
        {t?.opts?.action && (
          <button type="button" className="toastact" onClick={() => { const f = t.opts?.onAction; hide(); f?.(); }}>{t.opts.action}</button>
        )}
        <button type="button" className="toastclose" aria-label="Dismiss" onClick={hide}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useToast outside ToastProvider");
  return c;
}
