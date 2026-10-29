import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  SAMPLE_QUESTIONS, SAMPLE_RECEIPT, SAMPLE_TWO_STORES, addSampleItems, byCategory, compareStores, guessAisle, total,
  type SampleItem, type SampleReceipt, type TryKind,
} from "../guide/cards";
import { asset, money } from "../lib/format";
import { Sheet } from "./Sheet";
import { useTranslation } from "../i18n";

/* The guide's Try-it sheets (#154). Each runs on the sample data in
 * guide/cards.ts, in this component's state only: nothing is saved,
 * and nothing goes to the server or a model (guide.test.tsx spies on
 * fetch). Every sheet shows the blue Sample tag and the line "Try it
 * here. Nothing is saved." */

type Props = { kind: Exclude<TryKind, "quest">; onClose: () => void; onRealList: () => void };

export function GuideTry({ kind, onClose, onRealList }: Props) {
  const { t } = useTranslation();
  const title = {
    list: t("guide.sample.store.tj"), usesoon: t("guide.try.usesoon.title"), receipt: t("guide.try.receipt.title"),
    prices: t("guide.try.prices.title"), ask: t("guide.try.ask.title"),
  }[kind];
  return (
    <Sheet open onClose={onClose} id="gd-try-sheet" className="gd-trywrap" labelledBy="gd-try-title">
      <span className="sheetgrip" />
      <div className="sheethead">
        <h3 id="gd-try-title" className="nomargin">{title} <span className="samp">{t("guide.sampleTag")}</span></h3>
        <button type="button" className="linkbtn" onClick={onClose}>{t("common.close")}</button>
      </div>
      <p className="muted gd-tryline">{t("guide.tryLine")}</p>
      {kind === "list" && <TryList onRealList={onRealList} />}
      {kind === "usesoon" && <TryUseSoon />}
      {kind === "receipt" && <TryReceipt />}
      {kind === "prices" && <TryPrices />}
      {kind === "ask" && <TryAsk />}
    </Sheet>
  );
}

const SEED: SampleItem[] = [
  { name: "guide.try.list.seedEggs", aisleKey: guessAisle("eggs") },
  { name: "guide.try.list.seedBread", aisleKey: guessAisle("bread") },
];

function TryList({ onRealList }: { onRealList: () => void }) {
  const { t } = useTranslation();
  // Seed names are keys; typed names are the shopper's own words.
  const [items, setItems] = useState<SampleItem[]>(() => SEED.map(s => ({ ...s, name: t(s.name) })));
  const [text, setText] = useState("");
  const add = (ev: FormEvent) => {
    ev.preventDefault();
    setItems(cur => addSampleItems(cur, text));
    setText("");
  };
  return (
    <>
      <form className="gd-addrow" onSubmit={add}>
        <input type="text" id="gd-list-input" value={text} onChange={ev => setText(ev.target.value)} autoComplete="off"
          placeholder={t("guide.try.list.placeholder")} aria-label={t("guide.try.list.inputAria")} />
        <button className="btn primary" id="gd-list-add" type="submit">{t("guide.try.list.add")}</button>
      </form>
      <div className="group gd-sample" id="gd-list-items" aria-label={t("guide.try.list.itemsAria")} aria-live="polite">
        {items.map(it => (
          <div className="row" key={it.name}>
            <div className="grow"><span className="name">{it.name}</span><span className="sub">{t(it.aisleKey)}</span></div>
            {it.justAdded && <span className="samp new">{t("guide.try.list.justAdded")}</span>}
          </div>
        ))}
      </div>
      <button className="btn secondary wide" id="gd-real-list" type="button" onClick={onRealList}>{t("guide.try.list.real")}</button>
    </>
  );
}

function TryUseSoon() {
  const { t } = useTranslation();
  const [snapped, setSnapped] = useState(false);
  if (!snapped) {
    return (
      <>
        <p className="muted nomargin">{t("guide.try.usesoon.line")}</p>
        <div className="gd-photo" role="img" aria-label={t("guide.try.usesoon.photoAria")}>
          <img src={asset("assets/characters/dairy.webp")} alt="" />
          <span className="stamp">{t("guide.try.usesoon.stamp")}</span>
        </div>
        <button className="btn primary wide" id="gd-snap" type="button" data-first onClick={() => setSnapped(true)}>{t("guide.try.usesoon.snap")}</button>
      </>
    );
  }
  return (
    <>
      <div className="group gd-sample" id="gd-usesoon-row">
        <div className="row"><img className="rowface" src={asset("assets/characters/dairy.webp")} alt="" />
          <div className="grow"><span className="name">{t("guide.sample.item.yogurt")}</span><span className="sub">{t("guide.try.usesoon.useBy")}</span></div>
          <span className="peektag low">{t("common.useSoon")}</span></div>
      </div>
      <p className="muted">{t("guide.try.usesoon.after")}</p>
    </>
  );
}

