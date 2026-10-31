import { useEffect, useRef, useState } from "react";
import { useTranslation } from "../i18n";
import { useToast } from "../ui/Toast";

/* The public developer page at /developers (owner approved the mockup
 * 2026-10-31, after the first one on 2026-10-30): a five-minute
 * quickstart, auth, every endpoint, errors, limits and a changelog. It
 * needs no sign-in, so the app shows it before it asks who you are. The
 * full interactive reference is the spec drawn by Scalar at
 * /developers/reference (a static page, not part of this bundle). Text
 * is docs/API.md in short form. */
export { DEV_PATH, isDevelopersPath } from "../lib/paths";

export const REFERENCE_URL = "https://github.com/vibhortayal/arya/blob/main/docs/API.md";
export const SCHEMA_PATH = "/api/v1/openapi.json";
export const REF_PATH = "/developers/reference";

type Row = readonly [verb: string, path: string, what: string];
/* Group titles and row texts are keys under developers.* in en.json. */
export const GROUPS: { title: string; rows: Row[] }[] = [
  { title: "gLists", rows: [
    ["GET", "/lists", "rLists"], ["GET", "/lists/{id}", "rList"], ["POST", "/lists/{id}/items", "rAdd"],
    ["PATCH", "/items/{id}", "rPatch"], ["DELETE", "/items/{id}", "rDelete"]] },
  { title: "gExport", rows: [
    ["GET", "/lists/{id}/export", "rExport"], ["POST", "/lists/import", "rImport"], ["GET", "/receipts/export", "rReceiptsExport"]] },
  { title: "gReceipts", rows: [
    ["GET", "/receipts", "rReceipts"], ["GET", "/receipts/{id}", "rReceipt"],
    ["GET", "/analysis/spending", "rSpending"], ["GET", "/analysis/purchases", "rPurchases"]] },
];

/* In page order; each is an id on the page and a label under developers.n*. */
export const SECTIONS = ["q", "a", "e", "er", "l", "c", "n"] as const;
const NAV_KEY: Record<(typeof SECTIONS)[number], string> = {
  q: "nQuick", a: "nAuth", e: "nEndpoints", er: "nErrors", l: "nLimits", c: "nChangelog", n: "nNot",
};

const ERRORS: readonly [string, string][] = [
  ["400 bad_request", "eBad"], ["401 unauthorized", "eAuth"], ["404 not_found", "eNotFound"],
  ["413 too_large", "eLarge"], ["429 rate_limited", "eRate"], ["500 internal_error", "eServer"],
];

const LANGS = ["curl", "python", "js"] as const;
type Lang = (typeof LANGS)[number];
const LANG_LABEL: Record<Lang, string> = { curl: "curl", python: "Python", js: "JavaScript" };

/* The try-it command uses the address the page was opened at. */
export const curlLine = (origin: string) =>
  `curl -H "Authorization: Bearer $TOKEN" \\\n  ${origin}/api/v1/lists`;

export const samples = (origin: string): Record<Lang, string> => ({
  curl: curlLine(origin),
  python: `import os, requests\n\nr = requests.get(\n    "${origin}/api/v1/lists",\n    headers={"Authorization": "Bearer " + os.environ["TOKEN"]},\n)\nprint(r.json())`,
  js: `const r = await fetch(\n  "${origin}/api/v1/lists",\n  { headers: { Authorization: \`Bearer \${process.env.TOKEN}\` } }\n);\nconsole.log(await r.json());`,
});

const FIRST_REPLY = `[{"id":"unfiled","name":"Everything else","stores":[],"open_count":1},
 {"id":"l-1a2b3c4d","name":"Costco","stores":["Costco"],"open_count":3}]`;

export const addLine = (origin: string) =>
  `curl -X POST -H "Authorization: Bearer $TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d '{"text":"milk\\neggs x 3"}' \\\n  ${origin}/api/v1/lists/l-1a2b3c4d/items`;

const ADD_REPLY = `{"added":2,"already":0,"also_on":[],"skipped":[],"items":[…]}`;

