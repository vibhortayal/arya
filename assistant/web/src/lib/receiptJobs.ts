import { api, post } from "./api";

/* Background receipt reading (api/receiptjobs.py): the phone sends the
 * pictures and PDFs up first, the server reads them while the app is
 * closed. */
export type ReceiptJob = {
  id: string; status: "uploading" | "queued" | "reading" | "paused" | "ready" | "failed";
  total: number; received: number; done: number; filed: number; duplicate: number; failed: number;
  failures: { name: string; reason: string }[]; reason?: string | null; seen: boolean; at: string;
};

const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name || "");
const mediaOf = (f: File) => isPdf(f) ? "application/pdf" : (f.type || "image/jpeg");

/* Opens a batch and sends each file (one retry each), then commits. A
 * file that cannot be sent is listed in `unsent` with the reason. Throws
 * when the batch cannot be opened (the caller then reads in the browser,
 * as before). */
export async function sendBatch(files: File[], onProgress: (sent: number) => void) {
  const job = await post<ReceiptJob>("/api/receipts/jobs", { count: files.length });
  const unsent: { name: string; reason: string }[] = [];
  let sent = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const put = () => api(`/api/receipts/jobs/${job.id}/files/${i}`, {
      method: "PUT", headers: { "Content-Type": mediaOf(f), "X-File-Name": encodeURIComponent(f.name || "").slice(0, 200) }, body: f });
    try {
      try { await put(); } catch (e) { if ((e as { status?: number }).status) throw e; await put(); }
      sent++;
    } catch (e) {
      unsent.push({ name: f.name, reason: e instanceof Error ? e.message : String(e) });
    }
    onProgress(i + 1);
  }
  const out = await post<ReceiptJob>(`/api/receipts/jobs/${job.id}/commit`);
  return { job: out, unsent, sent };
}
