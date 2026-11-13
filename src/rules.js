// The text of the public "Propozície" page (/propozicie): a list of sections (a title and a formatted body each), edited in
// Backend > Rules (/rules-admin). The first text is the propozície taken from blta.sk (src/rulesSeed.js).
//
// The page is built on the server, so search engines read the text. The bodies carry the page's own pieces (tiles, tables,
// the category cards) as plain HTML with the page's classes; saving keeps only a small set of tags and classes.
const db = require('./db');
const seed = require('./rulesSeed');
const seedEn = require('./rulesSeedEn');

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

// every section belongs to one city (the rules of Bratislava are the first; see src/leagues.js)
if (!db.prepare('PRAGMA table_info(rules_sections)').all().some((c) => c.name === 'league_id')) db.exec('ALTER TABLE rules_sections ADD COLUMN league_id INTEGER NOT NULL DEFAULT 1');
db.exec('CREATE INDEX IF NOT EXISTS idx_rules_sections_league ON rules_sections(league_id)');
// the English text of a section (empty = the page shows the Slovak one in English too)
['title_en', 'nav_label_en', 'body_en'].forEach((col) => {
  if (!db.prepare('PRAGMA table_info(rules_sections)').all().some((c) => c.name === col)) db.exec(`ALTER TABLE rules_sections ADD COLUMN ${col} TEXT NOT NULL DEFAULT ''`);
});

// Once: the first sections (after that the backend owns them, even when all are deleted).
if (!db.prepare("SELECT 1 FROM app_flags WHERE key = 'rules_seeded'").get()) {
  const insert = db.prepare('INSERT OR IGNORE INTO rules_sections (slug, nav_label, title, body_html, sort_order) VALUES (?, ?, ?, ?, ?)');
  seed.forEach((s, i) => insert.run(s.slug, s.navLabel, s.title, s.body, i));
  db.prepare("INSERT OR IGNORE INTO app_flags (key) VALUES ('rules_seeded')").run();
}

// Once: the part "Obhajoba bodov" of Bodovanie is rewritten as the defence of the points really works now (src/rulesDefenceText.js). The old text is found by its
// heading and replaced up to the end of the section; a section that does not have it any more (the admin wrote it differently) is left as it is.
if (!db.prepare("SELECT 1 FROM app_flags WHERE key = 'rules_defence_text_2026'").get()) {
  const text = require('./rulesDefenceText');
  db.prepare("SELECT id, body_html, body_en FROM rules_sections WHERE slug = 'bodovanie'").all().forEach((row) => {
    const swap = (body, mark, fresh) => {
      const i = body ? body.indexOf(mark) : -1;
      return i < 0 ? null : body.slice(0, i) + fresh;
    };
    const sk = swap(row.body_html, text.MARK_SK, text.SK);
    const en = swap(row.body_en, text.MARK_EN, text.EN);
    if (sk !== null) db.prepare('UPDATE rules_sections SET body_html = ? WHERE id = ?').run(sk, row.id);
    if (en !== null) db.prepare('UPDATE rules_sections SET body_en = ? WHERE id = ?').run(en, row.id);
  });
  db.prepare("INSERT OR IGNORE INTO app_flags (key) VALUES ('rules_defence_text_2026')").run();
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
  return {
    id: r.id, slug: r.slug, navLabel: r.nav_label, title: r.title, html: r.body_html, navLabelEn: r.nav_label_en || '', titleEn: r.title_en || '', htmlEn: r.body_en || '',
    original: seed.some((s) => s.slug === r.slug),
  };
}

function list(leagueId = 1) {
  return db.prepare('SELECT * FROM rules_sections WHERE league_id = ? ORDER BY sort_order, id').all(leagueId).map(serialize);
}
const leagueOf = (id) => { const r = db.prepare('SELECT league_id FROM rules_sections WHERE id = ?').get(Number(id)); return r ? r.league_id : null; };

function slugify(text) {
  return String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sekcia';
}

function uniqueSlug(base) {
  let slug = base;
  let n = 2;
  while (db.prepare('SELECT 1 FROM rules_sections WHERE slug = ?').get(slug)) { slug = `${base}-${n}`; n += 1; }
  return slug;
}

// The first English text for the sections that still have the first Slovak text (a section the backend changed keeps what it has: the page then shows its Slovak text in
// English too, until the English one is written in Backend > Rules). Never replaces an English text that is written.
function fillEnglish() {
  const set = {
    title: db.prepare("UPDATE rules_sections SET title_en = ? WHERE id = ? AND title_en = ''"),
    nav: db.prepare("UPDATE rules_sections SET nav_label_en = ? WHERE id = ? AND nav_label_en = ''"),
    body: db.prepare("UPDATE rules_sections SET body_en = ? WHERE id = ? AND body_en = ''"),
  };
  db.prepare('SELECT id, slug, title, nav_label, body_html FROM rules_sections').all().forEach((r) => {
    const first = seed.find((s) => s.slug === r.slug);
    const en = seedEn[r.slug];
    if (!first || !en) return;
    if (r.title === first.title) set.title.run(en.title, r.id);
    if (r.nav_label === first.navLabel && en.navLabel) set.nav.run(en.navLabel, r.id);
    if (r.body_html === first.body || r.body_html === sanitize(first.body)) set.body.run(en.body, r.id);
  });
}
fillEnglish();

// the addresses inside a text (href="/harmonogram") go to the page in the language of the text (and the city's base address)
function localizeLinks(html, lang, pageUrl, base) {
  if (typeof pageUrl !== 'function') return html;
  return html.replace(/href="(\/[^"#?]*)([^"]*)"/g, (whole, p, tail) => `href="${base}${pageUrl(p, lang)}${tail}"`);
}

// The pills at the top and a card per section, ready to go into the page, in the language of the page (English: the English text of a section, the Slovak one where it has none).
function renderHtml(leagueId = 1, { lang = 'sk', pageUrl, base = '' } = {}) {
  const en = lang === 'en';
  const rows = db.prepare('SELECT * FROM rules_sections WHERE league_id = ? ORDER BY sort_order, id').all(leagueId).map((r) => ({
    slug: r.slug,
    // (a section with no button in Slovak has none in English either)
    nav: !r.nav_label ? '' : (en && r.nav_label_en) || r.nav_label,
    title: (en && r.title_en) || r.title,
    body: localizeLinks((en && r.body_en) || r.body_html, lang, pageUrl, base),
  }));
  if (!rows.length) return '';
  const pills = rows.filter((r) => r.nav).map((r) => `<a class="tab" href="#${esc(r.slug)}">${esc(r.nav)}</a>`).join('\n    ');
  const nav = pills ? `<div class="tabs pr-nav" role="navigation" aria-label="${en ? 'Sections' : 'Sekcie'}">\n    ${pills}\n  </div>\n` : '';
  const sections = rows.map((r) => `
  <section class="pr-sec" id="${esc(r.slug)}">
    <h2 class="pr-title">${esc(r.title)}</h2>
    <div class="pr-card">${r.body}</div>
  </section>`).join('');
  return nav + sections;
}

function injectInto(html, leagueId = 1, options = {}) {
  return html.replace('<!--RULES-->', () => renderHtml(leagueId, options));
}

module.exports = { list, leagueOf, sanitize, serialize, slugify, uniqueSlug, injectInto, renderHtml, seed, seedEn };
