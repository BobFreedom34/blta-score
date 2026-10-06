// The text of the public "Propozície" page (/propozicie): a list of sections (a title and a formatted body each), edited in
// Backend > Rules (/rules-admin). The first text is the propozície taken from blta.sk (src/rulesSeed.js).
//
// The page is built on the server, so search engines read the text. The bodies carry the page's own pieces (tiles, tables,
// the category cards) as plain HTML with the page's classes; saving keeps only a small set of tags and classes.
const db = require('./db');
const seed = require('./rulesSeed');

db.exec(`
  CREATE TABLE IF NOT EXISTS rules_sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    nav_label TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL,
    body_html TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0
  );
`);

// Once: the first sections (after that the backend owns them, even when all are deleted).
if (!db.prepare("SELECT 1 FROM app_flags WHERE key = 'rules_seeded'").get()) {
  const insert = db.prepare('INSERT OR IGNORE INTO rules_sections (slug, nav_label, title, body_html, sort_order) VALUES (?, ?, ?, ?, ?)');
  seed.forEach((s, i) => insert.run(s.slug, s.navLabel, s.title, s.body, i));
  db.prepare("INSERT OR IGNORE INTO app_flags (key) VALUES ('rules_seeded')").run();
}

const TAGS = {
  p: 'p', div: 'div', span: 'span', br: 'br', strong: 'strong', b: 'strong', em: 'em', i: 'em', u: 'u', small: 'small',
  ul: 'ul', ol: 'ol', li: 'li', h3: 'h3', h4: 'h3', a: 'a',
  table: 'table', thead: 'thead', tbody: 'tbody', tr: 'tr', th: 'th', td: 'td',
};
const CLASS_OK = /^(pr-[a-z-]+|win|bad|yes|no|elite|nextgen|novice|num)$/;

function escapeText(text) {
  return text.replace(/&(?![a-zA-Z]+;|#\d+;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Keeps the tags above, only the page's own classes and http(s) / mailto / site links; everything else is dropped and the text
// is escaped — so what is stored is safe to show on the public page as it is.
function sanitize(input) {
  const html = String(input || '');
  const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s[^<>]*)?)>/g;
  const open = [];
  let out = '';
  let last = 0;
  let m;
  while ((m = tag.exec(html))) {
    out += escapeText(html.slice(last, m.index));
    last = tag.lastIndex;
    const name = TAGS[m[2].toLowerCase()];
    if (!name) continue;
    if (name === 'br') { out += '<br>'; continue; }
    if (m[1] === '/') {
      if (open.includes(name)) {
        let top;
        do { top = open.pop(); out += `</${top}>`; } while (top !== name);
      }
      continue;
    }
    let attrs = '';
    const cls = m[3].match(/class\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    if (cls) {
      const keep = (cls[1] !== undefined ? cls[1] : cls[2]).split(/\s+/).filter((c) => CLASS_OK.test(c));
      if (keep.length) attrs += ` class="${keep.join(' ')}"`;
    }
    if (name === 'a') {
      const href = m[3].match(/href\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      const url = href ? (href[1] !== undefined ? href[1] : href[2]).trim() : '';
      if (/^(https?:\/\/|mailto:|\/(?!\/)|#)/i.test(url)) {
        const safe = url.replace(/&(?![a-zA-Z]+;|#\d+;)/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
        attrs += /^https?:/i.test(url) ? ` href="${safe}" target="_blank" rel="noopener"` : ` href="${safe}"`;
      }
    }
    out += `<${name}${attrs}>`;
    open.push(name);
  }
  out += escapeText(html.slice(last));
  while (open.length) out += `</${open.pop()}>`;
  return out;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function serialize(r) {
  return { id: r.id, slug: r.slug, navLabel: r.nav_label, title: r.title, html: r.body_html, original: seed.some((s) => s.slug === r.slug) };
}

function list() {
  return db.prepare('SELECT * FROM rules_sections ORDER BY sort_order, id').all().map(serialize);
}

function slugify(text) {
  return String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sekcia';
}

function uniqueSlug(base) {
  let slug = base;
  let n = 2;
  while (db.prepare('SELECT 1 FROM rules_sections WHERE slug = ?').get(slug)) { slug = `${base}-${n}`; n += 1; }
  return slug;
}

// The pills at the top and a card per section, ready to go into the page.
function renderHtml() {
  const rows = db.prepare('SELECT * FROM rules_sections ORDER BY sort_order, id').all();
  if (!rows.length) return '';
  const pills = rows.filter((r) => r.nav_label).map((r) => `<a class="tab" href="#${esc(r.slug)}">${esc(r.nav_label)}</a>`).join('\n    ');
  const nav = pills ? `<div class="tabs pr-nav" role="navigation" aria-label="Sekcie">\n    ${pills}\n  </div>\n` : '';
  const sections = rows.map((r) => `
  <section class="pr-sec" id="${esc(r.slug)}">
    <h2 class="pr-title">${esc(r.title)}</h2>
    <div class="pr-card">${r.body_html}</div>
  </section>`).join('');
  return nav + sections;
}

function injectInto(html) {
  return html.replace('<!--RULES-->', () => renderHtml());
}

module.exports = { list, sanitize, serialize, slugify, uniqueSlug, injectInto, seed };
