import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSession } from "../app/session";
import { post } from "../lib/api";
import { useToast } from "../ui/Toast";
import { IconMic, IconSpeaker } from "../ui/icons";

/* Port of "Ask Arya + voice" (pwa/app.js, pwa/index.html #view-chat).
 * The log and the history outlive the screen, as the old DOM did. */
type Line = { kind: "me" | "arya" | "sys" | "actionchip"; text: string };
type Msg = { role: "user" | "assistant"; content: string };
const lines: Line[] = [];
const history: Msg[] = [];
const SUGGEST = ["What's running low?", "What did I spend this month?", "Add eggs to my list"];

/* Local helpers (the old recorder lives in app.js): mic capture to
 * mono 16-bit 16 kHz WAV, then POST /api/transcribe. */
async function startCapture() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const AC = window.AudioContext || (window as any).webkitAudioContext;
  const ctx = new AC();
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  proc.onaudioprocess = ev => chunks.push(new Float32Array(ev.inputBuffer.getChannelData(0)));
  src.connect(proc);
  proc.connect(ctx.destination);
  return {
    stop() {
      proc.disconnect();
      src.disconnect();
      stream.getTracks().forEach(t => t.stop());
      const wav = encodeWav(chunks, ctx.sampleRate);
      ctx.close();
      return wav;
    },
  };
}

function encodeWav(chunks: Float32Array[], srcRate: number) {
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

async function transcribeBlob(wav: Blob) {
  const r = await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav });
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { detail?: string }).detail || `HTTP ${r.status}`);
  return ((await r.json()) as { text?: string }).text || "";
}

const readSpeak = () => { try { return localStorage.getItem("arya-speak") === "1"; } catch { return false; } };

export function Chat() {
  const { demo } = useSession();
  const { toast } = useToast();
  const [log, setLog] = useState<Line[]>(() => lines.slice());
  const [text, setText] = useState("");
  const [speakOn, setSpeakOn] = useState(readSpeak);
  const [listening, setListening] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const capture = useRef<Awaited<ReturnType<typeof startCapture>> | null>(null);
  const speakRef = useRef(speakOn);
  const input = useRef<HTMLInputElement>(null);
  const logEl = useRef<HTMLDivElement>(null);
  speakRef.current = speakOn;

  useEffect(() => {
    (logEl.current?.lastElementChild as HTMLElement | null | undefined)?.scrollIntoView?.({ block: "end" });
  }, [log]);

  const add = (...l: Line[]) => { lines.push(...l); setLog(lines.slice()); };

  const toggleSpeak = () => {
    const next = !speakOn;
    setSpeakOn(next);
    try { localStorage.setItem("arya-speak", next ? "1" : "0"); } catch { /* ignore */ }
    if (!next && "speechSynthesis" in window) speechSynthesis.cancel();
  };
  const speak = (t: string) => {
    if (!speakRef.current || !("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    speechSynthesis.speak(new SpeechSynthesisUtterance(t));
  };

  const send = async (raw: string) => {
    const q = raw.trim();
    if (!q) { toast("Type a question first."); input.current?.focus(); return; }
    setText("");
    history.push({ role: "user", content: q });
    add({ kind: "me", text: q });
    try {
      const res = await post<{ reply: string; applied?: string[]; skipped?: string[] }>("/api/chat", { messages: history });
      history.push({ role: "assistant", content: res.reply });
      add({ kind: "arya", text: res.reply },
        ...(res.applied || []).map(a => ({ kind: "actionchip" as const, text: "✓ " + a })),
        ...(res.skipped || []).map(a => ({ kind: "sys" as const, text: a })));
      speak(res.reply);
    } catch (e) {
      add({ kind: "arya", text: "I could not answer that: " + (e instanceof Error ? e.message : String(e)) });
    }
  };

  const mic = async () => {
    if (capture.current) {
      const wav = capture.current.stop();
      capture.current = null;
      setListening(false);
      setNote("Transcribing with Muse Voice Transcribe…");
      try {
        const t = await transcribeBlob(wav);
        if (t) { setNote(null); send(t); }
        else setNote("That did not come through. Try again, or type it.");
      } catch (e) {
        setNote("Transcription failed: " + (e instanceof Error ? e.message : String(e)));
      }
      return;
    }
    if (!navigator.mediaDevices || !(window.AudioContext || (window as any).webkitAudioContext)) {
      setNote("Voice input is not available in this browser. The microphone on your keyboard works too.");
      return;
    }
    try {
      capture.current = await startCapture();
      setListening(true);
      setNote("Listening… tap the mic again to send.");
    } catch {
      setNote("Microphone access was refused. You can type instead.");
    }
  };

  return (
    <>
      <h2 className="largetitle">Ask Arya</h2>
      {demo && <p id="chat-demo-note" className="note">Demo: Ask answers from the demo household and applies what you tell it for this visit only. Try &ldquo;We finished the milk&rdquo; or &ldquo;What do we spend on coffee?&rdquo;</p>}
      <div id="chat-log" ref={logEl}>
        {log.length === 0 ? (
          <div id="chat-empty">
            <p className="muted">Ask about your list, your spending, or what is running low.</p>
            {SUGGEST.map(q => <button key={q} className="chip" type="button" data-ask={q} onClick={() => send(q)}>{q}</button>)}
          </div>
        ) : log.map((l, i) => <div key={i} className={"bubble " + l.kind}>{l.text}</div>)}
      </div>
      <form id="chat-form" onSubmit={(ev: FormEvent) => { ev.preventDefault(); send(text); }}>
        <button id="btn-mic" type="button" className={"iconbtn" + (listening ? " listening" : "")} aria-label="Speak your message" onClick={mic}><IconMic /></button>
        <input type="text" id="chat-input" ref={input} placeholder="Ask Arya" autoComplete="off" aria-label="Message"
          value={text} onChange={e => setText(e.target.value)} />
        <button id="btn-speak" type="button" className={"iconbtn" + (speakOn ? " on" : "")} aria-label="Toggle spoken replies"
          aria-pressed={speakOn} onClick={toggleSpeak}><IconSpeaker /></button>
        <button type="submit" className="btn primary" id="chat-send">Send</button>
      </form>
      <p id="voice-note" className="muted" hidden={note === null}>{note}</p>
    </>
  );
}
