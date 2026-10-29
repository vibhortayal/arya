"""Where the front end's source lives, for the tests that pin it.

The app is the React app in web/ (served at /). Its screens are
web/src/screens/*.tsx, shared pieces web/src/ui and web/src/app, and
the stylesheets web/src/styles/*.css (moved unchanged from the
plain-JS app). The static folder pwa/ keeps only what the app loads at
runtime: scene.js, three.js, images, store models, the manifest and
icons. The plain-JS app itself is archived on the branch
archive/plain-js-app (tag plain-js-app).

Behaviour that a string pin cannot show is checked by the vitest
tests beside the code (web/src/**/*.test.ts) and by the browser tests
in web/e2e/*.e2e.mjs.
"""
import glob
import os

ASSISTANT = os.path.normpath(os.path.join(os.path.dirname(__file__), ".."))
WEB = os.path.join(ASSISTANT, "web")
SRC = os.path.join(WEB, "src")
STYLES = os.path.join(SRC, "styles")
STATIC = os.path.join(ASSISTANT, "pwa")


def _read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def path(name):
    """A front-end file by its old pwa/ name: a stylesheet resolves to
    web/src/styles, anything else to the static folder."""
    if name.endswith(".css"):
        return os.path.join(STYLES, name)
    return os.path.join(STATIC, name)


def read(name):
    return _read(path(name))


def src(rel):
    """A file under web/src, e.g. src("screens/Hunt.tsx")."""
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
    a thing exists (or does not) somewhere in it."""
    files = sorted(glob.glob(os.path.join(SRC, "**", "*.ts"), recursive=True)
                   + glob.glob(os.path.join(SRC, "**", "*.tsx"), recursive=True))
    files = [f for f in files if ".test." not in f]
    return "\n".join([_read(os.path.join(WEB, "index.html"))] + [_read(f) for f in files])
