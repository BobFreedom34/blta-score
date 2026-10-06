// SEO of the public pages: the <title>, description, keywords, link-preview (Open Graph / Twitter) tags, robots and canonical
// address of every page, edited in Backend > SEO (/seo-admin) and baked into the HTML on the server — crawlers and chat apps
// read the raw response, they do not run the page's scripts.
//
// A page is either a fixed one (/players) or a template for many (/season/:slug), where {name} in a text is replaced by the
// season's / player's / venue's / bracket's name. The first values were taken from the matching pages of blta.sk.
const fs = require('fs');
const path = require('path');
const db = require('./db');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SUFFIX = ' - BLTA - Bratislavská Liga Tenisových Amatérov';

// key, label, the route (path) and file it is served from, the page of blta.sk it corresponds to (for the backend's hint),
// and the first values. `template` pages have a :param in the path and an {name} placeholder.
const PAGES = [
  {
    key: 'home', label: 'Overview (home)', path: '/', file: 'index.html', blta: 'https://www.blta.sk/',
    title: 'BLTA Score - Živé skóre a tabuľky amatérskej tenisovej ligy',
    description: 'Živé skóre, tabuľky a harmonogram BLTA - Bratislavskej Ligy Tenisových Amatérov. Sleduj zápasy v priamom prenose, výsledky a rebríčky amatérskych tenistov.',
  },
  {
    key: 'matches', label: 'Matches', path: '/matches', file: 'matches.html', blta: null,
    title: `Zápasy${SUFFIX}`,
    description: 'Zápasy BLTA - Bratislavskej Ligy Tenisových Amatérov: živé skóre, výsledky a rozpis nadchádzajúcich zápasov amatérskej tenisovej ligy.',
  },
  {
    key: 'tables', label: 'Tables', path: '/tables', file: 'tables.html', blta: null,
    title: `Tabuľky${SUFFIX}`,
    description: 'Tabuľky BLTA - aktuálne poradie hráčov v skupinách kategórií Elite, Next Gen a Novice počas sezóny amatérskej tenisovej ligy.',
  },
  {
    key: 'rankings', label: 'Rankings', path: '/rankings', file: 'rankings.html', blta: 'https://score.blta.sk/rankings',
    title: `Rebríčky${SUFFIX}`,
    description: 'Rebríčky BLTA - bodové poradie hráčov ligy: celkové poradie, Race body jednotlivých kategórií a body z turnajov.',
  },
  {
    key: 'players', label: 'Players', path: '/players', file: 'players.html', blta: 'https://www.blta.sk/hraci/',
    title: `Hráči${SUFFIX}`,
    description: 'Hráči BLTA - komunita rekreačných a amatérskych tenistov v Bratislave. Profily hráčov, štatistiky a výsledky zápasov.',
  },
  {
    key: 'courts', label: 'Courts (venues)', path: '/courts', file: 'courts.html', blta: 'https://www.blta.sk/tenisove-kurty-v-bratislave/',
    title: `Tenisové kurty v Bratislave${SUFFIX}`,
    description: 'Tenisové kurty v Bratislave - prehľad tenisových kurtov v Bratislave a blízkom okolí. Kontaktné informácie, adresy, mapy a odkazy na rezerváciu kurtov.',
  },
  {
    key: 'harmonogram', label: 'Schedule (Harmonogram)', path: '/harmonogram', file: 'harmonogram.html', blta: 'https://www.blta.sk/harmonogram/',
    title: `Harmonogram${SUFFIX}`,
    description: 'Harmonogram BLTA - Bratislavskej Ligy Tenisových Amatérov - sezóna BLTA Ligy je rozdelená na tri 4-mesačné cykly a niekoľko turnajov.',
  },
  {
    key: 'propozicie', label: 'Propozície (rules)', path: '/propozicie', file: 'propozicie.html', blta: 'https://www.blta.sk/propozicie/',
    title: `Propozície${SUFFIX}`,
    description: 'Propozície BLTA - kompletné a aktuálne pravidlá ligy a turnajov: kategórie, herný systém, bodovanie, termíny, dohadovanie zápasov a štartovné.',
  },
  {
    key: 'looking-to-play', label: 'Looking for an opponent', path: '/looking-to-play', file: 'looking-to-play.html', blta: null,
    title: `Hľadám súpera${SUFFIX}`,
    description: 'Hľadáš súpera na tenis v Bratislave? Pridaj sa k hráčom BLTA, ktorí hľadajú partnera na zápas, a dohodni si hru.',
  },
  {
    key: 'new-match', label: 'New match', path: '/new-match', file: 'new-match.html', blta: null, noindex: true,
    title: `Nový zápas${SUFFIX}`,
    description: 'Vytvor nový zápas BLTA a sleduj jeho skóre naživo.',
  },
  {
    key: 'season', label: 'Season page (template)', path: '/season/:slug', file: 'season.html', template: true, blta: 'https://www.blta.sk/project/autumn-finals-series-2026/',
    title: `{name}${SUFFIX}`,
    description: '{name} - séria amatérskej tenisovej ligy BLTA: tabuľky skupín, rozpis kôl, výsledky, hráči a play-off. Dlhodobá tenisová liga pre amatérov a rekreačných hráčov v Bratislave.',
  },
  {
    key: 'player', label: 'Player profile (template)', path: '/player/:id', file: 'player.html', template: true, blta: null,
    title: `{name} - hráč${SUFFIX}`,
    description: '{name} - profil hráča BLTA: štatistiky, výsledky zápasov, rebríčkové body a odznaky.',
  },
  {
    key: 'court', label: 'Court page (template)', path: '/courts/:slug', file: 'court.html', template: true, blta: 'https://www.blta.sk/tenisove-kurty-v-bratislave/',
    title: `{name} - tenisový kurt${SUFFIX}`,
    description: '{name} - tenisový kurt, na ktorom sa hrá liga BLTA: adresa, kontakt, kurty, otváracie hodiny a odohrané zápasy.',
  },
  {
    key: 'bracket', label: 'Bracket page (template)', path: '/bracket/:id', file: 'bracket.html', template: true, blta: null,
    title: `{name} - pavúk${SUFFIX}`,
    description: '{name} - pavúk turnaja BLTA: zápasy, výsledky a postup hráčov.',
  },
];
// A page file added to public/ that is not listed above is picked up by itself: it appears in Backend > SEO with the title and
// description it already has, gets its own route (/<file name>) and goes into the sitemap — so a new page never has to be
// remembered here. Not public pages (the backend, embeds, helper pages) are left out. A page with a :param in its address
// (a season, a player…) cannot be found this way and is listed above by hand.
const NOT_PUBLIC = /^(admin|login-history|reset-code|compact|compactblta|match)$|^embed-|-admin$/;
function discoverPages() {
  const known = new Set(PAGES.map((p) => p.file));
  fs.readdirSync(PUBLIC_DIR).filter((f) => f.endsWith('.html') && !known.has(f)).forEach((file) => {
    const base = file.replace(/\.html$/, '');
    if (NOT_PUBLIC.test(base)) return;
    const html = fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8');
    const title = ((html.match(/<title[^>]*>([^<]*)<\/title>/) || [])[1] || '').trim();
    const description = ((html.match(/<meta\s+name="description"\s+content="([^"]*)"/) || [])[1] || '').trim();
    const label = base.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    PAGES.push({ key: base, label: `${label} (new page)`, path: `/${base}`, file, blta: null, title: title || `${label}${SUFFIX}`, description, discovered: true });
  });
}
discoverPages();
const BY_KEY = new Map(PAGES.map((p) => [p.key, p]));

const LIMITS = { title: 120, description: 320, keywords: 300, ogTitle: 120, ogDescription: 320, ogImage: 500 };

db.exec(`
  CREATE TABLE IF NOT EXISTS seo_pages (
    page_key TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    keywords TEXT NOT NULL DEFAULT '',
    og_title TEXT NOT NULL DEFAULT '',
    og_description TEXT NOT NULL DEFAULT '',
    og_image TEXT NOT NULL DEFAULT '',
    noindex INTEGER NOT NULL DEFAULT 0
  );
`);

// The first values go in once per page; after that the backend owns them (clearing a field is respected).
function seedDefaults() {
  const insert = db.prepare('INSERT OR IGNORE INTO seo_pages (page_key, title, description, noindex) VALUES (?, ?, ?, ?)');
  PAGES.forEach((p) => insert.run(p.key, p.title, p.description, p.noindex ? 1 : 0));
}
seedDefaults();

function rowToValues(r) {
  return {
    title: r.title, description: r.description, keywords: r.keywords,
    ogTitle: r.og_title, ogDescription: r.og_description, ogImage: r.og_image, noindex: !!r.noindex,
  };
}

function getValues(key) {
  const r = db.prepare('SELECT * FROM seo_pages WHERE page_key = ?').get(key);
  return r ? rowToValues(r) : null;
}

// Everything the backend lists: every page with its saved values, the first values (to reset to) and the blta.sk page.
function listAll() {
  return PAGES.map((p) => ({
    key: p.key, label: p.label, path: p.path, template: !!p.template, blta: p.blta,
    values: getValues(p.key),
    defaults: { title: p.title, description: p.description, keywords: '', ogTitle: '', ogDescription: '', ogImage: '', noindex: !!p.noindex },
  }));
}

// Reads and checks the values of a request body; returns { error } or { values }.
function parseValues(body) {
  const out = {};
  for (const field of ['title', 'description', 'keywords', 'ogTitle', 'ogDescription', 'ogImage']) {
    const raw = body[field];
    const v = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
    if (v.length > LIMITS[field]) return { error: `${field} is too long (max ${LIMITS[field]} characters)` };
    out[field] = v;
  }
  if (out.ogImage && !/^(https?:\/\/|\/)/.test(out.ogImage)) return { error: 'The preview image must be a full address (https://…) or start with /' };
  out.noindex = !!body.noindex;
  return { values: out };
}

function save(key, v) {
  db.prepare(`
    INSERT INTO seo_pages (page_key, title, description, keywords, og_title, og_description, og_image, noindex)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(page_key) DO UPDATE SET title = excluded.title, description = excluded.description, keywords = excluded.keywords,
      og_title = excluded.og_title, og_description = excluded.og_description, og_image = excluded.og_image, noindex = excluded.noindex
  `).run(key, v.title, v.description, v.keywords, v.ogTitle, v.ogDescription, v.ogImage, v.noindex ? 1 : 0);
}

// ---------- the HTML ----------

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TEMPLATES = new Map(PAGES.map((p) => [p.key, fs.readFileSync(path.join(PUBLIC_DIR, p.file), 'utf8')]));

// The tags the pages carry by hand (the old title, description and link-preview tags) — dropped before the saved ones go in.
const OLD_TAGS = /<meta\s+(?:name="(?:description|keywords|robots|twitter:[^"]*)"|property="og:[^"]*")[^>]*>[ \t]*\r?\n?/g;
const TITLE_TAG = /<title[^>]*>[^<]*<\/title>/;

