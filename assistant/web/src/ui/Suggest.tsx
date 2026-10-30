import { useEffect, useState } from "react";
import { get, post } from "../lib/api";
import { t } from "../i18n";

/* Auto-suggest under the list's Add field (owner, 2026-10-30).
 * Yours, then shared names ($0, one GET after a short pause), then
 * model guesses (one POST after a longer pause, and only when the
 * first two come up thin). The server decides what is allowed. */

export type SuggestRow = { name: string; kind: "yours" | "shared" | "guess"; tag?: string; on?: string };

const MIN_Q = 2;
const MAX_ROWS = 5;
const PAUSE_MS = 150;
const GUESS_PAUSE_MS = 700;

/* The item being typed is the text after the last ; or line break. */
export function lastSegment(text: string): string {
  return (text.split(/[;\n]/).pop() || "").trim();
}

/* A picked name replaces only that last item. */
export function replaceLast(text: string, name: string): string {
  const i = Math.max(text.lastIndexOf(";"), text.lastIndexOf("\n"));
  return i < 0 ? name : text.slice(0, i + 1) + " " + name;
}

export function useSuggest(text: string, active: boolean): SuggestRow[] {
  const [rows, setRows] = useState<SuggestRow[]>([]);
  const q = lastSegment(text);
  useEffect(() => {
    if (!active || q.length < MIN_Q) { setRows([]); return; }
    let live = true;
    let guessTimer = 0;
    const timer = window.setTimeout(async () => {
      try {
        const r = await get<{ rows: SuggestRow[]; thin: boolean }>("/api/list/suggest?q=" + encodeURIComponent(q));
        if (!live) return;
        setRows(r.rows.slice(0, MAX_ROWS));
        if (!r.thin) return;
        guessTimer = window.setTimeout(async () => {
          try {
            const g = await post<{ guesses: SuggestRow[] }>("/api/list/suggest/guess", { q });
            if (!live || !g.guesses.length) return;
            const have = new Set(r.rows.map(x => x.name.toLowerCase()));
            setRows([...r.rows, ...g.guesses.filter(x => !have.has(x.name.toLowerCase()))].slice(0, MAX_ROWS));
          } catch { /* no guesses */ }
        }, GUESS_PAUSE_MS);
      } catch { if (live) setRows([]); }
    }, PAUSE_MS);
    return () => { live = false; window.clearTimeout(timer); window.clearTimeout(guessTimer); };
  }, [q, active]);
  return rows;
}

const GROUPS: { kind: SuggestRow["kind"]; head: string }[] = [
  { kind: "yours", head: "lists.suggest.yours" },
  { kind: "shared", head: "lists.suggest.shared" },
  { kind: "guess", head: "lists.suggest.guesses" },
];

function Bold({ name, q }: { name: string; q: string }) {
  const i = name.toLowerCase().indexOf(q.toLowerCase());
  if (!q || i < 0) return <>{name}</>;
  return <>{name.slice(0, i)}<b>{name.slice(i, i + q.length)}</b>{name.slice(i + q.length)}</>;
}

/* rows are in display order (yours, shared, guesses); idx is the
 * highlighted row or -1. */
export function SuggestDrop({ rows, idx, q, onPick, here }: {
  rows: SuggestRow[]; idx: number; q: string; onPick: (name: string) => void;
  /* The list being added to: a row on a different list says which one. */
  here?: string;
}) {
  if (!rows.length) return null;
  return (
    <div className="gdrop suggest" id="add-suggest" role="listbox" aria-label={t("lists.suggest.label")}>
      {GROUPS.map(g => {
        const part = rows.filter(r => r.kind === g.kind);
        if (!part.length) return null;
        return (
          <div key={g.kind}>
            <div className="ghead">{t(g.head)}</div>
            {part.map(r => {
              const n = rows.indexOf(r);
              const elsewhere = here !== undefined && r.on !== undefined && (r.on || t("common.everythingElse")) !== here;
              return (
                <div key={r.name} id={"add-sug-" + n} role="option" aria-selected={n === idx}
                  className={"gitem" + (n === idx ? " on" : "") + (r.tag === "On this list" && !elsewhere ? " dim" : "")}
                  onMouseDown={e => e.preventDefault()} onClick={() => onPick(r.name)}>
                  <span className="name"><Bold name={r.name} q={q} /></span>
                  {r.tag ? <span className="tag">{elsewhere ? t("lists.suggest.onNamed", { list: r.on || t("common.everythingElse") }) : r.tag === "On this list" ? t("lists.suggest.onList") : t("lists.suggest.boughtBefore")}</span> : null}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
