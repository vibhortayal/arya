/* Find it for me in the Quest game (owner-approved mockup 2026-11-04,
 * https://claude.ai/artifact/GAFaAToXpR2f8mRLNPmTeo). One shelf photo
 * aimed at one item: the photo shows at once, SAM 3.1's boxes appear on
 * it, then the one Muse Spark agrees with lights up ("I want to see the
 * SAM detection and the item glow up"). A miss never says the item is
 * not there. */
import { useEffect, useMemo, useState } from "react";
import type { Box, FindResult } from "../core/source";
import { SnapButton } from "./bits";

export type FindState = { photo: File; result: FindResult | null };

type Props = {
  item: string;
  state: FindState;
  points: number;
  scout: boolean;
  onRetake: (f: File) => void;
  onGot: () => void;
  onEmpty: () => void;
  onClose: () => void;
};

const pct = (b: Box) => ({ left: b[0] * 100 + "%", top: b[1] * 100 + "%", width: (b[2] - b[0]) * 100 + "%", height: (b[3] - b[1]) * 100 + "%" });

export function FindIt({ item, state, points, scout, onRetake, onGot, onEmpty, onClose }: Props) {
  const url = useMemo(() => URL.createObjectURL(state.photo), [state.photo]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const r = state.result;
  // SAM's boxes first, then the verdict: the glow lands a beat later.
  const [lit, setLit] = useState(false);
  useEffect(() => {
    setLit(false);
    if (!r) return;
    const id = window.setTimeout(() => setLit(true), r.candidates.length ? 300 + 120 * Math.min(r.candidates.length, 6) : 0);
    return () => clearTimeout(id);
  }, [r]);
  const lower = item.toLowerCase();
  return (
    <div className="qg-find" role="dialog" aria-modal="true" aria-label="Find it for me">
      <div className="qg-find-top"><b>Find it for me</b><button className="qg-find-close" onClick={onClose}>Close</button></div>
      <div className="qg-find-stage">
        <div className="qg-find-photo">
          <img src={url} alt={`Shelf photo, looking for ${item}`} />
          {r && r.candidates.map((b, i) => (
            <span key={i} className={"qg-find-cand" + (lit && r.found ? " dim" : "")} style={{ ...pct(b), animationDelay: 120 * Math.min(i, 6) + "ms" }} />
          ))}
          {r && r.found && r.box && lit && <>
            <span className="qg-find-hit" style={pct(r.box)} />
            <span className="qg-find-pill" style={{ left: ((r.box[0] + r.box[2]) / 2) * 100 + "%", top: r.box[1] * 100 + "%" }}>{item}</span>
          </>}
        </div>
        {!r && <p className="qg-find-aim">Looking for <b>{item}</b>…</p>}
      </div>
      <div className="qg-find-bot" role="status">
        {!r ? <><span className="qg-find-spin" aria-hidden="true" /><p className="qg-find-note">Looking…</p></>
          : r.note ? <>
            <p className="qg-find-note">{r.note}</p>
            <SnapButton className="qg-find-btn pri" onPhoto={onRetake}>Look again</SnapButton>
            <button className="qg-find-btn" onClick={onClose}>Back</button>
          </> : !lit ? <p className="qg-find-note">{r.candidates.length ? `SAM 3.1 marked ${r.candidates.length} possible ${r.candidates.length === 1 ? "spot" : "spots"}. Muse Spark is checking…` : "Checking…"}</p>
          : r.found ? <>
            <p className="qg-find-note">There it is.</p>
            <p className="qg-find-by">SAM 3.1 marked it; Muse Spark agreed.</p>
            <button className="qg-find-btn go" onClick={onGot}>{scout ? "Found it here" : "Got it"} +{points}</button>
            <SnapButton className="qg-find-btn" onPhoto={onRetake}>Look again</SnapButton>
          </> : <>
            <p className="qg-find-note">Arya didn't spot {lower} in this photo. That doesn't mean it isn't here: try another part of the shelf.</p>
            <SnapButton className="qg-find-btn pri" onPhoto={onRetake}>Look again</SnapButton>
            <button className="qg-find-btn" onClick={onEmpty}>The shelf is empty</button>
            <button className="qg-find-btn" onClick={onClose}>Back</button>
          </>}
      </div>
    </div>
  );
}
