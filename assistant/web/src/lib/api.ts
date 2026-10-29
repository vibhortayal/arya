/* One door to the backend: same paths, same cookies, same error
 * wording as the plain-JS app (pwa/app.js api/post/put). */

/* Server details are short codes for developers; the person reads
 * a sentence (QA 2026-10-28). */
const FRIENDLY: Record<string, string> = {
  "no such session": "That hunt is gone — the demo resets now and then. Go back to Today and start it again.",
  "no account with that handle": "No one has that handle. Check the spelling and try again.",
  "this needs a real account": "This needs a real account — the demo keeps nothing.",
};

export function friendlyError(d: unknown): string {
  const s = typeof d === "string" ? d : "Something went wrong.";
  const key = s.toLowerCase().replace(/[.\s]+$/, "");
  if (FRIENDLY[key]) return FRIENDLY[key];
  if (key.startsWith("this needs a real account")) return FRIENDLY["this needs a real account"];
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

/* One id per open tab (app.js CLIENT_ID): group live sync
 * (app/groupLive.ts) skips the echo of this tab's own changes. */
export const CLIENT_ID = Math.random().toString(36).slice(2, 12);

export async function api<T = any>(path: string, opts?: RequestInit): Promise<T> {
  let r: Response;
  const headers = new Headers(opts?.headers || {});
  headers.set("X-Arya-Client", CLIENT_ID);
  try { r = await fetch(path, { ...opts, headers }); }
  catch {
    // A network failure stays a TypeError (the hunt's offline outbox
    // keys on it) but reads as what it is.
    throw new TypeError("No connection right now — try again when you're back online.");
  }
  if (!r.ok) {
    const detail = (await r.json().catch(() => ({}))).detail;
    throw new ApiError(friendlyError(detail || `HTTP ${r.status}`), r.status);
  }
  return r.json();
}

const json = (method: string, body?: unknown): RequestInit =>
  ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });

export const get = <T = any>(path: string) => api<T>(path);
export const post = <T = any>(path: string, body?: unknown) => api<T>(path, json("POST", body));
export const put = <T = any>(path: string, body?: unknown) => api<T>(path, json("PUT", body));
export const del = <T = any>(path: string) => api<T>(path, { method: "DELETE" });
/* Multipart upload (receipt photos, audio, shelf shots). */
export const upload = <T = any>(path: string, form: FormData) => api<T>(path, { method: "POST", body: form });
