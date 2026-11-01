// What Backend > Footer saves for the footer of a city (league id) or of the national site (scope 0): the description, the contact and social links, the groups
// of links, whether the row of cities shows, and a line of small print. Whatever is left empty (or null for the groups) is the built-in text of src/footer.js.
const db = require('./db');
const seo = require('./seo');

db.exec(`
  CREATE TABLE IF NOT EXISTS footer_settings (
    scope INTEGER PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const NATIONAL = 0;
const MAX_GROUPS = 6;
const MAX_LINKS = 12;
const CONTACT_URLS = ['instagramUrl', 'facebookUrl', 'youtubeUrl', 'whatsappUrl'];

// the pages a link can point at by their code address (their public address follows Backend > SEO): the ones with a fixed address
const pageCodes = () => seo.PAGES.filter((p) => !p.template && !p.noindex).map((p) => ({ code: p.path, label: p.label.replace(/\s*\([^)]*\)\s*/g, ' ').trim() }));

const EMPTY = () => ({ desc: { sk: '', en: '' }, contact: { address: '', email: '', instagramUrl: '', facebookUrl: '', youtubeUrl: '', whatsappUrl: '' }, groups: null, showCities: true, hiddenCities: [], contactHidden: [], legal: { sk: '', en: '' } });

const cache = new Map();
function get(scope) {
  if (!cache.has(scope)) {
    const row = db.prepare('SELECT value FROM footer_settings WHERE scope = ?').get(scope);
    let saved = {};
    try { saved = row ? JSON.parse(row.value) : {}; } catch { saved = {}; }
    cache.set(scope, { ...EMPTY(), ...saved, desc: { ...EMPTY().desc, ...(saved.desc || {}) }, contact: { ...EMPTY().contact, ...(saved.contact || {}) }, legal: { ...EMPTY().legal, ...(saved.legal || {}) } });
  }
  return cache.get(scope);
}

const text = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const URL_OK = /^(https?:\/\/[^\s<>"']+|mailto:[^\s<>"']+|tel:[^\s<>"']+|#[A-Za-z0-9_-]+|\/(?!\/)[^\s<>"']*)$/;

// -> { error } or the saved values. `body` is what the editor sends; everything is cleaned here, nothing is trusted
function set(scope, body) {
  const b = body || {};
  const out = EMPTY();
  out.desc = { sk: text((b.desc || {}).sk, 400), en: text((b.desc || {}).en, 400) };
  out.legal = { sk: text((b.legal || {}).sk, 200), en: text((b.legal || {}).en, 200) };
  const c = b.contact || {};
  out.contact.address = typeof c.address === 'string' ? c.address.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean).join('\n').slice(0, 300) : '';
  out.contact.email = text(c.email, 120);
  if (out.contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.contact.email)) return { error: 'The e-mail address is not valid' };
  for (const key of CONTACT_URLS) {
    out.contact[key] = text(c[key], 300);
    if (out.contact[key] && !/^https?:\/\/\S+$/i.test(out.contact[key])) return { error: 'A social link must start with https://' };
  }
  out.showCities = b.showCities !== false;
  // a part of the contact that is not shown at all (an empty field would use the built-in one)
  const hideable = ['address', 'email', ...CONTACT_URLS];
  out.contactHidden = Array.isArray(b.contactHidden) ? [...new Set(b.contactHidden.filter((k) => hideable.includes(k)))] : [];
  // the cities (by their address slug, 'slta' = the national site) that are left out of the row
  if (b.hiddenCities !== undefined && !(Array.isArray(b.hiddenCities) && b.hiddenCities.length <= 100 && b.hiddenCities.every((c) => typeof c === 'string' && /^[a-z0-9-]{1,60}$/.test(c)))) return { error: 'The list of hidden cities is not valid' };
  out.hiddenCities = [...new Set(b.hiddenCities || [])];
  if (b.groups === null || b.groups === undefined) {
    out.groups = null;
  } else {
    if (!Array.isArray(b.groups) || b.groups.length > MAX_GROUPS) return { error: `At most ${MAX_GROUPS} groups of links` };
    const codes = new Set(pageCodes().map((p) => p.code));
    out.groups = [];
    for (const g of b.groups) {
      const sk = text(g && g.sk, 40);
      const en = text(g && g.en, 40) || sk;
      if (!sk) return { error: 'Every group needs a title' };
      if (!Array.isArray(g.links) || g.links.length > MAX_LINKS) return { error: `At most ${MAX_LINKS} links in a group` };
      const links = [];
      for (const l of g.links) {
        const lsk = text(l && l.sk, 60);
        const len = text(l && l.en, 60) || lsk;
        if (!lsk && !(l && l.page) && !(l && l.url)) continue; // an empty row is dropped
        if (!lsk) return { error: `A link in "${sk}" has no text` };
        if (l.page) {
          if (!codes.has(l.page)) return { error: `"${lsk}" points at a page that does not exist` };
          links.push({ sk: lsk, en: len, page: l.page });
        } else {
          const url = text(l.url, 300);
          if (!URL_OK.test(url)) return { error: `The address of "${lsk}" must be a page, a link starting with https://, a path starting with / or #…` };
          links.push({ sk: lsk, en: len, url });
        }
      }
      out.groups.push({ sk, en, links });
    }
  }
  db.prepare('INSERT INTO footer_settings (scope, value) VALUES (?, ?) ON CONFLICT(scope) DO UPDATE SET value = excluded.value').run(scope, JSON.stringify(out));
  cache.delete(scope);
  return get(scope);
}

function reset(scope) {
  db.prepare('DELETE FROM footer_settings WHERE scope = ?').run(scope);
  cache.delete(scope);
  return get(scope);
}

module.exports = { NATIONAL, get, set, reset, pageCodes, EMPTY };
