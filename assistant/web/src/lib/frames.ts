/* Frame helpers for Map my store: grading a frame on the phone (no
 * network, no model), turning a canvas into a small JPEG, spotting a
 * near-repeat of the last frame kept, and picking frames out of a
 * video or a set of photos the shopper uploads. */

export function sharpness(canvas: HTMLCanvasElement) {
  const w = 160, h = Math.max(1, Math.round(canvas.height * 160 / canvas.width));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const ctx = c.getContext("2d")!; ctx.drawImage(canvas, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  let luma = 0;
  for (let i = 0; i < w * h; i++) { g[i] = 0.3 * d[i * 4] + 0.59 * d[i * 4 + 1] + 0.11 * d[i * 4 + 2]; luma += g[i]; }
  let sum = 0, sq = 0, n = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const l = -4 * g[y * w + x] + g[y * w + x - 1] + g[y * w + x + 1] + g[(y - 1) * w + x] + g[(y + 1) * w + x];
    sum += l; sq += l * l; n++;
  }
  return { sharp: sq / n - (sum / n) * (sum / n), luma: luma / (w * h) };
}

/* A frame from a video element or an image, at most 1280 px wide. */
export function grab(src: HTMLVideoElement | HTMLImageElement) {
  const sw = src instanceof HTMLVideoElement ? src.videoWidth : src.naturalWidth;
  const sh = src instanceof HTMLVideoElement ? src.videoHeight : src.naturalHeight;
  const scale = Math.min(1, 1280 / (sw || 1280));
  const c = document.createElement("canvas");
  c.width = Math.round((sw || 1280) * scale);
  c.height = Math.round((sh || 960) * scale);
  c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

export const toJpeg = (c: HTMLCanvasElement, q = 0.85) =>
  new Promise<Blob>(res => c.toBlob(b => res(b as Blob), "image/jpeg", q));

/* A 16x12 grey thumbnail: two frames whose thumbnails barely differ
 * show the same thing (the shopper stood still), so the second is not
 * kept. */
export function thumb(c: HTMLCanvasElement): Uint8Array {
  const t = document.createElement("canvas"); t.width = 16; t.height = 12;
  const g = t.getContext("2d")!; g.drawImage(c, 0, 0, 16, 12);
  const d = g.getImageData(0, 0, 16, 12).data;
  const out = new Uint8Array(16 * 12);
  for (let i = 0; i < out.length; i++) out[i] = (d[i * 4] * 3 + d[i * 4 + 1] * 6 + d[i * 4 + 2]) / 10;
  return out;
}
export function sameView(a: Uint8Array | null, b: Uint8Array, limit = 7) {
  if (!a) return false;
  let diff = 0;
  for (let i = 0; i < b.length; i++) diff += Math.abs(a[i] - b[i]);
  return diff / b.length < limit;
}

function seekTo(video: HTMLVideoElement, t: number) {
  return new Promise<void>(res => { video.onseeked = () => res(); video.currentTime = t; });
}

/* Frames out of a video the shopper recorded, about one every 2 s,
 * spread over at most `max` frames, the sharp ones kept. The video
 * itself never leaves the phone. Up to `maxSeconds` of it is read. */
export async function videoFrames(file: File, max: number, onProgress?: (done: number, total: number) => void,
  maxSeconds = 300): Promise<Blob[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true; video.playsInline = true; video.preload = "auto"; video.src = url;
  try {
    await new Promise<void>((res, rej) => { video.onloadedmetadata = () => res(); video.onerror = () => rej(new Error("bad video")); });
    const dur = Math.min(video.duration || 1, maxSeconds);
    const n = Math.max(1, Math.min(max, Math.round(dur / 2)));
    const out: Blob[] = [];
    let last: Uint8Array | null = null;
    for (let i = 0; i < n; i++) {
      await seekTo(video, dur * (i + 0.5) / n);
      const c = grab(video), g = sharpness(c), th = thumb(c);
      if (g.luma > 30 && !sameView(last, th)) { out.push(await toJpeg(c)); last = th; }
      onProgress?.(i + 1, n);
    }
    return out;
  } finally { URL.revokeObjectURL(url); }
}

/* A photo the shopper picked, as a JPEG at most 1280 px wide. */
export async function photoFrame(file: File): Promise<Blob | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return await toJpeg(grab(img));
  } catch { return null; } finally { URL.revokeObjectURL(url); }
}
