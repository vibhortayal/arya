import { useReducer } from "react";
import { useNav } from "../app/nav";
import { Row, Empty } from "../ui/kit";
import { qtyFmt } from "../lib/format";
import { packExtrasOf, packSessionItem, type NewListDraft } from "./NewList";
import { Trans, useTranslation } from "../i18n";

/* Port of pwa/index.html #view-optimize and quest.js renderOptimize /
 * the #opt-body click handlers / qOptProceed. The draft (old Q.draft)
 * arrives in nav.params.draft and is edited in place, as the old app
 * did, so Back from the next screen keeps the answers.
 * fastMode: the old qOptProceed created the session at once; here the
 * draft goes on to "mode" with draft.fastMode still set (as NewList
 * does), and the mode screen creates the session at once. */

const norm = (s: unknown) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/* Skipped questions are remembered and asked again at the next plan. */
const ASK_LATER = "arya-ask-later";
function askLaterLoad(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(ASK_LATER) || "[]")); } catch { return new Set(); }
}
function askLaterSave(s: Set<string>) {
  try { localStorage.setItem(ASK_LATER, JSON.stringify([...s])); } catch { /* not fatal */ }
}

export function Optimize() {
  const { t } = useTranslation();
  const nav = useNav();
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const D = nav.params.draft as NewListDraft | undefined;
  const rep = D && D.opt && D.opt.report;
  if (!D || !rep) {
    return (
      <>
        <p><a href="#" className="qback" onClick={ev => { ev.preventDefault(); nav.back(); }}>{t("common.back")}</a></p>
        <h2 className="largetitle" style={{ fontSize: 28 }}>{t("optimize.checkTheList")}</h2>
        <div className="group"><Empty>{t("optimize.nothingToCheckYet")}</Empty></div>
      </>
    );
  }

  const parts = [t("optimize.sum.in", { n: rep.in })];
  if (rep.merged.length) parts.push(t("optimize.sum.merged", { n: rep.merged.length }));
  if (rep.corrected.length) parts.push(t("optimize.sum.corrected", { n: rep.corrected.length }));
  if (rep.questions.length) parts.push(t("optimize.sum.toAsk", { n: rep.questions.length }));
  if (rep.unresolved.length) parts.push(t("optimize.sum.kept", { n: rep.unresolved.length }));

  const seenQ = new Set<string>();
  const questions = rep.questions.filter((q: any) => !seenQ.has(q.item) && seenQ.add(q.item));
  const pending = questions.filter((q: any) => !D.answers[q.item]).length;

  const undo = (ci: number) => {
    const c = rep.corrected[ci];
    const item = D.baseItems.find(i => i.name === c.to && !i._undone);
    if (item) {
      item.name = c.from;
      item.group = "name:" + norm(c.from);
      item._undone = true;
    }
    D.undone[ci] = true;
    bump();
  };
  const redo = (ci: number) => {
    const c = rep.corrected[ci];
    const item = D.baseItems.find(i => i._undone && i.name === c.from);
    const orig = D.opt.items.find((i: any) => i.name === c.to);
    if (item && orig) {
      item.name = orig.name;
      item.group = orig.group;
      delete item._undone;
    }
    delete D.undone[ci];
    bump();
  };

  const proceed = () => {
    const items = D.baseItems.map(i => packSessionItem(i));
    const withExtras = (it: any, name: string) => packSessionItem(it, packExtrasOf(D.raw, name));
    const seen = new Set<string>();
    const later = askLaterLoad();
    for (const q of rep.questions) {
      if (seen.has(q.item)) continue;
      seen.add(q.item);
      // Unanswered = kept as typed (never guessed); asked again next plan.
      const ans = String(D.answers[q.item] || "typed");
      if (D.answers[q.item]) later.delete(norm(q.item)); else later.add(norm(q.item));
      const qty = (D.qQty && D.qQty[norm(q.item)]) || 1;
      if (ans === "both") {
        q.candidates.forEach((c: any) => items.push(withExtras({ name: c.name, qty }, q.item)));
      } else if (ans === "typed") {
        items.push(withExtras({ name: q.item, qty, group: "name:" + norm(q.item) }, q.item));
      } else if (ans.startsWith("cand:")) {
        items.push(withExtras({ name: ans.slice(5), qty }, q.item));
      }
    }
    askLaterSave(later);
    D.finalItems = items;
    nav.show("mode", { draft: D });
  };

  const hasBody = rep.merged.length || rep.corrected.length || questions.length || rep.unresolved.length;

  return (
    <>
      <p><a href="#" className="qback" onClick={ev => { ev.preventDefault(); nav.back(); }}>{t("common.back")}</a></p>
      <h2 className="largetitle" style={{ fontSize: 28 }}>{t("optimize.checkTheList")}</h2>
      <p id="opt-summary" className="subtitle">{parts.join(" · ")}</p>
      <div id="opt-body">
        {rep.merged.length > 0 && (
          <>
            <h3 className="sect">{t("optimize.merged")}</h3>
            <div className="group">
              {rep.merged.map((m: any, i: number) => (
                <Row key={i} name={m.name} sub={t("optimize.addedAs", { names: m.from.join(", ") })} right={`× ${qtyFmt(m.qty)}`} />
              ))}
            </div>
          </>
        )}
        {rep.corrected.length > 0 && (
          <>
            <h3 className="sect">{t("optimize.corrected")}</h3>
            <div className="group">
              {rep.corrected.map((c: any, ci: number) => {
                const kept = !!D.undone[ci];
                return (
                  <div key={ci} className={"row optrow" + (kept ? " kept" : "")}>
                    <div className="grow">
                      <span className="name"><span className="opt-from">{c.from}</span> → <span className="opt-to">{c.to}</span></span>
                      <span className="sub">{kept ? t("optimize.keptAsYouTyped") : t("optimize.matched")}</span>
                    </div>
                    <button className="chip" type="button" {...(kept ? { "data-redo": ci } : { "data-undo": ci })}
                      onClick={() => (kept ? redo(ci) : undo(ci))}>{kept ? t("optimize.useMatch") : t("common.undo")}</button>
                  </div>
                );
              })}
            </div>
          </>
        )}
        {questions.length > 0 && (
          <>
            <h3 className="sect">{t("optimize.oneChoiceEach")}</h3>
            {questions.map((q: any) => {
              const ans = D.answers[q.item] as string | undefined;
              const chip = (val: string, label: string) => (
                <button key={val} className="chip" data-q={q.item} data-ans={val} aria-pressed={ans === val} type="button"
                  onClick={() => { D.answers[q.item] = val; bump(); }}>{label}</button>
              );
              // A swap (a candidate or Both) strikes the typed word and shows
              // what replaces it; Keep as typed highlights without a strike.
              const swapped = !!ans && ans !== "typed";
              const pick = !swapped ? "" : ans === "both" ? t("optimize.both") : ans!.slice(5);
              return (
                <div key={q.item} className="group pad optq">
                  <p className="nomargin">
                    {swapped
                      ? <><span className="opt-from">{q.item}</span> → <strong>{pick}</strong></>
                      : <Trans i18nKey="optimize.whichOne" values={{ item: q.item }} components={{ b: <strong /> }} />}
                  </p>
                  <div className={"actions optchips" + (ans ? " has-pick" : "")} style={{ paddingBottom: 0 }}>
                    {q.candidates.map((c: any) => chip("cand:" + c.name, c.name))}
                    {chip("both", t("optimize.both"))}
                    {chip("typed", t("optimize.keepAsTyped"))}
                  </div>
                  {ans ? <button className="opt-undo" data-qundo={q.item} type="button"
                    onClick={() => { delete D.answers[q.item]; bump(); }}>{t("common.undo")}</button> : null}
                </div>
              );
            })}
          </>
        )}
        {rep.unresolved.length > 0 && (
          <>
            <h3 className="sect">{t("optimize.keptAsTyped")}</h3>
            <div className="group">
              {rep.unresolved.map((u: string, i: number) => (
                <Row key={i} name={u} sub={t("optimize.notInYourDictionaryIt")} />
              ))}
            </div>
          </>
        )}
        {!hasBody && <div className="group"><Empty>{t("optimize.cleanListNothingToMerge")}</Empty></div>}
      </div>
      <p className="muted nomargin">{t("optimize.optional")}{" "}<a href="#" id="opt-race" onClick={ev => { ev.preventDefault(); nav.show("race"); }}>{t("optimize.raceAFriendOnThis")}</a>.</p>
      <p><button id="opt-next" className="btn primary wide" type="button" onClick={proceed}>{t("optimize.looksRight")}</button></p>
      <p><button id="opt-skip" className="btn secondary wide" type="button" hidden={pending === 0} onClick={proceed}>{t("optimize.skipForNowKeepThe")}</button></p>
    </>
  );
}
