import { Component, type ReactNode } from "react";
import { t } from "../i18n";

/* A screen that throws shows a Retry card, never a white page (speed
 * audit #22). A deploy swaps the build's hashed file names, so an open
 * tab that lazy-loads a screen from the old build fails to fetch it:
 * that case reloads the page once to pick up the new build. */
const RELOADED = "arya.chunkReload";
export const isChunkError = (e: unknown) =>
  /dynamically imported module|Importing a module script failed|error loading dynamically imported|ChunkLoadError/i.test(String((e as Error)?.message || e));

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) {
    console.warn("Arya:", e);
    if (!isChunkError(e)) return;
    let once = false;
    try { once = sessionStorage.getItem(RELOADED) === "1"; sessionStorage.setItem(RELOADED, "1"); } catch { /* private window */ }
    if (!once) location.reload();
  }
  componentDidMount() {
    // A screen that drew after the reload clears the flag for the next deploy.
    window.setTimeout(() => { try { sessionStorage.removeItem(RELOADED); } catch { /* private window */ } }, 10000);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="empty" role="alert">
        <p>{t("common.screenFailed")}</p>
        <button className="btn" type="button" onClick={() => location.reload()}>{t("common.tryAgain")}</button>
      </div>
    );
  }
}

/* Lazy screens wait behind skeleton rows, not a blank page (#28). */
export function ScreenSkeleton() {
  return <div className="skel" role="status" aria-label={t("common.loading")}><i /><i /><i /></div>;
}
