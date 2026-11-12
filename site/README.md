# Arya docs site

A small static docs site (Docusaurus 3) built from the Markdown already in this repo. Nothing is copied into git: `scripts/sync.mjs` reads the files at build time, so the site cannot drift from the repo.

The list of published pages, their order and their sidebar sections is `SECTIONS` in `scripts/sync.mjs` (the one place to edit), plus an interactive reference for the Lists API (`static/openapi.json`). It deliberately leaves out OPS, STATUS and the internal docs; pages that link to those get a GitHub link instead. The repository's own index of every document is `docs/README.md`. To add a page, add one line to `SECTIONS`. Any reader-facing page needs an Editor PASS first.

Styling is Arya's own tokens (colours, font stack, 14 px radius) copied into `src/custom.css`, light mode only, desktop web. If the app's tokens in `assistant/web/src/styles/styles.css` change, update that file.

## Preview

```
cd site
npm install
npm run build
npm run serve        # http://localhost:3000
```

## Publish to GitHub Pages (no GitHub Actions)

The site is served from the `gh-pages` branch ("Deploy from a branch" in the repo's Pages settings). URL: https://docs.arya.teamnightshift.org/ (the old https://vibhortayal.github.io/arya/ address redirects to it).

```
cd site
DOCS_BASE_URL=/ DOCS_URL=https://docs.arya.teamnightshift.org npm run build
cd build && touch .nojekyll && echo docs.arya.teamnightshift.org > CNAME
git init -b gh-pages && git add -A && git commit -m "Publish docs"
git push -f https://github.com/vibhortayal/arya.git gh-pages
```

The `CNAME` file keeps the custom domain set; a publish without it switches the domain off. Run it from a clean checkout of main. Nothing in the app, the VM or a deploy is touched. Refresh the API spec with `npm run spec` (needs the Python deps in `assistant/api/requirements.txt`).
