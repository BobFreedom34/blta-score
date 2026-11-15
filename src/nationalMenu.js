// The menu in the header of the national site (slta.sk and its rankings page), written in Backend > Footer > National site > Menu: a list of links,
// each with a Slovak and an English text and a target (a page of the site by its code address, or an address of your own: https://…, /path or #part).
// Until it is saved the built-in menu below is used. The page is rendered on the server, so the links are in the HTML that search engines read.
const db = require('./db');
const seo = require('./seo');
const footerSettings = require('./footerSettings');

db.exec(`CREATE TABLE IF NOT EXISTS national_menu (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL);`);

const MAX_ITEMS = 10;
const URL_OK = /^(https?:\/\/[^\s<>"']+|mailto:[^\s<>"']+|tel:[^\s<>"']+|#[A-Za-z0-9_-]+|\/(?!\/)[^\s<>"']*)$/;
const text = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const BUILT_IN = [
  { sk: 'Mestá', en: 'Cities', url: '#mesta' },
  { sk: 'Rebríčky', en: 'Rankings', page: '/slta-rankings' },
  { sk: 'Funkcie', en: 'Features', url: '#funkcie' },
  { sk: 'Ako to funguje', en: 'How it works', url: '#ako' },
  { sk: 'Otázky', en: 'Questions', url: '#otazky' },
  { sk: 'Organizátori', en: 'Organisers', url: '#organizator' },
];

let cache;
function get() {
  if (cache === undefined) {
    const row = db.prepare('SELECT value FROM national_menu WHERE id = 1').get();
    let saved = null;
    try { saved = row ? JSON.parse(row.value) : null; } catch { saved = null; }
    cache = Array.isArray(saved) ? saved : null;
  }
  return cache;
}

// -> { error } or the saved items. `items` is what the editor sends; everything is cleaned here
function set(items) {
  if (!Array.isArray(items) || items.length > MAX_ITEMS) return { error: `At most ${MAX_ITEMS} items in the menu` };
  const codes = new Set(footerSettings.pageCodes().map((p) => p.code));
  const out = [];
  for (const it of items) {
    const sk = text(it && it.sk, 40);
    const en = text(it && it.en, 40) || sk;
    if (!sk && !(it && (it.page || it.url))) continue; // an empty row is dropped
    if (!sk) return { error: 'Every menu item needs a text' };
    if (it.page) {
      if (!codes.has(it.page)) return { error: `"${sk}" points at a page that does not exist` };
      out.push({ sk, en, page: it.page });
    } else {
      const url = text(it.url, 300);
      if (!URL_OK.test(url)) return { error: `The address of "${sk}" must be a page, a link starting with https://, a path starting with / or #…` };
      out.push({ sk, en, url });
    }
  }
  db.prepare('INSERT INTO national_menu (id, value) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value').run(JSON.stringify(out));
  cache = out;
  return out;
}

function reset() {
  db.prepare('DELETE FROM national_menu WHERE id = 1').run();
  cache = null;
}

// the <nav> of the header in `lang`; `current` = the code address of the page that is shown (its item is marked)
function html(lang, current) {
  const items = get() || BUILT_IN;
  const home = seo.pageUrl('/', lang);
  const links = items.map((it) => {
    const href = it.page ? seo.pageUrl(it.page, lang) : it.url.charAt(0) === '#' ? `${home}${it.url}` : it.url;
    const attrs = it.page === '/slta-rankings' ? ' data-nav="rank"' : '';
    const on = it.page && it.page === current ? ' class="on"' : '';
    return `<a href="${esc(href)}"${attrs}${on}>${esc(lang === 'en' ? it.en : it.sk)}</a>`;
  });
  return `<nav class="nav-links" id="nav-links">${links.join('')}</nav>`;
}

module.exports = { BUILT_IN, MAX_ITEMS, get, set, reset, html };
