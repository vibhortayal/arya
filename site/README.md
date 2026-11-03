# Arya docs site

A small static docs site (Docusaurus 3) built from the Markdown already in this repo. Nothing is copied into git: `scripts/sync.mjs` reads the files at build time, so the site cannot drift from the repo.

It publishes: `README.md`, `JUDGES.md`, `docs/TRY-THE-FEATURES.md`, `assistant/docs/USER-JOURNEYS.md`, `docs/API.md`, and an interactive reference for the Lists API (`static/openapi.json`). It deliberately leaves out OPS, STATUS and the internal docs. To add a page, add one line to `SECTIONS` in `scripts/sync.mjs`. Any reader-facing page needs an Editor PASS first.

Styling is Arya's own tokens (colours, font stack, 14 px radius) copied into `src/custom.css`, light mode only, desktop web. If the app's tokens in `assistant/web/src/styles/styles.css` change, update that file.

## Preview

```
cd site
npm install
npm run build
npm run serve        # http://localhost:3000
```

## Publish to GitHub Pages (no GitHub Actions)

The site is served from the `gh-pages` branch ("Deploy from a branch" in the repo's Pages settings). URL: https://vibhortayal.github.io/arya/

```
cd site
DOCS_BASE_URL=/arya/ DOCS_URL=https://vibhortayal.github.io npm run build
cd build && touch .nojekyll
git init -b gh-pages && git add -A && git commit -m "Publish docs"
git push -f https://github.com/vibhortayal/arya.git gh-pages
```

Run it from a clean checkout of main. Nothing in the app, the VM or a deploy is touched. Refresh the API spec with `npm run spec` (needs the Python deps in `assistant/api/requirements.txt`).
