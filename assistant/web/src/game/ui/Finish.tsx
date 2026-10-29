/* The finish: the level-clear ritual (Mario's flagpole, Candy Crush's
 * Sugar Crush, GTA's mission passed). The tally counts up line by
 * line, then the meta rewards land one at a time: level, stickers,
 * the mystery sticker, the weekly streak, how much of the store is
 * built. Every line is something the player really did. */
import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { levelOf, BUNDLES, type Profile, type Rewards } from "../core/meta";
import { tally, type Trip } from "../core/trip";
import { buzz, stinger, tick } from "../fx/feel";
import { Juice } from "../fx/juice";
import { charArt } from "../assets";
import { Bar } from "./bits";

type Props = {
  trip: Trip; rewards: Rewards; profile: Profile;
  onDone: () => void; onRealQuest: () => void; onAgain: () => void;
  onRoute: (notes: string[]) => void;
};

const NOTES = ["Great route", "Too much walking", "Order felt off", "A section has moved"];

export function Finish({ trip, rewards, profile, onDone, onRealQuest, onAgain, onRoute }: Props) {
  const lines = tally(trip);
  const [shown, setShown] = useState(0);
  const [count, setCount] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [sent, setSent] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const juice = useRef<Juice | null>(null);
  const practice = rewards.practice;

  useEffect(() => {
    const j = new Juice(root.current!); juice.current = j;
    const t0 = window.setTimeout(() => { stinger(true); buzz([40, 60, 40, 60, 120]); j.confetti(); j.shake(); }, 150);
    // One tally line every 380 ms, each with a rising tick.
    const ts = lines.map((_, i) => window.setTimeout(() => { setShown(i + 1); tick(i * 2); }, 700 + i * 380));
    return () => { clearTimeout(t0); ts.forEach(clearTimeout); j.destroy(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The total counts up to the points of the lines shown so far.
  const target = lines.slice(0, shown).reduce((s, l) => s + l.pts, 0);
  useEffect(() => {
    if (count >= target) return;
    const id = requestAnimationFrame(() => setCount(c => Math.min(target, c + Math.max(1, Math.ceil((target - c) / 6)))));
    return () => cancelAnimationFrame(id);
  }, [count, target]);

  const tallied = shown >= lines.length;
  const before = levelOf(profile.xp - rewards.xp), after = levelOf(profile.xp);
  const stage = rewards.stage;
  const reveal = (e: React.MouseEvent) => {
    if (flipped) return;
    setFlipped(true);
    const j = juice.current!; const p = j.at(e.currentTarget);
    window.setTimeout(() => { j.sparkle(p.x, p.y, 26); j.burst(p.x, p.y, 30); stinger(false); buzz(30); }, 260);
  };
  const stagger = (i: number) => ({ initial: { opacity: 0, y: 18 }, animate: tallied ? { opacity: 1, y: 0 } : {}, transition: { delay: 0.15 + i * 0.22 } });

  return (
    <div className="qg-finish" ref={root}>
      <motion.div className="qg-stinger" initial={{ scale: 2.6, opacity: 0, rotate: -8 }} animate={{ scale: 1, opacity: 1, rotate: -3 }} transition={{ type: "spring", damping: 10, stiffness: 180, delay: 0.1 }}>
        <small>{practice ? "Practice Market" : `${trip.layout.name} · ${trip.layout.area}`}</small>
        <b>{practice ? "PRACTICE CLEAR!" : "TRIP CLEAR!"}</b>
      </motion.div>

      <div className="qg-tally" aria-live="polite">
        {lines.map((l, i) => (
          <motion.div key={l.label} className="qg-tline" initial={{ opacity: 0, x: -24 }} animate={i < shown ? { opacity: 1, x: 0 } : {}}>
            <span>{l.label}</span><b>+{l.pts}</b>
          </motion.div>
        ))}
        <div className="qg-total"><span>Points</span><motion.b key={tallied ? "done" : "run"} animate={tallied ? { scale: [1, 1.25, 1] } : {}}>{count}</motion.b></div>
      </div>

      {practice ? (
        <motion.div className="qg-card" {...stagger(0)}>
          <p className="qg-p"><b>You know how to play.</b> Practice never saves anything. On a real trip, these points level you up, fill your sticker album and build the store map for everyone.</p>
          <button className="qg-btn primary big" onClick={onRealQuest}>Start a real quest</button>
          <button className="qg-btn ghost" onClick={onAgain}>Practice again</button>
        </motion.div>
      ) : (
        <>
          <motion.div className="qg-card" {...stagger(0)}>
            <div className="qg-lv"><b>Level {after.level}</b><span>{after.into} / {after.need} xp</span></div>
            <Bar value={tallied ? after.into : before.level === after.level ? before.into : 0} max={after.need} label="Level progress" />
            {rewards.levelUp && <p className="qg-up">⬆ Level up! You reached level {rewards.levelUp}.</p>}
          </motion.div>

          {(rewards.newStickers.length > 0 || rewards.mystery) && (
            <motion.div className="qg-card" {...stagger(1)}>
              <h3>New stickers</h3>
              <div className="qg-parade">
                {rewards.newStickers.map((s, i) => (
                  <motion.img key={s} src={charArt(s)} alt={s.replace(".webp", "")} className={rewards.newShiny.includes(s) ? "shiny" : ""}
                    initial={{ scale: 0, rotate: -30 }} animate={tallied ? { scale: 1, rotate: 0 } : {}} transition={{ type: "spring", damping: 9, delay: 0.5 + i * 0.12 }} />
                ))}
              </div>
              {rewards.newShiny.length > 0 && <p className="qg-small">✨ Shiny: you found these where nobody had mapped yet.</p>}
              {rewards.mystery && (
                <button className={"qg-mystery" + (flipped ? " open" : "")} onClick={reveal} aria-label={flipped ? `Mystery sticker: ${rewards.mystery.replace(".webp", "")}` : "Open the mystery sticker"}>
                  <span className="front">?</span>
                  <span className="back"><img src={charArt(rewards.mystery)} alt="" /></span>
                  <em>{flipped ? "Bonus sticker for your album!" : "Tap to open your checkout sticker"}</em>
                </button>
              )}
            </motion.div>
          )}

          <motion.div className="qg-card qg-row2" {...stagger(2)}>
            <div><span className="qg-big">🔥 {rewards.streak.weeks}</span><small>week streak{rewards.streak.freezesLeft < 2 ? ` · ${rewards.streak.freezesLeft} rest week${rewards.streak.freezesLeft === 1 ? "" : "s"} left` : ""}</small></div>
            <div><span className="qg-big">{stage.after.pct}%</span><small>{trip.layout.name} mapped · {stage.after.name}{stage.after.name !== stage.before.name ? " (new!)" : ""}</small></div>
          </motion.div>

          {rewards.bundlesDone.length > 0 && (
            <motion.div className="qg-card" {...stagger(3)}>
              {rewards.bundlesDone.map(id => { const b = BUNDLES.find(x => x.id === id)!; return <p key={id} className="qg-p">🎁 <b>{b.name} complete!</b> {b.reward}.</p>; })}
            </motion.div>
          )}

          <motion.div className="qg-card" {...stagger(4)}>
            <h3>How was the route?</h3>
            <div className="qg-chips">
              {NOTES.map(n => (
                <button key={n} className={notes.includes(n) ? "on" : ""} disabled={sent} aria-pressed={notes.includes(n)} onClick={() => setNotes(x => (x.includes(n) ? x.filter(y => y !== n) : [...x, n]))}>{n}</button>
              ))}
            </div>
            {notes.length > 0 && !sent && <button className="qg-btn" onClick={() => { onRoute(notes); setSent(true); }}>Send to Arya</button>}
            {sent && <p className="qg-small">Thanks! Two shoppers saying the same thing updates the map.</p>}
          </motion.div>
          <motion.div {...stagger(5)}>
            <button className="qg-btn primary big" onClick={onDone}>Done</button>
          </motion.div>
        </>
      )}
    </div>
  );
}
