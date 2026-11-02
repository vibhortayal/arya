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
const QUEST_INTERNAL = new Set(['BUILD-PLAN.md', 'DISCUSSION.md', 'SUBMISSION.md', 'PITCH.md']);
const questPages = () => fs.readdirSync(path.join(ROOT, 'docs/quest'))
  .filter((f) => f.endsWith('.md') && !QUEST_INTERNAL.has(f))
  .map((f) => [`docs/quest/${f}`, `quest/${f === 'README.md' ? 'overview' : f.replace(/\.md$/, '').toLowerCase()}`,
    f.replace(/\.md$/, '').replace(/-/g, ' ')]);

// [source path in repo, route inside the docs site, sidebar label]
const SECTIONS = {
  'Start here': [
    ['README.md', 'intro', 'What Arya is'],
    ['JUDGES.md', 'judges', 'For judges'],
    ['docs/PRINCIPLES.md', 'principles', 'Principles and goals'],
    ['docs/GLOSSARY.md', 'glossary', 'Glossary'],
    ['docs/TRY-THE-FEATURES.md', 'try-the-features', 'Try the features'],
    ['docs/WHAT-WE-BUILT.md', 'what-we-built', 'What we built'],
    ['docs/RUN-IT-YOURSELF.md', 'run-it-yourself', 'Run it yourself'],
  ],
  'User guide': [
    ['assistant/docs/USER-JOURNEYS.md', 'guide/user-journeys', 'User journeys'],
    ['assistant/docs/AGENT-CONNECTOR.md', 'guide/agent-connector', 'Use Arya in Muse'],
    ['assistant/docs/MULTILINGUAL-ASK.md', 'guide/multilingual-ask', 'Ask in your language'],
    ['assistant/docs/PUSH-REMINDERS.md', 'guide/push-reminders', 'Reminders'],
    ['assistant/docs/SIGNIN.md', 'guide/signin', 'Sign-in'],
    ['assistant/docs/DEMO.md', 'guide/demo', 'The demo'],
    ['assistant/docs/DEMO-TOWN.md', 'guide/demo-town', 'Demo Town'],
  ],
  'Product': [
    ['PRODUCT.md', 'product', 'Product'],
    ['docs/ROADMAP.md', 'roadmap', 'Roadmap'],
    ...questPages().filter(([s]) => !/ARCHITECTURE|META-PRODUCTS/.test(s)),
  ],
  'How it is built': [
    ['assistant/docs/ARCHITECTURE.md', 'architecture/overview', 'Architecture'],
    ['assistant/docs/SPEC.md', 'architecture/spec', 'Spec'],
    ['assistant/docs/IMPLEMENTATION.md', 'architecture/implementation', 'Implementation'],
    ['assistant/docs/MODEL-POLICY.md', 'architecture/model-policy', 'Model policy'],
    ['docs/MODELS.md', 'architecture/models', 'Models'],
    ['docs/quest/ARCHITECTURE.md', 'architecture/quest', 'Quest architecture'],
    ['docs/quest/META-PRODUCTS.md', 'architecture/meta-products', 'Meta products'],
  ],
  'Evals': [
    ['docs/evals/README.md', 'evals/index', 'Overview'],
    ['docs/evals/JUDGE-EVAL.md', 'evals/judge-eval', 'Staple judge eval'],
    ['docs/evals/WONDER-EVAL.md', 'evals/wonder-eval', 'Wonder eval'],
    ['docs/evals/GATE-0-REPORT.md', 'evals/gate-0', 'Gate 0 report'],
  ],
  'API': [['docs/API.md', 'api/lists-api', 'Lists API v1']],
};
const ENG = 'Engineering process: how we built Arya';
SECTIONS[ENG] = [
  ['docs/ENGINEERING-PROCESS.md', 'internal/index', 'Overview'],
  ['AGENTS.md', 'internal/agents', 'Agent rules'],
  ['STATUS.md', 'internal/status', 'Status'],
  ['assistant/docs/OPS.md', 'internal/ops', 'Operations'],
  ['assistant/docs/SCALE-SIM.md', 'internal/scale-sim', 'Scale simulation'],
  ['assistant/docs/SUBMISSION-DRAFT.md', 'internal/submission-draft', 'Submission draft'],
  ['docs/quest/BUILD-PLAN.md', 'quest/build-plan', 'Quest build plan'],
  ['docs/quest/DISCUSSION.md', 'quest/discussion', 'Quest design discussion'],
  ['docs/quest/SUBMISSION.md', 'quest/submission', 'Submission checklist'],
  ['docs/DECISIONS.md', 'internal/decisions', 'Decisions'],
  ['docs/quest/PITCH.md', 'internal/pitch', 'Early pitch'],
];
const SCRUBBED = new Set(['AGENTS.md', 'STATUS.md', 'assistant/docs/OPS.md', 'assistant/docs/SCALE-SIM.md',
  'assistant/docs/SUBMISSION-DRAFT.md', 'docs/quest/BUILD-PLAN.md', 'docs/quest/DISCUSSION.md', 'docs/quest/SUBMISSION.md', 'docs/DECISIONS.md', 'docs/quest/PITCH.md']);

