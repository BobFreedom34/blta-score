// The "Info" window of the home page (public/js/about.js): five tabs (About us, Rules, Categories, League dates, Tournaments). Every city
// writes its own texts in Backend > Info (Slovak and English, a title and a formatted text per tab). Bratislava (league 1) shows the texts that
// came with the site (public/js/i18n.js) for a tab it has not edited; another city shows only the tabs it has written, and none when it has
// written nothing (the button is then not shown).
const db = require('./db');
const rules = require('./rules');

const TABS = ['us', 'rules', 'cats', 'dates', 'tour'];
const LANGS = ['sk', 'en'];

db.exec(`
  CREATE TABLE IF NOT EXISTS about_sections (
    league_id INTEGER NOT NULL,
    tab TEXT NOT NULL,
    lang TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    html TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (league_id, tab, lang)
  );
`);

// { us: { sk: { title, html }, en: { … } }, … } — only what the city has saved
function forCity(leagueId) {
  const out = {};
  db.prepare('SELECT * FROM about_sections WHERE league_id = ?').all(leagueId).forEach((r) => {
    if (!out[r.tab]) out[r.tab] = {};
    out[r.tab][r.lang] = { title: r.title, html: r.html };
  });
  return out;
}

// -> { error } or { saved: true }; body = { sk: { title, html }, en: { title, html } }
function save(leagueId, tab, body) {
  if (!TABS.includes(tab)) return { error: 'Unknown tab' };
  const clean = {};
  for (const lang of LANGS) {
    const v = (body || {})[lang] || {};
    const title = typeof v.title === 'string' ? v.title.replace(/\s+/g, ' ').trim() : '';
    if (title.length > 120) return { error: 'The title is too long (max 120 characters)' };
    const raw = typeof v.html === 'string' ? v.html : '';
    if (raw.length > 60000) return { error: 'The text is too long' };
    clean[lang] = { title, html: rules.sanitize(raw).trim() };
  }
  const put = db.prepare(`
    INSERT INTO about_sections (league_id, tab, lang, title, html) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(league_id, tab, lang) DO UPDATE SET title = excluded.title, html = excluded.html
  `);
  LANGS.forEach((lang) => put.run(leagueId, tab, lang, clean[lang].title, clean[lang].html));
  return { saved: true };
}

function remove(leagueId, tab) {
  return db.prepare('DELETE FROM about_sections WHERE league_id = ? AND tab = ?').run(leagueId, tab).changes > 0;
}

module.exports = { TABS, forCity, save, remove };
