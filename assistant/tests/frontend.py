"""Where the front end's source lives, for the tests that pin it.

The app is the React app in web/ (served at /). Its screens are
web/src/screens/*.tsx, shared pieces web/src/ui and web/src/app, and
the stylesheets web/src/styles/*.css (moved unchanged from the
plain-JS app). The static folder pwa/ keeps only what the app loads at
runtime: scene.js, three.js, images, store models, the manifest and
icons. The plain-JS app itself stays in git history: the tag
plain-js-app, and every main commit before the React-at-root merge
(the last one is 80bd79d, with #151 and #152).

Behaviour that a string pin cannot show is checked by the vitest
tests beside the code (web/src/**/*.test.ts) and by the browser tests
in web/e2e/*.e2e.mjs.
"""
import glob
import json
import os
import re

ASSISTANT = os.path.normpath(os.path.join(os.path.dirname(__file__), ".."))
WEB = os.path.join(ASSISTANT, "web")
SRC = os.path.join(WEB, "src")
STYLES = os.path.join(SRC, "styles")
STATIC = os.path.join(ASSISTANT, "pwa")


def _read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


# The app's words live in web/src/i18n/en.json; components call
# t("key") (web/PORTING.md rule 8). A pin on a screen's words reads
# them from en.json: src() and app() hand back the source with each
# literal t("key", ...) and <Trans i18nKey="key" .../> replaced by its
# English text, so a pin sees the words the screen shows. {{name}}
# placeholders stay as they are in en.json.
EN_JSON = os.path.join(SRC, "i18n", "en.json")
_en_cache = []


def en():
    """en.json as a dict."""
    if not _en_cache:
        with open(EN_JSON, encoding="utf-8") as fh:
            _en_cache.append(json.load(fh))
    return _en_cache[0]


def words(key):
    """The English text for an en.json key (a plural key gives its
    _other form), or None."""
    d = en()
    parts = key.split(".")
    for p in parts[:-1]:
        d = d.get(p) if isinstance(d, dict) else None
        if d is None:
            return None
    if not isinstance(d, dict):
        return None
    v = d.get(parts[-1], d.get(parts[-1] + "_other"))
    return v if isinstance(v, str) else None


_T_CALL = re.compile(r'(?<![\w.$])t\(\s*"([\w.]+)"')
_TRANS = re.compile(r'<Trans\s+i18nKey="([\w.]+)"')
_KEY_LITERAL = re.compile(r'"([A-Za-z]\w*(?:\.\w+)+)"')


def _call_end(text, i):
    """The index just past the ) that closes the ( at text[i]."""
    depth, q = 0, None
    while i < len(text):
        c = text[i]
        if q:
            if c == "\\":
                i += 1
            elif c == q:
                q = None
        elif c in "\"'`":
            q = c
        elif c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return -1


def _trans(text):
    """Each <Trans i18nKey="k" ... /> gains its English words in front;
    the tag stays, so its components (a button, a link) stay pinnable."""
    out, pos = [], 0
    for m in _TRANS.finditer(text):
        if m.start() < pos:
            continue
        depth, i = 0, m.end()
        while i < len(text):
            c = text[i]
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
            elif depth == 0 and text.startswith("/>", i):
                break
            i += 1
        val = words(m.group(1))
        if val is None or i >= len(text):
            continue
        out.append(text[pos:m.start()] + val + text[m.start():i + 2])
        pos = i + 2
    out.append(text[pos:])
    return "".join(out)


def english(text):
    """The source with literal t("key") calls and <Trans> read from en.json."""
    text = _trans(text)
    out, pos = [], 0
    for m in _T_CALL.finditer(text):
        if m.start() < pos:
            continue
        val = words(m.group(1))
        end = _call_end(text, m.start() + 1)
        if val is None or end < 0:
            continue
        start = m.start()
        before = text[pos:start]
        if before.endswith("={") and text[end:end + 1] == "}":
            # aria-label={t("k")} reads as aria-label="words"
            out.append(before[:-1] + json.dumps(val, ensure_ascii=False))
            end += 1
        elif before.endswith("{") and text[end:end + 1] == "}":
            # a JSX child {t("k")} reads as its words
            out.append(before[:-1] + val)
            end += 1
        else:
            out.append(before + json.dumps(val, ensure_ascii=False))
        pos = end
    out.append(text[pos:])
    # A table of keys (tab names, states, the (i) texts) reads as its words.
    return _KEY_LITERAL.sub(lambda m: json.dumps(words(m.group(1)), ensure_ascii=False)
                            if words(m.group(1)) is not None else m.group(0), "".join(out))


def path(name):
    """A front-end file by its old pwa/ name: a stylesheet resolves to
    web/src/styles, anything else to the static folder."""
    if name.endswith(".css"):
        return os.path.join(STYLES, name)
    return os.path.join(STATIC, name)


def read(name):
    return _read(path(name))


def src(rel):
    """A file under web/src, e.g. src("screens/Hunt.tsx"), with its
    t("key") calls read from en.json (see english())."""
    text = _read(os.path.join(SRC, rel))
    return english(text) if rel.endswith((".ts", ".tsx")) else text


def src_raw(rel):
    """A file under web/src as it is on disk (t("key") calls kept)."""
    return _read(os.path.join(SRC, rel))


def css():
    """Every stylesheet, joined (the old app loaded all of them)."""
    return "\n".join(_read(p) for p in sorted(glob.glob(os.path.join(STYLES, "*.css"))))


def index_html():
    """web/index.html, the page Vite builds the shell from."""
    return _read(os.path.join(WEB, "index.html"))


def app():
    """Every non-test source file under web/src, joined, plus
    web/index.html: the whole app as one text, for pins that only say
    a thing exists (or does not) somewhere in it. t("key") calls read
    from en.json (see english()), and en.json itself is part of the
    text, for words kept as keys in a table."""
    files = sorted(glob.glob(os.path.join(SRC, "**", "*.ts"), recursive=True)
                   + glob.glob(os.path.join(SRC, "**", "*.tsx"), recursive=True))
    files = [f for f in files if ".test." not in f]
    return "\n".join([_read(os.path.join(WEB, "index.html"))] + [english(_read(f)) for f in files]
                      + [_read(EN_JSON)])
