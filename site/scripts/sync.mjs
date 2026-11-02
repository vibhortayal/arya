// Builds site/generated/ from the Markdown that already lives in the repo.
// Nothing here is committed: the repo files stay the single source of truth,
// so the site cannot drift. Run by `npm run build` / `npm start`.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(SITE, '..');
const OUT = path.join(SITE, 'generated');
const BASE = (process.env.DOCS_BASE_URL || '/').replace(/\/?$/, '/');
const GH = 'https://github.com/vibhortayal/arya/blob/main/';
const IMG = /\.(png|jpe?g|webp|svg|gif)$/i;

// [source path in repo, route inside the docs site, sidebar label]
const SECTIONS = {
  'Start here': [
    ['README.md', 'intro', 'What Arya is'],
    ['JUDGES.md', 'judges', 'For judges'],
    ['PRODUCT.md', 'product', 'Product'],
    ['STATUS.md', 'status', 'Status'],
  ],
  'Architecture': [
    ['assistant/docs/ARCHITECTURE.md', 'architecture/overview', 'Architecture'],
    ['assistant/docs/SPEC.md', 'architecture/spec', 'Spec'],
    ['assistant/docs/MODEL-POLICY.md', 'architecture/model-policy', 'Model policy'],
    ['assistant/docs/IMPLEMENTATION.md', 'architecture/implementation', 'Implementation'],
    ['assistant/docs/SCALE-SIM.md', 'architecture/scale-sim', 'Scale simulation'],
  ],
  'Guides': [
    ['assistant/docs/USER-JOURNEYS.md', 'guides/user-journeys', 'User journeys'],
    ['assistant/docs/AGENT-CONNECTOR.md', 'guides/agent-connector', 'Use Arya in Muse'],
    ['assistant/docs/MULTILINGUAL-ASK.md', 'guides/multilingual-ask', 'Multilingual Ask'],
    ['assistant/docs/PUSH-REMINDERS.md', 'guides/push-reminders', 'Reminders'],
    ['assistant/docs/SIGNIN.md', 'guides/signin', 'Sign-in'],
    ['assistant/docs/DEMO.md', 'guides/demo', 'Demo'],
    ['assistant/docs/DEMO-TOWN.md', 'guides/demo-town', 'Demo Town'],
    ['assistant/docs/OPS.md', 'guides/ops', 'Operations'],
  ],
  'API': [['docs/API.md', 'api/lists-api', 'Lists API v1']],
  'Evals': [
    ['docs/evals/README.md', 'evals/index', 'Overview'],
    ['docs/evals/JUDGE-EVAL.md', 'evals/judge-eval', 'Staple judge eval'],
    ['docs/evals/WONDER-EVAL.md', 'evals/wonder-eval', 'Wonder eval'],
    ['docs/evals/GATE-0-REPORT.md', 'evals/gate-0', 'Gate 0 report'],
  ],
  'Quest': fs.readdirSync(path.join(ROOT, 'docs/quest'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => [`docs/quest/${f}`, `quest/${f.replace(/\.md$/, '').toLowerCase()}`,
      f.replace(/\.md$/, '').replace(/-/g, ' ')]),
};

const routeBySrc = new Map();
for (const items of Object.values(SECTIONS)) {
  for (const [src, route] of items) routeBySrc.set(src, route);
}

fs.rmSync(OUT, {recursive: true, force: true});
fs.mkdirSync(path.join(OUT, 'docs'), {recursive: true});
fs.mkdirSync(path.join(OUT, 'static'), {recursive: true});

const copied = new Set();
function copyAsset(rel) {
  if (!copied.has(rel)) {
    const dst = path.join(OUT, 'static', 'repo', rel);
    fs.mkdirSync(path.dirname(dst), {recursive: true});
    fs.copyFileSync(path.join(ROOT, rel), dst);
    copied.add(rel);
  }
  return `${BASE}repo/${rel}`;
}

function rewrite(target, fromSrc) {
  if (/^([a-z][a-z0-9+.-]*:|#|\/\/|mailto:)/i.test(target)) return target;
  const [p, hash = ''] = target.split('#');
  if (!p) return target;
  const rel = path.posix.normalize(path.posix.join(path.posix.dirname(fromSrc), decodeURI(p)));
  if (rel.startsWith('..')) return target;
  const h = hash ? `#${hash}` : '';
  if (routeBySrc.has(rel)) return `${BASE}docs/${routeBySrc.get(rel)}${h}`;
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return target;
  if (IMG.test(rel)) return copyAsset(rel);
  return fs.statSync(abs).isDirectory()
    ? `${GH.replace('/blob/', '/tree/')}${rel}${h}` : `${GH}${rel}${h}`;
}

let order = 0;
for (const [section, items] of Object.entries(SECTIONS)) {
  for (const [src, route, label] of items) {
    let text = fs.readFileSync(path.join(ROOT, src), 'utf8');
    text = text.replace(/(\]\()([^)\s]+)(\))/g, (_, a, t, c) => a + rewrite(t, src) + c);
    text = text.replace(/\b(src|href)="([^"]+)"/g, (_, k, t) => `${k}="${rewrite(t, src)}"`);
    const fm = `---\nsidebar_label: ${JSON.stringify(label)}\nsidebar_position: ${++order}\n` +
      `custom_edit_url: ${GH.replace('blob', 'edit')}${src}\n---\n\n`;
    const dst = path.join(OUT, 'docs', `${route}.md`);
    fs.mkdirSync(path.dirname(dst), {recursive: true});
    fs.writeFileSync(dst, fm + text);
  }
}
fs.writeFileSync(path.join(OUT, 'sections.json'), JSON.stringify(
  Object.fromEntries(Object.entries(SECTIONS).map(([k, v]) => [k, v.map((i) => `${i[1]}`)]))));
console.log(`synced ${routeBySrc.size} docs, ${copied.size} images`);