export function Developers() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [lang, setLang] = useState<Lang>("curl");
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string>("q");
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    document.body.classList.add("dev");
    document.title = t("developers.title");
    return () => document.body.classList.remove("dev");
  }, [t]);
  /* "/" jumps to the search box, as on most docs sites. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (el && /^(input|textarea|select)$/i.test(el.tagName)) return;
      e.preventDefault();
      search.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  /* The side list marks the section on screen. */
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver(entries => {
      for (const e of entries) seen.set(e.target.id, e.isIntersecting);
      const first = SECTIONS.find(id => seen.get(id));
      if (first) setActive(first);
    }, { rootMargin: "0px 0px -60% 0px" });
    SECTIONS.forEach(id => { const el = document.getElementById(id); if (el) io.observe(el); });
    return () => io.disconnect();
  }, []);

  const origin = location.origin;
  const code = samples(origin)[lang];
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast(t("developers.copied")); }
    catch { toast(t("developers.copyFailed")); }
  };

  const q = query.trim().toLowerCase();
  const groups = GROUPS.map(g => ({
    ...g,
    rows: g.rows.filter(([verb, path, what]) =>
      !q || `${verb} ${path} ${t("developers." + what)}`.toLowerCase().includes(q)),
  })).filter(g => g.rows.length);

  return (
    <div className="devpage">
      <header className="devtop">
        <a className="devbrand" href="/">{t("developers.brand")} <span className="devsub">{t("developers.brandSub")}</span></a>
        <label className="devsearch">
          <span aria-hidden="true">⌕</span>
          <input ref={search} type="search" value={query} placeholder={t("developers.search")}
            aria-label={t("developers.search")} onChange={e => setQuery(e.target.value)} />
          <kbd aria-hidden="true">/</kbd>
        </label>
        <nav className="devlinks" aria-label={t("developers.linksLabel")}>
          <a className="devtext" href={REF_PATH}>{t("developers.referenceShort")}</a>
          <a className="devtext" href="#c">{t("developers.nChangelog")}</a>
          <a className="btn secondary" href="/">{t("developers.openApp")}</a>
        </nav>
      </header>

      <div className="devhero">
        <h1 className="herotitle">{t("developers.headline1")}<br />{t("developers.headline2")}</h1>
        <p className="herosub">{t("developers.sub")}</p>
        <div className="devbtns">
          <a className="btn primary devcta" href="/">{t("developers.getCode")}</a>
          <a className="btn secondary devcta" href={REF_PATH}>{t("developers.tryRef")}</a>
        </div>
        <div className="devchips" aria-label={t("developers.onThisPage")}>
          {SECTIONS.slice(0, 6).map(id => (
            <a key={id} className="chip" href={"#" + id}>{t("developers." + NAV_KEY[id])}</a>
          ))}
        </div>
      </div>

      <div className="devwrap">
        <nav className="devnav" aria-label={t("developers.onThisPage")}>
          {SECTIONS.map(id => (
            <a key={id} href={"#" + id} className={active === id ? "on" : ""}
              aria-current={active === id ? "true" : undefined}>{t("developers." + NAV_KEY[id])}</a>
          ))}
        </nav>
        <div className="devmain">
          <section className="devsec" id="q">
            <h2 className="devh">{t("developers.nQuick")}</h2>
            <p className="devlead">{t("developers.quickLead")}</p>
            <h3 className="sect"><span className="devnum">1</span>{t("developers.step1")}</h3>
            <div className="group pad"><p className="nomargin">{t("developers.step1Body")}</p></div>
            <h3 className="sect"><span className="devnum">2</span>{t("developers.step2")}</h3>
            <div className="group pad">
              <div className="devtabs" role="tablist">
                {LANGS.map(l => (
                  <button key={l} type="button" role="tab" aria-selected={lang === l}
                    className={"chip" + (lang === l ? " on" : "")} onClick={() => setLang(l)}>{LANG_LABEL[l]}</button>
                ))}
              </div>
              <pre className="devcode">{code}</pre>
              <div className="devcopy">
                <span className="muted">{t("developers.answersJson")}</span>
                <button type="button" className="btn secondary" onClick={() => copy(code)}>{t("developers.copy")}</button>
              </div>
              <p className="devmini">{t("developers.youGetBack")}</p>
              <pre className="devcode">{FIRST_REPLY}</pre>
            </div>
            <h3 className="sect"><span className="devnum">3</span>{t("developers.step3")}</h3>
            <div className="group pad"><pre className="devcode">{addLine(origin)}</pre></div>
          </section>

          <section className="devsec" id="a">
            <h2 className="devh">{t("developers.nAuth")}</h2>
            <p className="devlead">{t("developers.authLead")}</p>
            <div className="group pad">
              <p className="nomargin">{t("developers.authBody1")} <code>{"Authorization: Bearer YOUR_CODE"}</code> {t("developers.authBody2")}</p>
              <p className="muted" style={{ marginTop: 8 }}>{t("developers.sameCode")}</p>
            </div>
          </section>

          <section className="devsec" id="e">
            <h2 className="devh">{t("developers.nEndpoints")}</h2>
            <p className="devlead">{t("developers.endpointsLead")} <a href={REF_PATH}>{t("developers.openRef")}</a> {t("developers.endpointsLead2")}</p>
            {groups.map(g => (
              <div key={g.title}>
                <h3 className="sect">{t("developers." + g.title)}</h3>
                <div className="group">
                  {g.rows.map(([verb, path, what]) => (
                    <div className="devrow" key={verb + path}>
                      <span className="devverb">{verb}</span>
                      <span className="devpath">{path}</span>
                      <span className="devwhat">{t("developers." + what)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {!groups.length && <div className="group pad"><p className="muted nomargin">{t("developers.noMatch")}</p></div>}
            {!q && (
              <>
                <h3 className="sect">{t("developers.exampleTitle")}</h3>
                <div className="group pad">
                  <pre className="devcode">{addLine(origin)}</pre>
                  <p className="devmini">{t("developers.reply")}</p>
                  <pre className="devcode">{ADD_REPLY}</pre>
                </div>
              </>
            )}
          </section>

          <section className="devsec" id="er">
            <h2 className="devh">{t("developers.nErrors")}</h2>
            <p className="devlead">{t("developers.errorsLead")} <code>{'{"error":{"code","message"}}'}</code></p>
            <div className="group pad">
              <table className="deverr"><tbody>
                {ERRORS.map(([code, why]) => (
                  <tr key={code}><td><code>{code}</code></td><td>{t("developers." + why)}</td></tr>
                ))}
              </tbody></table>
            </div>
          </section>

          <section className="devsec" id="l">
            <h2 className="devh">{t("developers.nLimits")}</h2>
            <div className="group pad">
              <p className="nomargin"><b>{t("developers.limitsHead")}</b> {t("developers.limitsBody")}</p>
              <pre className="devcode" style={{ marginTop: 10 }}>{"HTTP/1.1 429 Too Many Requests\nRetry-After: 312"}</pre>
            </div>
          </section>

          <section className="devsec" id="c">
            <h2 className="devh">{t("developers.nChangelog")}</h2>
            <div className="group pad devlog">
              <p><span className="devver">v1</span><b>{t("developers.log2Date")}</b> {t("developers.log2")}</p>
              <p><span className="devver">v1</span><b>{t("developers.log1Date")}</b> {t("developers.log1")}</p>
              <p className="muted nomargin">{t("developers.stableBody")}</p>
            </div>
          </section>

          <section className="devsec" id="n">
            <h2 className="devh">{t("developers.later")}</h2>
            <div className="group pad"><p className="muted nomargin">{t("developers.laterBody")}</p></div>
          </section>
        </div>
      </div>
      <footer className="devfoot">
        <a href={REF_PATH}>{t("developers.reference")}</a>
        <a href={SCHEMA_PATH}>{t("developers.schema")}</a>
        <a href={REFERENCE_URL} rel="noopener">{t("developers.guide")}</a>
        <a href="/">{t("developers.backToApp")}</a>
      </footer>
    </div>
  );
}
