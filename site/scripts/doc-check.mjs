// Our own coverage check for the generated docs site. Run after `node scripts/sync.mjs`:
//   node scripts/doc-check.mjs [path to a generated/ folder]
// It counts, over the generated pages: headings written as questions, code blocks with a
// language tag, pages with a description, and pages listed in llms.txt. Nothing is fetched.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const gen = path.resolve(process.argv[2] || path.join(here, '..', 'generated'));
const walk = (d) => fs.readdirSync(d, {withFileTypes: true}).flatMap((e) =>
  e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.md') ? [path.join(d, e.name)] : []);
const pages = walk(path.join(gen, 'docs'));
let headings = 0, questions = 0, fences = 0, tagged = 0, described = 0;
for (const f of pages) {
  const t = fs.readFileSync(f, 'utf8');
  if (/^description:/m.test(t.split(/^---$/m)[1] || '')) described++;
  let open = false;
  for (const l of t.split('\n')) {
    if (l.startsWith('```')) { if (!open && l.length > 3) tagged++; if (!open) fences++; open = !open; continue; }
    if (open) continue;
    const h = l.match(/^#{2,3}\s+(.*)/);
    if (h) { headings++; if (/\?/.test(h[1])) questions++; }
  }
}
const idx = path.join(gen, 'static', 'llms.txt');
const listed = fs.existsSync(idx) ? (fs.readFileSync(idx, 'utf8').match(/^- \[/gm) || []).length : 0;
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 100);
console.log(`pages: ${pages.length}`);
console.log(`question headings (h2/h3): ${questions}/${headings} (${pct(questions, headings)}%)`);
console.log(`code blocks with a language: ${tagged}/${fences} (${pct(tagged, fences)}%)`);
console.log(`pages with a description: ${described}/${pages.length} (${pct(described, pages.length)}%)`);
console.log(`pages listed in llms.txt: ${listed}/${pages.length}; llms-full.txt present: ${fs.existsSync(path.join(gen, 'static', 'llms-full.txt'))}`);
