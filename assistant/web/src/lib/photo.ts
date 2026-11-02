/* Photo compression before upload (owner's group test, 2026-11-01: a
 * receipt photo from an iPhone 17 Pro came back "photo too large").
 * Big or HEIC photos are redrawn as JPEG at up to 6 megapixels (long
 * side at most 4096 px): small print on a long receipt stays readable,
 * and the upload is a few MB instead of 10+. PDFs, small photos and
 * anything the browser cannot draw go up unchanged. */
const MAX_PIXELS = 6_000_000;
const MAX_SIDE = 4096;
const SMALL = 1_500_000;

const isPdf = (f: Blob & { name?: string }) => f.type === "application/pdf" || /\.pdf$/i.test(f.name || "");
const drawable = (t: string) => /^image\/(jpe?g|png|webp)$/i.test(t);

type Source = { width: number; height: number; img: CanvasImageSource; done: () => void };

async function load(f: Blob): Promise<Source> {
  try {
    const bmp = await createImageBitmap(f);
    return { width: bmp.width, height: bmp.height, img: bmp, done: () => bmp.close?.() };
  } catch { /* some browsers cannot make a bitmap from HEIC: try an <img> */ }
  const url = URL.createObjectURL(f);
  const img = new Image();
  await new Promise<void>((ok, no) => { img.onload = () => ok(); img.onerror = () => no(new Error("unreadable")); img.src = url; });
  return { width: img.naturalWidth, height: img.naturalHeight, img, done: () => URL.revokeObjectURL(url) };
}

export function photoScale(w: number, h: number): number {
  if (!w || !h) return 1;
  return Math.min(1, Math.sqrt(MAX_PIXELS / (w * h)), MAX_SIDE / Math.max(w, h));
}

/* The file to send: the original, or a smaller JPEG with the same name. */
export async function fitPhoto<T extends Blob & { name?: string }>(f: T): Promise<T | File> {
  if (!f || isPdf(f)) return f;
  if (f.size <= SMALL && drawable(f.type || "image/jpeg")) return f;
  let src: Source;
  try { src = await load(f); } catch { return f; }
  try {
    const k = photoScale(src.width, src.height);
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(src.width * k));
    c.height = Math.max(1, Math.round(src.height * k));
    const ctx = c.getContext("2d");
    if (!ctx) return f;
    ctx.drawImage(src.img, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>(ok => c.toBlob(ok, "image/jpeg", 0.85));
    if (!blob || (blob.size >= f.size && drawable(f.type))) return f;
    const name = (f.name || "photo").replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } catch {
    return f;
  } finally {
    src.done();
  }
}