const ROBOTS_INDEX = 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';

// `entity` is { name } for a template page; `origin` the public address of the site; `urlPath` the page's own path.
function render(key, { origin, urlPath, entity }) {
  const page = BY_KEY.get(key);
  const html = TEMPLATES.get(key);
  const v = getValues(key);
  if (!page || !html || !v) return html || '';
  const name = entity && entity.name ? entity.name : '';
  const fill = (text) => String(text || '').split('{name}').join(name).replace(/\s+/g, ' ').trim();
  const title = fill(v.title);
  const description = fill(v.description);
  const ogTitle = fill(v.ogTitle) || title;
  const ogDescription = fill(v.ogDescription) || description;
  const image = v.ogImage || (entity && entity.image) || '/img/blta-logo.png';
  const imageUrl = /^https?:\/\//.test(image) ? image : `${origin}${image.startsWith('/') ? '' : '/'}${image}`;
  const canonical = `${origin}${urlPath === '/' ? '/' : urlPath.replace(/\/$/, '')}`;
  const lines = [
    title ? `<title>${esc(title)}</title>` : '',
    description ? `<meta name="description" content="${esc(description)}">` : '',
    v.keywords ? `<meta name="keywords" content="${esc(v.keywords)}">` : '',
    `<meta name="robots" content="${v.noindex ? 'noindex, nofollow' : ROBOTS_INDEX}">`,
    `<link rel="canonical" href="${esc(canonical)}">`,
    '<meta property="og:locale" content="sk_SK">',
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="BLTA Score">',
    ogTitle ? `<meta property="og:title" content="${esc(ogTitle)}">` : '',
    ogDescription ? `<meta property="og:description" content="${esc(ogDescription)}">` : '',
    `<meta property="og:url" content="${esc(canonical)}">`,
    `<meta property="og:image" content="${esc(imageUrl)}">`,
    '<meta name="twitter:card" content="summary">',
    ogTitle ? `<meta name="twitter:title" content="${esc(ogTitle)}">` : '',
    ogDescription ? `<meta name="twitter:description" content="${esc(ogDescription)}">` : '',
    `<meta name="twitter:image" content="${esc(imageUrl)}">`,
  ].filter(Boolean).join('\n');
  // without a saved title the page keeps its own (translated) one
  return title
    ? html.replace(OLD_TAGS, '').replace(TITLE_TAG, () => lines)
    : html.replace(OLD_TAGS, '').replace(TITLE_TAG, (t) => `${t}\n${lines}`);
}

