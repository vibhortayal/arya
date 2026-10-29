import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "../i18n";

/* The one toast (pwa/app.js toast()): a dark pill under the header.
 * Errors go here, never into content labels. */
type Opts = { action?: string; onAction?: () => void };
type ToastFn = (msg: string, opts?: Opts) => void;
const Ctx = createContext<{ toast: ToastFn; showErr: (e: unknown) => void; hide: () => void } | null>(null);

/* The toast for code outside React (the hunt outbox's "Back online"
 * when no hunt screen is up). A no-op until the provider mounts. */
let current: ToastFn = () => {};
export const toastGlobal: ToastFn = (msg, opts) => current(msg, opts);

/* How long a toast stays up: 60 ms a character, at least 4 s, and at
 * least 7 s when it carries an action (Undo). */
export const toastMs = (msg: string, hasAction: boolean) => Math.max(hasAction ? 7000 : 4000, 60 * String(msg ?? "").length);

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [cur, setCur] = useState<{ msg: string; opts?: Opts; n: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const hide = useCallback(() => { clearTimeout(timer.current); setCur(null); }, []);

  const toast = useCallback<ToastFn>((msg, opts) => {
    clearTimeout(timer.current);
    setCur(prev => ({ msg, opts, n: (prev?.n || 0) + 1 }));
    timer.current = window.setTimeout(() => setCur(null), toastMs(msg, !!opts?.action));
  }, []);
  current = toast;
  const showErr = useCallback((e: unknown) => toast("Could not load: " + (e instanceof Error ? e.message : String(e))), [toast]);

  return (
    <Ctx.Provider value={{ toast, showErr, hide }}>
      {children}
      <div id="toast" role="status" aria-live="polite" hidden={!cur}>
        {cur?.msg}
        {cur?.opts?.action && (
          <button type="button" className="toastact" onClick={() => { const f = cur.opts?.onAction; hide(); f?.(); }}>{cur.opts.action}</button>
        )}
        <button type="button" className="toastclose" aria-label={t("common.dismiss")} onClick={hide}>
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
