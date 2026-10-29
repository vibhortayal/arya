/* The shared voice recorder (pwa/app.js startCapture / encodeWav /
 * transcribeBlob): microphone capture to mono 16-bit PCM WAV at
 * 16 kHz, the Meta ASR batch endpoint's input contract, then
 * POST /api/transcribe. Ask and the New list composer both use it. */

export type Capture = {
  /* Stop and return the recording as WAV. */
  stop: () => Blob;
  /* Stop without a recording (the screen went away mid-capture). */
  cancel: () => void;
};

export const voiceSupported = () =>
  !!navigator.mediaDevices && !!(window.AudioContext || (window as any).webkitAudioContext);

export async function startCapture(): Promise<Capture> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const AC = window.AudioContext || (window as any).webkitAudioContext;
  const ctx: AudioContext = new AC();
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  proc.onaudioprocess = (ev: AudioProcessingEvent) => chunks.push(new Float32Array(ev.inputBuffer.getChannelData(0)));
  src.connect(proc);
  proc.connect(ctx.destination);
  const end = () => {
    proc.disconnect();
    src.disconnect();
    stream.getTracks().forEach(t => t.stop());
  };
  return {
    stop() {
      end();
      const wav = encodeWav(chunks, ctx.sampleRate);
      ctx.close();
      return wav;
    },
    cancel() {
      try { end(); ctx.close(); } catch { /* already closed */ }
    },
  };
}

export function encodeWav(chunks: Float32Array[], srcRate: number): Blob {
  const target = 16000;
  let len = 0;
  chunks.forEach(c => { len += c.length; });
  const flat = new Float32Array(len);
  let off = 0;
  chunks.forEach(c => { flat.set(c, off); off += c.length; });
  const ratio = srcRate / target;
  const n = Math.floor(flat.length / ratio);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const wstr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  wstr(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  wstr(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, target, true);
  v.setUint32(28, target * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  wstr(36, "data");
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, flat[Math.floor(i * ratio)]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

export async function transcribeBlob(wav: Blob): Promise<string> {
  const r = await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav });
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { detail?: string }).detail || `HTTP ${r.status}`);
  return ((await r.json()) as { text?: string }).text || "";
}
