import { useEffect, useRef, useState } from "react";
import { startCapture, transcribeBlob, voiceSupported, type Capture } from "../../lib/recorder";
import { useToast } from "../../ui/Toast";
import { t } from "../../i18n";

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
      setStatus(t("common.voice.transcribing"));
      try {
        const text = await transcribeBlob(wav);
        if (dead.current || my !== seq.current) return;
        setStatus(text ? "" : t("common.voice.empty"));
        if (text) cb.current(text);
      } catch (e) {
        if (dead.current || my !== seq.current) return;
        setStatus("");
        toast(t("common.voice.failed", { error: e instanceof Error ? e.message : String(e) }));
      }
      return;
    }
    if (!voiceSupported()) {
      setStatus(t("common.voice.unsupported"));
      return;
    }
    try {
      const c = await startCapture();
      if (dead.current || my !== seq.current) { c.cancel(); return; }
      cap.current = c;
      setListening(true);
      setStatus(t("common.voice.listening"));
    } catch {
      setStatus(t("common.voice.refused"));
    }
  };
  return { listening, status, click, cancel };
}
