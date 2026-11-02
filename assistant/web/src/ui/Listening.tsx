import { useEffect, useRef, useState } from "react";
import type { Capture } from "../lib/recorder";
import { useTranslation } from "../i18n";

/* The Listening card (owner, 2026-11-01: people did not know Arya was
 * listening). A red dot, bars that move with the voice, a timer, and one
 * action: Stop and send, with Cancel beside it. No live words: the audio
 * goes only to Meta when the person taps Stop and send. While the words
 * come back, the same card reads "Got it, reading…". */

const BARS = 18;

export function ListeningCard({ capture, reading, onStop, onCancel, id }:
  { capture: Capture | null; reading?: boolean; onStop: () => void; onCancel: () => void; id?: string }) {
  const { t } = useTranslation();
  const [secs, setSecs] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0.08));
  const cap = useRef(capture);
  cap.current = capture;

  useEffect(() => {
    if (reading) return;
    const start = Date.now();
    const tick = window.setInterval(() => setSecs(Math.floor((Date.now() - start) / 1000)), 500);
    const draw = window.setInterval(() => {
      const l = cap.current?.level?.() ?? 0;
      setLevels(prev => [...prev.slice(1), Math.max(0.08, Math.min(1, l * (0.7 + Math.random() * 0.6)))]);
    }, 90);
    return () => { window.clearInterval(tick); window.clearInterval(draw); };
  }, [reading]);

  const time = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  return (
    <div className={"listencard" + (reading ? " reading" : "")} id={id} role="status" aria-live="polite">
      <div className="lc-head">
        <span className="lc-dot" aria-hidden="true" />
        <b>{reading ? t("common.voice.card.reading") : t("common.voice.listening")}</b>
        {!reading && <span className="lc-time" aria-label={t("common.voice.card.time", { time })}>{time}</span>}
      </div>
      {!reading && <>
        <div className="lc-bars" aria-hidden="true">{levels.map((v, i) => <i key={i} style={{ height: `${Math.round(6 + v * 28)}px` }} />)}</div>
        <p className="lc-hint">{t("common.voice.card.hint")}</p>
        <div className="lc-acts">
          <button type="button" className="btn" data-listen="cancel" onClick={onCancel}>{t("common.cancel")}</button>
          <button type="button" className="btn primary" data-listen="stop" onClick={onStop}>{t("common.voice.card.stopAndSend")}</button>
        </div>
      </>}
    </div>
  );
}
