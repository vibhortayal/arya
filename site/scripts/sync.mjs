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
const quest = (name) => questPages().find(([s]) => s === `docs/quest/${name}.md`);
const SECTIONS = {
  'Start here': [
    ['README.md#what-is-arya', 'intro', 'What is Arya'],
    ['JUDGES.md', 'judges', 'For judges'],
    ['docs/quest/JUDGE-PLAYBOOK.md', 'quest/judge-playbook', '8-minute demo path'],
    ['docs/WHAT-WE-BUILT.md', 'what-we-built', 'Built in the hackathon window'],
    ['docs/PRINCIPLES.md', 'principles', 'Why Arya exists'],
  ],
  'Using Arya': [
    ['assistant/docs/USER-JOURNEYS.md', 'guide/user-journeys', 'User journeys'],
    [...quest('README').slice(0, 2), 'Quest overview'],
    [...quest('GAME-DESIGN').slice(0, 2), 'Quest game design'],
    [...quest('MAP-MY-STORE').slice(0, 2), 'Map my store'],
    ['assistant/docs/AGENT-CONNECTOR.md', 'guide/agent-connector', 'Use Arya in Muse'],
    ['assistant/docs/MULTILINGUAL-ASK.md', 'guide/multilingual-ask', 'Ask in your language'],
    ['docs/GLOSSARY.md', 'glossary', 'Glossary'],
  ],
  'How it is built': [
    ['docs/TECHNICAL-DEPTH.md', 'architecture/design-decisions', 'Design decisions and what is next'],
    ['assistant/docs/ARCHITECTURE.md', 'architecture/overview', 'Architecture'],
    ['docs/SCALABILITY-DESIGN.md', 'architecture/scalability', 'Scalability design'],
    ['assistant/docs/MODEL-POLICY.md', 'architecture/model-policy', 'Model policy'],
    ['docs/ENGINEERING-PROCESS.md', 'internal/index', 'How we built it'],
  ],
  'Evidence': [
    ['docs/evals/README.md', 'evals/index', 'Overview'],
    ['docs/evals/GATE-0-REPORT.md', 'evals/gate-0', 'Gate 0 report'],
    ['docs/evals/WONDER-EVAL.md', 'evals/wonder-eval', 'Wonder eval'],
    ['docs/evals/JUDGE-EVAL.md', 'evals/judge-eval', 'Staple judge eval'],
  ],
  'Developers': [
    ['docs/RUN-IT-YOURSELF.md', 'run-it-yourself', 'Run it yourself'],
    ['docs/TRY-THE-FEATURES.md', 'try-the-features', 'Tour of your own copy'],
    ['docs/API.md', 'api/lists-api', 'Lists API v1'],
  ],
  'After the hackathon': [
    ['docs/ROADMAP.md', 'roadmap', 'Roadmap'],
  ],
};
// Everything else (README, spec, ops, status, agent rules, submission drafts, the
// decision log and the other design notes) stays in the repository only; pages on
// the site link to those files on GitHub.
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
    // 'FILE#heading-slug' takes one level-2 section of FILE (one owner for the text).
    const [file, secSlug] = src.split('#');
    let text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    if (secSlug) {
      const lines = text.split('\n');
      const slug = (l) => l.replace(/^#+\s*/, '').toLowerCase().replace(/[^a-z0-9 -]/g, '').trim().replace(/\s+/g, '-');
      const i = lines.findIndex((l) => /^##\s/.test(l) && slug(l) === secSlug);
      if (i < 0) throw new Error(`section ${secSlug} not found in ${file}`);
      let j = i + 1;
      while (j < lines.length && !/^##\s/.test(lines[j])) j++;
      text = lines.slice(i, j).map((l) => (/^#{2,3}\s/.test(l) ? l.slice(1) : l)).join('\n') + '\n';
    }
    if (SCRUBBED.has(src)) {
      text = scrub(src, text);
      if (LEAK.test(text)) throw new Error(`sensitive text left in ${src}: ${text.match(LEAK)[0]}`);
    }
    text = text.replace(/(\]\()([^)\s]+)(\))/g, (_, a, t, c) => a + rewrite(t, file, !IMG.test(t.split('#')[0]) ) + c);
    text = text.replace(/\b(src|href)="([^"]+)"/g, (_, k, t) => `${k}="${rewrite(t, file)}"`);
    const fm = `---\nsidebar_label: ${JSON.stringify(label)}\nsidebar_position: ${++order}\n` +
      `custom_edit_url: ${GH.replace('blob', 'edit')}${src}\n---\n\n`;
    const dst = path.join(OUT, 'docs', `${route}.md`);
    fs.mkdirSync(path.dirname(dst), {recursive: true});
    fs.writeFileSync(dst, fm + text);
  }
}
fs.writeFileSync(path.join(OUT, 'sections.json'), JSON.stringify(
  Object.fromEntries(Object.entries(SECTIONS).map(([k, v]) => [k, v.map((i) => `${i[1]}`)]))));
fs.writeFileSync(path.join(OUT, 'scrub-report.txt'), Object.entries(counts).map(([k, v]) => `${k} x${v}`).join('\n') + '\n');
console.log(`synced ${routeBySrc.size} docs, ${copied.size} images`);