function Receipt({ r, small }: { r: SampleReceipt; small?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className={"group gd-receipt" + (small ? " small" : "")}>
      <p className="gd-store">{t(r.storeKey)}</p>
      {r.lines.map(l => <div className="gd-line" key={l.nameKey}><span>{t(l.nameKey)}</span><span className="money">{money(l.price)}</span></div>)}
      {!small && <div className="gd-line tot"><span>{t("guide.try.receipt.total")}</span><span className="money">{money(total(r))}</span></div>}
    </div>
  );
}

function TryReceipt() {
  const { t } = useTranslation();
  const [filed, setFiled] = useState(false);
  const cats = byCategory(SAMPLE_RECEIPT);
  const max = Math.max(...cats.map(c => c.amount));
  return (
    <>
      <Receipt r={SAMPLE_RECEIPT} />
      {!filed
        ? <button className="btn primary wide" id="gd-file" type="button" data-first onClick={() => setFiled(true)}>{t("guide.try.receipt.file")}</button>
        : <>
          <p className="gd-ok" id="gd-filed" role="status">✓ {t("guide.try.receipt.filed")}</p>
          <h3 className="sect">{t("guide.try.receipt.byCategory")}</h3>
          <div className="group gd-bars" id="gd-cats">
            {cats.map(c => (
              <div className="month-row" key={c.catKey}><span>{t(c.catKey)}</span>
                <div className="track"><div className="bar" style={{ width: `${Math.round(c.amount / max * 100)}%` }} /></div>
                <span className="money">{money(c.amount)}</span></div>
            ))}
          </div>
        </>}
    </>
  );
}

function TryPrices() {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  const rows = compareStores(SAMPLE_TWO_STORES);
  return (
    <>
      <div className="gd-two">{SAMPLE_TWO_STORES.map(r => <Receipt key={r.storeKey} r={r} small />)}</div>
      {!shown
        ? <button className="btn primary wide" id="gd-compare" type="button" data-first onClick={() => setShown(true)}>{t("guide.try.prices.compare")}</button>
        : (
          <div className="mini wide" id="gd-compare-out">
            {rows.map(c => (
              <div className="r" key={c.nameKey}>
                <span><b>{t(c.nameKey)}</b><small className={c.cheapKey ? "good" : undefined}>
                  {c.cheapKey ? t("guide.try.prices.cheaperAt", { store: t(c.cheapKey) }) : t("guide.try.prices.same")}</small></span>
                {c.cheapKey && <span className="good">{t("guide.try.prices.save", { amount: money(c.dear - c.cheap) })}</span>}
              </div>
            ))}
          </div>
        )}
    </>
  );
}

function TryAsk() {
  const { t } = useTranslation();
  const [asked, setAsked] = useState<string[]>([]);
  const end = useRef<HTMLDivElement>(null);
  // The newest answer scrolls into view, as in Ask.
  useEffect(() => { if (asked.length) end.current?.scrollIntoView?.({ block: "nearest" }); }, [asked]);
  const log: ReactNode[] = [];
  for (const id of asked) {
    const q = SAMPLE_QUESTIONS.find(x => x.id === id)!;
    log.push(<div key={id + "q"} className="bubble me">{t(q.qKey)}</div>, <div key={id + "a"} className="bubble arya">{t(q.aKey)}</div>);
  }
  return (
    <>
      <div className="gd-chips">
        {SAMPLE_QUESTIONS.map(q => (
          <button key={q.id} className="chip" type="button" data-ask={q.id} disabled={asked.includes(q.id)}
            onClick={() => setAsked(a => [...a, q.id])}>{t(q.qKey)}</button>
        ))}
      </div>
      <div className="gd-chat" id="gd-chat" aria-live="polite">{log}<div ref={end} /></div>
    </>
  );
}
