/* Address checks the shell makes before any screen loads. They live
 * here, not in their screens, so the shell can lazy-load those screens
 * (speed audit #17). */
export const DEV_PATH = "/developers";
export const isDevelopersPath = (path: string) => path.replace(/\/+$/, "") === DEV_PATH;

/* An invite link (/?join=CODE). */
export function joinCodeFromUrl(): string {
  try { return new URLSearchParams(location.search).get("join") || ""; } catch { return ""; }
}
