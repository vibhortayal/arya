import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import en from "./en.json";
import i18n, { i18nLanguage } from "./index";

/* The rule (web/PORTING.md): no literal English in components; use
 * t("key") and add the string to en.json. This test reads every .tsx
 * file under src/screens and src/ui and fails on a JSX text node with
 * two or more letters. It also fails on a literal t("key") or
 * <Trans i18nKey="key"> whose key is missing from en.json.
 *
 * ALLOWED holds the only JSX texts that may stay as they are, each
 * with its file. Keep it small: a brand or a person's name, or sample
 * data that a screen shows as data. Anything a shopper reads as a
 * sentence or a label goes to en.json. */
const ALLOWED: Record<string, string[]> = {
  // The brand on the sign-in screen.
  "screens/Login.tsx": ["Arya"],
  // The author's name on About.
  "screens/About.tsx": ["Vibhor Tayal"],
};

const ROOT = resolve(process.cwd(), "src");
const DIRS = ["screens", "ui"];

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsxFiles(p));
    else if (p.endsWith(".tsx") && !p.endsWith(".test.tsx")) out.push(p);
  }
  return out;
}

// Entities such as &times; or &lsaquo; are symbols, not words.
const letters = (s: string) => (s.replace(/&#?\w+;/g, "").match(/\p{L}/gu) || []).length;

type Hit = { file: string; line: number; text: string };

function scan(file: string) {
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const texts: Hit[] = [];
  const keys: Hit[] = [];
  const rel = relative(ROOT, file).split("\\").join("/");
  const at = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const visit = (n: ts.Node) => {
    if (ts.isJsxText(n)) {
      const text = n.text.replace(/\s+/g, " ").trim();
      if (letters(text) >= 2) texts.push({ file: rel, line: at(n), text });
    }
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "t"
      && n.arguments.length && ts.isStringLiteral(n.arguments[0])) {
      keys.push({ file: rel, line: at(n), text: n.arguments[0].text });
    }
    if (ts.isJsxAttribute(n) && n.name.getText(sf) === "i18nKey" && n.initializer && ts.isStringLiteral(n.initializer)) {
      keys.push({ file: rel, line: at(n), text: n.initializer.text });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { texts, keys };
}

function hasKey(key: string) {
  let d: unknown = en;
  const parts = key.split(".");
  for (const p of parts.slice(0, -1)) {
    if (!d || typeof d !== "object") return false;
    d = (d as Record<string, unknown>)[p];
  }
  if (!d || typeof d !== "object") return false;
  const last = parts[parts.length - 1];
  const o = d as Record<string, unknown>;
  return typeof o[last] === "string" || typeof o[last + "_other"] === "string";
}

const files = DIRS.flatMap(d => tsxFiles(join(ROOT, d)));
const results = files.map(scan);

describe("i18n: no literal English in components", () => {
  test("the scan sees the screens and the ui", () => {
    expect(files.length).toBeGreaterThan(40);
  });

  test("no JSX text with two or more letters outside the allowlist", () => {
    const bad = results.flatMap(r => r.texts).filter(h => !(ALLOWED[h.file] || []).includes(h.text));
    expect(bad.map(h => `${h.file}:${h.line} ${JSON.stringify(h.text)}`)).toEqual([]);
  });

  test("every allowlisted text is still in its file", () => {
    const seen = new Set(results.flatMap(r => r.texts).map(h => h.file + "\0" + h.text));
    const stale = Object.entries(ALLOWED).flatMap(([f, ts]) => ts.filter(x => !seen.has(f + "\0" + x)).map(x => `${f} ${x}`));
    expect(stale).toEqual([]);
  });

  test("every literal key exists in en.json", () => {
    const missing = results.flatMap(r => r.keys).filter(h => !hasKey(h.text));
    expect(missing.map(h => `${h.file}:${h.line} ${h.text}`)).toEqual([]);
  });
});

describe("i18n setup", () => {
  test("English is loaded, with plurals and interpolation", () => {
    expect(i18n.t("common.itemCount", { count: 1 })).toBe("1 item");
    expect(i18n.t("common.itemCount", { count: 3 })).toBe("3 items");
    expect(i18n.t("common.couldNotLoad", { error: "<x>" })).toBe("Could not load: <x>");
  });

  test("the language setting maps to an i18n language, English when unknown", () => {
    expect(i18nLanguage("auto", "es-MX")).toBe("es");
    expect(i18nLanguage("auto", "")).toBe("en");
    expect(i18nLanguage("fr")).toBe("fr");
    expect(i18nLanguage("")).toBe("en");
  });

  test("a language with no strings yet falls back to English", async () => {
    await i18n.changeLanguage("fr");
    try { expect(i18n.t("tabs.today")).toBe("Today"); }
    finally { await i18n.changeLanguage("en"); }
  });
});
