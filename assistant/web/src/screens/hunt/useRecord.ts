import { useEffect, useRef, useState } from "react";
import { startCapture, transcribeBlob, voiceSupported, type Capture } from "../../lib/recorder";
import { useToast } from "../../ui/Toast";

/* pwa/app.js wireRecordButton as a hook: one tap starts listening, the
 * next stops and transcribes; the status line says what is happening.
 * A text button reads "Stop & transcribe" while listening. */
export function useRecord(onText: (text: string) => void) {
  const { toast } = useToast();
  const cap = useRef<Capture | null>(null);
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState("");
  const cb = useRef(onText);
  cb.current = onText;

  // A capture that resolves after the screen went away is let go.
  const dead = useRef(false);
  const seq = useRef(0); // bumps on cancel: a pending start or transcript is dropped
  useEffect(() => {
    dead.current = false;
    return () => { dead.current = true; cap.current?.cancel(); cap.current = null; };
  }, []);

  /* Stop listening without a transcript (a sheet closed mid-capture). */
  const cancel = () => {
    seq.current++;
    if (cap.current) { cap.current.cancel(); cap.current = null; }
    setListening(false);
    setStatus("");
  };

  const click = async () => {
    const my = seq.current;
    if (cap.current) {
      const wav = cap.current.stop();
      cap.current = null;
      setListening(false);
      setStatus("Transcribing with Muse Voice Transcribe…");
      try {
        const text = await transcribeBlob(wav);
        if (dead.current || my !== seq.current) return;
        setStatus(text ? "" : "That did not come through. Try again, closer to the mic.");
        if (text) cb.current(text);
      } catch (e) {
        if (dead.current || my !== seq.current) return;
        setStatus("");
        toast("Transcription failed: " + (e instanceof Error ? e.message : String(e)));
      }
      return;
    }
    if (!voiceSupported()) {
      setStatus("Voice input is not available in this browser. The microphone on your keyboard works too.");
      return;
    }
    try {
      const c = await startCapture();
      if (dead.current || my !== seq.current) { c.cancel(); return; }
      cap.current = c;
      setListening(true);
      setStatus("Listening…");
    } catch {
      setStatus("Microphone access was refused. You can type instead.");
    }
  };
  return { listening, status, click, cancel };
}
