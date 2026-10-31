import { useState, type FormEvent } from "react";
import { useBackHandler, useNav } from "../app/nav";
import { HELP_TOPICS, type HelpTopic } from "../guide/helpTopics";
import { useTranslation } from "../i18n";
import { useGuide } from "../ui/Guide";
import { useTour } from "../ui/Tour";
import { FIRST_RUN_TOUR } from "../onboarding/firstRunTour";
import { Chip, Group, Section } from "../ui/kit";
import "./help.css";

/* The Help tab (owner pick A, 2026-10-31; mockup PmHxJbYVus8evkxaYP8KEN):
 * an ask box, three first steps, then a topic for each part of the app.
 * A topic is one idea in numbered steps with the real button names, a
 * few things to know, a button that opens the feature, and "Still
 * stuck? Ask Arya", which opens Ask with the question already sent.
 * Ask Arya answers how-to questions from the same facts. */
export function Help() {
  const { t } = useTranslation();
  const nav = useNav();
  const guide = useGuide();
  const tour = useTour();
  const [open, setOpen] = useState<HelpTopic | null>(null);
  const [q, setQ] = useState("");

  // Back closes a topic first, then leaves Help as every tab does.
  useBackHandler(() => { if (!open) return false; setOpen(null); return true; }, !!open);

  const ask = (text: string) => { const s = text.trim(); if (s) nav.show("chat", { ask: s }); };
  const submit = (ev: FormEvent) => { ev.preventDefault(); ask(q); };
  const key = (id: string, k: string) => `help.topics.${id}.${k}`;

  if (open) {
    const id = open.id;
    return (
      <>
        <button className="linkbtn help-back" id="help-back" type="button" onClick={() => setOpen(null)}>
          <span aria-hidden="true">‹ </span>{t("help.back")}</button>
        <h1 className="largetitle">{t(key(id, "title"))}</h1>
        <p className="muted help-body">{t(key(id, "body"))}</p>
        <ol className="steps">
          {Array.from({ length: open.steps }, (_, i) => <li key={i}><span>{t(key(id, "s" + (i + 1)))}</span></li>)}
        </ol>
        {open.notes > 0 && (
          <Section title={t("help.goodToKnow")}>
            <Group>
              {Array.from({ length: open.notes }, (_, i) => (
                <div className="row" key={i}><div className="grow"><span className="sub help-note">{t(key(id, "n" + (i + 1)))}</span></div></div>
              ))}
            </Group>
          </Section>
        )}
        <div className="help-actions">
          <button className="btn primary" id="help-open" type="button" onClick={() => nav.show(open.opens)}>{t(key(id, "cta"))}</button>
          <button className="btn" id="help-stuck" type="button"
            onClick={() => ask(t("help.stuckQ", { topic: t(key(id, "title")) }))}>{t("help.stuck")}</button>
        </div>
      </>
    );
  }

  const row = (tp: HelpTopic) => (
    <button className="navrow" type="button" key={tp.id} data-topic={tp.id} onClick={() => { setOpen(tp); window.scrollTo(0, 0); }}>
      <span className="grow">{t(key(tp.id, "title"))}<span className="sub">{t(key(tp.id, "sub"))}</span></span><span className="chev">›</span></button>
  );
  const samples = [t("help.sample1"), t("help.sample2"), t("help.sample3")];

  return (
    <>
      <h1 className="largetitle">{t("help.title")}</h1>
      <p className="muted help-intro">{t("help.intro")}</p>
      <form className="help-ask" id="help-ask" onSubmit={submit}>
        <input type="text" id="help-q" value={q} maxLength={200} placeholder={t("help.askPlaceholder")} aria-label={t("help.askLabel")}
          onChange={e => setQ(e.target.value)} />
        <button type="submit" className="btn primary" disabled={!q.trim()}>{t("help.ask")}</button>
      </form>
      <div className="help-chips">
        {samples.map(s => <Chip key={s} onClick={() => ask(s)}>{s}</Chip>)}
      </div>
      <Section title={t("help.startHere")}><Group>{HELP_TOPICS.filter(x => x.group === "start").map(row)}</Group></Section>
      <Section title={t("help.howTo")}><Group>{HELP_TOPICS.filter(x => x.group === "how").map(row)}</Group></Section>
      <Section title={t("help.more")}>
        <Group>
          <button className="navrow" id="help-guide" type="button" onClick={() => guide.open()}>
            <span className="grow">{t("help.guide")}<span className="sub">{t("help.guideSub")}</span></span><span className="chev">›</span></button>
          <button className="navrow" id="help-powers" type="button" onClick={() => nav.show("powers")}>
            <span className="grow">{t("help.powers")}<span className="sub">{t("help.powersSub")}</span></span><span className="chev">›</span></button>
          <button className="navrow" id="help-tour" type="button" onClick={() => tour.startTour(FIRST_RUN_TOUR)}>
            <span className="grow">{t("help.tour")}<span className="sub">{t("help.tourSub")}</span></span><span className="chev">›</span></button>
          <button className="navrow" id="help-feedback" type="button" onClick={() => nav.show("feedback")}>
            <span className="grow">{t("help.feedback")}<span className="sub">{t("help.feedbackSub")}</span></span><span className="chev">›</span></button>
        </Group>
      </Section>
    </>
  );
}