module.exports = { PAGES, BY_KEY, listAll, parseValues, save, render, getValues };

// ---------- sitemap.xml and robots.txt ----------

// The pages a search engine may list: the fixed pages and, unless their template is hidden, every season, player, venue and
// bracket. The paths of the backend, the API, the embeds and the helper pages are kept out by robots.txt.
function sitemapXml(origin) {
  const urls = [];
  const add = (p, lastmod) => urls.push({ loc: `${origin}${p}`, lastmod });
  const hidden = (key) => { const v = getValues(key); return !v || v.noindex; };
  PAGES.filter((p) => !p.template && !hidden(p.key)).forEach((p) => add(p.path));
  const day = (iso) => (iso ? String(iso).slice(0, 10) : undefined);
  if (!hidden('season')) db.prepare('SELECT slug FROM seasons WHERE slug IS NOT NULL').all().forEach((r) => add(`/season/${encodeURIComponent(r.slug)}`));
  if (!hidden('court')) db.prepare('SELECT slug FROM venues WHERE slug IS NOT NULL').all().forEach((r) => add(`/courts/${encodeURIComponent(r.slug)}`));
  if (!hidden('player')) db.prepare('SELECT slug FROM players WHERE slug IS NOT NULL').all().forEach((r) => add(`/player/${encodeURIComponent(r.slug)}`));
  if (!hidden('bracket')) db.prepare('SELECT id, updated_at FROM brackets').all().forEach((r) => add(`/bracket/${r.id}`, day(r.updated_at)));
  const body = urls.map((u) => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

function robotsTxt(origin) {
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /header-admin',
    'Disallow: /badges-admin',
    'Disallow: /bracket-admin',
    'Disallow: /venues-admin',
    'Disallow: /seasons-admin',
    'Disallow: /schedule-admin',
    'Disallow: /seo-admin',
    'Disallow: /login-history',
    'Disallow: /reset-code',
    'Disallow: /new-match',
    'Disallow: /api/',
    'Disallow: /embed/',
    'Disallow: /compact',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n');
}

module.exports.sitemapXml = sitemapXml;
module.exports.robotsTxt = robotsTxt;