// Whole sections that are operator-only and stay off the public site.
const DROP_SECTIONS = {
  'assistant/docs/OPS.md': ['One-time setup on the VM', 'Recover the owner', 'When something breaks'],
  'AGENTS.md': ['Ops notes'],
};
const NOTE = '_Operator-only steps are kept off the public site. See the repository._\n\n';
const REDACT = [
  [/\/home\/[\w./-]+/g, '[server path]'],
  [/\/mnt\/[\w./-]+/g, '[internal file]'],
  [/\/var\/log\/[\w./-]+/g, '[log file]'],
  [/`?(?:assistant\/)?deploy\/\.env`?/g, 'the server settings file'],
  [/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[address]'],
];
const WHOLE = { 'assistant/docs/OPS.md': ['Own Meta keys'] };   // heading and body both go
const counts = {};
function scrub(src, text) {
  for (const title of WHOLE[src] || []) {
    const lines = text.split('\n');
    const i = lines.findIndex((l) => /^#{2,4}\s/.test(l) && l.replace(/^#+\s*/, '').startsWith(title));
    if (i < 0) continue;
    const level = lines[i].match(/^#+/)[0].length;
    let j = i + 1;
    while (j < lines.length && !(/^#+\s/.test(lines[j]) && lines[j].match(/^#+/)[0].length <= level)) j++;
    lines.splice(i, j - i);
    counts[`${src}: section "${title}" (whole)`] = 1;
    text = lines.join('\n');
  }
  for (const title of DROP_SECTIONS[src] || []) {
    const lines = text.split('\n');
    const i = lines.findIndex((l) => /^#{2,4}\s/.test(l) && l.replace(/^#+\s*/, '').startsWith(title));
    if (i < 0) continue;
    const level = lines[i].match(/^#+/)[0].length;
    let j = i + 1;
    while (j < lines.length && !(/^#+\s/.test(lines[j]) && lines[j].match(/^#+/)[0].length <= level)) j++;
    lines.splice(i + 1, j - i - 1, '', NOTE);
    counts[`${src}: section "${title}"`] = 1;
    text = lines.join('\n');
  }
  for (const [re, to] of REDACT) {
    text = text.replace(re, () => { counts[`${src}: ${to}`] = (counts[`${src}: ${to}`] || 0) + 1; return to; });
  }
  return text;
}
// Guard: nothing like these may survive in a published internal page.
const LEAK = /(\/home\/|\/mnt\/|ssh |\bpasswd\b|accounts\.json|tester-[abc]\b|BEGIN [A-Z ]*KEY|\b\d{1,3}(\.\d{1,3}){3}\b)/;

const routeBySrc = new Map();
for (const items of Object.values(SECTIONS)) {
  for (const [src, route] of items) routeBySrc.set(src, route);
}

fs.rmSync(OUT, {recursive: true, force: true});
fs.mkdirSync(path.join(OUT, 'docs'), {recursive: true});
fs.mkdirSync(path.join(OUT, 'static'), {recursive: true});

const copied = new Set();
// Markdown images are resolved by Docusaurus against static/ and get the base
// path added for them, so they must NOT carry it; raw HTML src/href must.
function copyAsset(rel, withBase = true) {
  if (!copied.has(rel)) {
    const dst = path.join(OUT, 'static', 'repo', rel);
    fs.mkdirSync(path.dirname(dst), {recursive: true});
    fs.copyFileSync(path.join(ROOT, rel), dst);
    copied.add(rel);
  }
  return `${withBase ? BASE : '/'}repo/${rel}`;
}

function rewrite(target, fromSrc, withBase = true) {
  if (/^([a-z][a-z0-9+.-]*:|#|\/\/|mailto:)/i.test(target)) return target;
  const [p, hash = ''] = target.split('#');
  if (!p) return target;
  const rel = path.posix.normalize(path.posix.join(path.posix.dirname(fromSrc), decodeURI(p)));
  if (rel.startsWith('..')) return target;
  const h = hash ? `#${hash}` : '';
  if (routeBySrc.has(rel)) return `${BASE}docs/${routeBySrc.get(rel)}${h}`;
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return target;
  if (IMG.test(rel)) return copyAsset(rel, withBase);
  return fs.statSync(abs).isDirectory()
    ? `${GH.replace('/blob/', '/tree/')}${rel}${h}` : `${GH}${rel}${h}`;
}

let order = 0;
for (const [section, items] of Object.entries(SECTIONS)) {
  for (const [src, route, label] of items) {
    let text = fs.readFileSync(path.join(ROOT, src), 'utf8');
    if (SCRUBBED.has(src)) {
      text = scrub(src, text);
      if (LEAK.test(text)) throw new Error(`sensitive text left in ${src}: ${text.match(LEAK)[0]}`);
    }
    text = text.replace(/(\]\()([^)\s]+)(\))/g, (_, a, t, c) => a + rewrite(t, src, !IMG.test(t.split('#')[0]) ) + c);
    text = text.replace(/\b(src|href)="([^"]+)"/g, (_, k, t) => `${k}="${rewrite(t, src)}"`);
    // Tab title = sidebar label; pages that open with an HTML <h1> keep it and hide the generated one.
    const hide = /^\s*<h1/m.test(text.slice(0, 400)) ? 'hide_title: true\n' : '';
    const fm = `---\ntitle: ${JSON.stringify(label)}\n${hide}sidebar_label: ${JSON.stringify(label)}\nsidebar_position: ${++order}\n` +
      `custom_edit_url: ${GH}${src}\n---\n\n`;
    const dst = path.join(OUT, 'docs', `${route}.md`);
    fs.mkdirSync(path.dirname(dst), {recursive: true});
    fs.writeFileSync(dst, fm + text);
  }
}
fs.writeFileSync(path.join(OUT, 'sections.json'), JSON.stringify(
  Object.fromEntries(Object.entries(SECTIONS).map(([k, v]) => [k, v.map((i) => `${i[1]}`)]))));
fs.writeFileSync(path.join(OUT, 'scrub-report.txt'), Object.entries(counts).map(([k, v]) => `${k} x${v}`).join('\n') + '\n');
console.log(`synced ${routeBySrc.size} docs, ${copied.size} images`);
