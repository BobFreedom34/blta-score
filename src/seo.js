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
    title: 'BLTA - Živé skóre a tabuľky amatérskej tenisovej ligy',
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
    key: 'vitazi', label: 'Winners (Víťazi)', path: '/vitazi', file: 'vitazi.html', blta: 'https://www.blta.sk/vitazi/',
    title: `Víťazi${SUFFIX}`,
    description: 'Víťazi BLTA - Bratislavskej Ligy Tenisových Amatérov: víťazi, finalisti a semifinalisti jednotlivých sérií a turnajov v kategóriách Elite, Next Gen a Novice.',
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
    key: 'reservations', label: 'Court reservations', path: '/reservations', file: 'reservations.html', blta: null, slugSk: 'rezervacie-kurtov',
    title: `Rezervácie kurtov${SUFFIX}`,
    description: 'Rezervácie kurtov BLTA - vyber si voľný termín na tenisovom kurte na najbližších 7 dní a rezervuj si ho jedným kliknutím.',
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
const LANGS = ['sk', 'en'];
const LANG_NAME = { sk: 'Slovak', en: 'English' };

// ---------- English ----------
// The English address (slug) and meta texts every page starts with (the Slovak ones are in PAGES above). Like the Slovak ones they
// go in once per page; after that Backend > SEO owns them. A page that is not listed (a new page file) starts with its Slovak text.
const SUFFIX_EN = ' - BLTA - Bratislava Amateur Tennis League';
const ENGLISH = {
  home: {
    slug: '',
    title: 'BLTA - Live scores and tables of the amateur tennis league',
    description: 'Live scores, tables and the schedule of BLTA - the Bratislava Amateur Tennis League. Follow matches live and check the results and rankings of amateur tennis players.',
  },
  matches: {
    slug: 'matches',
    title: `Matches${SUFFIX_EN}`,
    description: 'BLTA matches - live scores, results and the schedule of upcoming matches of the Bratislava amateur tennis league.',
  },
  tables: {
    slug: 'tables',
    title: `Tables${SUFFIX_EN}`,
    description: 'BLTA tables - the current standings of the players in the groups of the Elite, Next Gen and Novice categories during the season of the amateur tennis league.',
  },
  rankings: {
    slug: 'rankings',
    title: `Rankings${SUFFIX_EN}`,
    description: 'BLTA rankings - the points standings of the league players: the overall ranking, the Race points of each category and the points from tournaments.',
  },
  players: {
    slug: 'players',
    title: `Players${SUFFIX_EN}`,
    description: 'BLTA players - a community of recreational and amateur tennis players in Bratislava. Player profiles, statistics and match results.',
  },
  courts: {
    slug: 'courts',
    title: `Tennis courts in Bratislava${SUFFIX_EN}`,
    description: 'Tennis courts in Bratislava - an overview of the tennis courts in Bratislava and the surrounding area. Contact details, addresses, maps and links to book a court.',
  },
  harmonogram: {
    slug: 'schedule',
    title: `Schedule${SUFFIX_EN}`,
    description: 'BLTA schedule - the season of the BLTA League is divided into three 4-month cycles and several tournaments.',
  },
  vitazi: {
    slug: 'winners',
    title: `Winners${SUFFIX_EN}`,
    description: 'BLTA winners - the winners, finalists and semifinalists of each series and tournament of the Bratislava Amateur Tennis League in the Elite, Next Gen and Novice categories.',
  },
  propozicie: {
    slug: 'rules',
    title: `Rules${SUFFIX_EN}`,
    description: 'BLTA rules - the complete and current rules of the league and the tournaments: categories, game format, scoring, dates, arranging matches and entry fees.',
  },
  'looking-to-play': {
    slug: 'looking-to-play',
    title: `Looking for an opponent${SUFFIX_EN}`,
    description: 'Looking for a tennis opponent in Bratislava? Join the BLTA players who are looking for a partner for a match and arrange a game.',
  },
  reservations: {
    slug: 'court-booking',
    title: `Court booking${SUFFIX_EN}`,
    description: 'BLTA court booking - pick a free time on the tennis court for the next 7 days and reserve it with one click.',
  },
  'new-match': {
    slug: 'new-match',
    title: `New match${SUFFIX_EN}`,
    description: 'Create a new BLTA match and follow its score live.',
  },
  season: {
    slug: 'season',
    title: `{name}${SUFFIX_EN}`,
    description: '{name} - a series of the BLTA amateur tennis league: group tables, round schedule, results, players and play-offs. A long-running tennis league for amateur and recreational players in Bratislava.',
  },
  player: {
    slug: 'player',
    title: `{name} - player${SUFFIX_EN}`,
    description: '{name} - BLTA player profile: statistics, match results, ranking points and badges.',
  },
  court: {
    slug: 'courts',
    title: `{name} - tennis court${SUFFIX_EN}`,
    description: '{name} - a tennis court where the BLTA league is played: address, contact, courts, opening hours and the matches played there.',
  },
  bracket: {
    slug: 'bracket',
    title: `{name} - bracket${SUFFIX_EN}`,
    description: '{name} - the BLTA tournament bracket: matches, results and how the players advance.',
  },
};

// The part of a page's code address that its slug stands for: 'rankings' for /rankings, 'season' for /season/:slug, '' for home.
const baseOf = (p) => p.path.split('/')[1] || '';
const isTemplate = (p) => !!p.template;

function defaultSlug(p, lang) {
  if (p.path === '/') return '';
  if (lang === 'en' && ENGLISH[p.key] && ENGLISH[p.key].slug) return ENGLISH[p.key].slug;
  if (lang === 'sk' && p.slugSk) return p.slugSk;
  return baseOf(p);
}

function defaultValues(p, lang) {
  const e = lang === 'en' ? ENGLISH[p.key] : null;
  return {
    title: e ? e.title : p.title,
    description: e ? e.description : p.description,
    keywords: '', ogTitle: '', ogDescription: '', ogImage: '',
  };
}

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
  CREATE TABLE IF NOT EXISTS seo_pages_en (
    page_key TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    keywords TEXT NOT NULL DEFAULT '',
    og_title TEXT NOT NULL DEFAULT '',
    og_description TEXT NOT NULL DEFAULT '',
    og_image TEXT NOT NULL DEFAULT ''
  );
`);
// the address of the page in each language (seo_pages itself holds the Slovak texts; the English texts are in seo_pages_en)
const seoColumns = db.prepare('PRAGMA table_info(seo_pages)').all().map((c) => c.name);
if (!seoColumns.includes('slug')) db.exec("ALTER TABLE seo_pages ADD COLUMN slug TEXT NOT NULL DEFAULT ''");
if (!seoColumns.includes('slug_en')) db.exec("ALTER TABLE seo_pages ADD COLUMN slug_en TEXT NOT NULL DEFAULT ''");

// The first values go in once per page; after that the backend owns them (clearing a field is respected). A slug is never empty
// (except the home page's), so an empty one means "not set yet".
function seedDefaults() {
  const insertSk = db.prepare('INSERT OR IGNORE INTO seo_pages (page_key, title, description, noindex) VALUES (?, ?, ?, ?)');
  const insertEn = db.prepare('INSERT OR IGNORE INTO seo_pages_en (page_key, title, description) VALUES (?, ?, ?)');
  const setSk = db.prepare("UPDATE seo_pages SET slug = ? WHERE page_key = ? AND slug = ''");
  const setEn = db.prepare("UPDATE seo_pages SET slug_en = ? WHERE page_key = ? AND slug_en = ''");
  PAGES.forEach((p) => {
    insertSk.run(p.key, p.title, p.description, p.noindex ? 1 : 0);
    const en = defaultValues(p, 'en');
    insertEn.run(p.key, en.title, en.description);
    if (p.path !== '/') {
      setSk.run(defaultSlug(p, 'sk'), p.key);
      setEn.run(defaultSlug(p, 'en'), p.key);
    }
  });
}
seedDefaults();
// the home page used to start with "BLTA Score - …": a title still at that first value becomes the "BLTA - …" one (an edited title is left alone)
db.prepare("UPDATE seo_pages SET title = ? WHERE page_key = 'home' AND title = ?").run('BLTA - Živé skóre a tabuľky amatérskej tenisovej ligy', 'BLTA Score - Živé skóre a tabuľky amatérskej tenisovej ligy');
db.prepare("UPDATE seo_pages_en SET title = ? WHERE page_key = 'home' AND title = ?").run('BLTA - Live scores and tables of the amateur tennis league', 'BLTA Score - Live scores and tables of the amateur tennis league');

const TABLE = { sk: 'seo_pages', en: 'seo_pages_en' };

function getValues(key, lang = 'sk') {
  const r = db.prepare(`SELECT * FROM ${TABLE[lang]} WHERE page_key = ?`).get(key);
  if (!r) return null;
  return {
    title: r.title, description: r.description, keywords: r.keywords,
    ogTitle: r.og_title, ogDescription: r.og_description, ogImage: r.og_image,
    noindex: noindexOf(key),
  };
}

// hiding a page from search engines is one switch for both languages
function noindexOf(key) {
  const r = db.prepare('SELECT noindex FROM seo_pages WHERE page_key = ?').get(key);
  return !r || !!r.noindex;
}

// ---------- the addresses ----------

const localize = require('../public/js/localize.js');
const LOCALIZE_SOURCE = fs.readFileSync(path.join(PUBLIC_DIR, 'js', 'localize.js'), 'utf8');
let routeCache = null;
let libCache = null;
let scriptCache = null;

// [{ key, path, template, sk, en }] — the table localize.js works from (the browser gets it too, see clientScript)
function routes() {
  if (!routeCache) {
    const rows = new Map(db.prepare('SELECT page_key, slug, slug_en FROM seo_pages').all().map((r) => [r.page_key, r]));
    routeCache = PAGES.map((p) => {
      const r = rows.get(p.key) || {};
      return {
        key: p.key, path: p.path, template: isTemplate(p),
        sk: p.path === '/' ? '' : (r.slug || defaultSlug(p, 'sk')),
        en: p.path === '/' ? '' : (r.slug_en || defaultSlug(p, 'en')),
      };
    });
  }
  return routeCache;
}
function lib() {
  if (!libCache) libCache = localize.make(routes());
  return libCache;
}
function forgetRoutes() { routeCache = null; libCache = null; scriptCache = null; }

// /js/localize.js for the browser: the code above plus the routes of the site
function clientScript() {
  if (!scriptCache) scriptCache = `${LOCALIZE_SOURCE}\nBLTA_LOCALIZE.boot(${JSON.stringify(routes())});\n`;
  return scriptCache;
}

const resolve = (address) => lib().resolve(address);
// the public address of a code address (/rankings, /player/<slug>) in a language; the code address itself when it is no page
const pageUrl = (address, lang = 'sk') => lib().toPublic(address, lang) || address;

// The code addresses of the pages are retired as public addresses: once a page's slug is changed, /rankings (and /rankings.html)
// is gone — no redirect, no alias. Also everything under /en/ that is no page, and /season/<x> and the like when the
// slug of that page is another one.
const FILE_BASES = new Set(PAGES.map((p) => p.file.replace(/\.html$/, '')));
const TEMPLATE_BASES = new Set(PAGES.filter(isTemplate).map(baseOf));
function isRetired(address) {
  const p = String(address || '/').replace(/\/+$/, '') || '/';
  const file = /^\/([^/]+?)(\.html)?$/.exec(p);
  if (file && FILE_BASES.has(file[1])) return true;
  const segs = p.split('/');
  if (segs.length === 3 && TEMPLATE_BASES.has(segs[1])) return true;
  return p === '/en' || p.startsWith('/en/');
}

// ---------- editing ----------

// Words an address must not be: the folders and files of the app (a slug is the first part of the address, so /css or /api would
// be taken by the app first).
const RESERVED = new Set(['api', 'en', 'match', 'embed', 'compact', 'compactblta', 'socket', 'socket.io', 'robots', 'robots.txt', 'sitemap', 'sitemap.xml',
  'badge-icons', 'player-photos', 'carousel-images', 'winner-photos']);
const PAGE_FILES = new Set(PAGES.map((p) => p.file));
fs.readdirSync(PUBLIC_DIR).forEach((name) => { if (!PAGE_FILES.has(name)) RESERVED.add(name.replace(/\.[^.]+$/, '')); });

// What a typed address becomes: lowercase letters, digits and single hyphens (no accents, no spaces).
function normalizeSlug(text) {
  return String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim()
    .replace(/[\s_/]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-').replace(/^-|-$/g, '');
}

// null when the address is fine for that page in that language, else the reason.
function checkSlug(page, lang, slug) {
  if (!slug) return 'the address is required (letters, digits and hyphens)';
  if (slug.length > 60) return 'the address is too long (max 60 characters)';
  if (lang === 'sk') {
    if (RESERVED.has(slug)) return `"${slug}" is used by the app itself — pick another address`;
    // the code address of another page: that is what the page links in the code still say, and it must stay free of meaning
    const old = PAGES.find((o) => o.key !== page.key && isTemplate(o) === isTemplate(page) && o.path !== '/' && baseOf(o) === slug);
    if (old) return `"${slug}" is the old address of "${old.label}" — pick another address`;
  }
  const column = lang === 'sk' ? 'slug' : 'slug_en';
  const clash = db.prepare(`SELECT page_key FROM seo_pages WHERE ${column} = ?`).all(slug)
    .map((r) => BY_KEY.get(r.page_key)).find((o) => o && o.key !== page.key && isTemplate(o) === isTemplate(page));
  if (clash) return `"${slug}" is already the ${LANG_NAME[lang]} address of "${clash.label}"`;
  return null;
}

// Everything the backend lists: every page with its addresses and saved values in both languages, and the first ones (to reset to).
function listAll() {
  const table = new Map(routes().map((r) => [r.key, r]));
  return PAGES.map((p) => {
    const route = table.get(p.key);
    const sk = getValues(p.key, 'sk');
    const en = getValues(p.key, 'en');
    const { noindex, ...skValues } = sk;
    const { noindex: unused, ...enValues } = en;
    return {
      key: p.key, label: p.label, path: p.path, template: isTemplate(p), home: p.path === '/', blta: p.blta,
      slugs: { sk: route.sk, en: route.en },
      defaultSlugs: { sk: defaultSlug(p, 'sk'), en: defaultSlug(p, 'en') },
      noindex,
      values: { sk: skValues, en: enValues },
      defaults: { sk: defaultValues(p, 'sk'), en: defaultValues(p, 'en') },
      defaultNoindex: !!p.noindex,
    };
  });
}

// Reads and checks the texts of one language; returns { error } or { values }.
function parseValues(body) {
  const out = {};
  for (const field of Object.keys(LIMITS)) {
    const raw = (body || {})[field];
    const v = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
    if (v.length > LIMITS[field]) return { error: `${field} is too long (max ${LIMITS[field]} characters)` };
    out[field] = v;
  }
  if (out.ogImage && !/^(https?:\/\/|\/)/.test(out.ogImage)) return { error: 'The preview image must be a full address (https://…) or start with /' };
  return { values: out };
}

// The body of a save: { noindex, slugs: { sk, en }, sk: { title… }, en: { title… } } -> { error } or { slugs, values, noindex }.
function parseBody(page, body) {
  const b = body || {};
  const out = { slugs: {}, values: {}, noindex: !!b.noindex };
  for (const lang of LANGS) {
    const parsed = parseValues(b[lang]);
    if (parsed.error) return { error: `${LANG_NAME[lang]}: ${parsed.error}` };
    out.values[lang] = parsed.values;
    if (page.path === '/') continue;
    const slug = normalizeSlug((b.slugs || {})[lang]);
    const problem = checkSlug(page, lang, slug);
    if (problem) return { error: `${LANG_NAME[lang]}: ${problem}` };
    out.slugs[lang] = slug;
  }
  return out;
}

function save(page, parsed) {
  const v = parsed.values;
  db.exec('BEGIN');
  try {
    db.prepare(`
      UPDATE seo_pages SET title = ?, description = ?, keywords = ?, og_title = ?, og_description = ?, og_image = ?, noindex = ?
      WHERE page_key = ?
    `).run(v.sk.title, v.sk.description, v.sk.keywords, v.sk.ogTitle, v.sk.ogDescription, v.sk.ogImage, parsed.noindex ? 1 : 0, page.key);
    db.prepare(`
      INSERT INTO seo_pages_en (page_key, title, description, keywords, og_title, og_description, og_image)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(page_key) DO UPDATE SET title = excluded.title, description = excluded.description, keywords = excluded.keywords,
        og_title = excluded.og_title, og_description = excluded.og_description, og_image = excluded.og_image
    `).run(page.key, v.en.title, v.en.description, v.en.keywords, v.en.ogTitle, v.en.ogDescription, v.en.ogImage);
    if (page.path !== '/') db.prepare('UPDATE seo_pages SET slug = ?, slug_en = ? WHERE page_key = ?').run(parsed.slugs.sk, parsed.slugs.en, page.key);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  forgetRoutes();
}

// ---------- the HTML ----------

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TEMPLATES = new Map(PAGES.map((p) => [p.key, fs.readFileSync(path.join(PUBLIC_DIR, p.file), 'utf8')]));

// The tags the pages carry by hand (the old title, description and link-preview tags) — dropped before the saved ones go in.
const OLD_TAGS = /<meta\s+(?:name="(?:description|keywords|robots|twitter:[^"]*)"|property="og:[^"]*")[^>]*>[ \t]*\r?\n?/g;
const TITLE_TAG = /<title[^>]*>[^<]*<\/title>/;
const HTML_LANG = /<html lang="[^"]*"/;

const ROBOTS_INDEX = 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';
const OG_LOCALE = { sk: 'sk_SK', en: 'en_GB' };

// `canonical` is the code address of the page (/rankings, /season/<slug>); `lang` the language of the address asked for;
// `entity` is { name } for a template page; `origin` the public address of the site.
function render(key, { origin, canonical, lang = 'sk', entity }) {
  const page = BY_KEY.get(key);
  const html = TEMPLATES.get(key);
  const v = getValues(key, lang);
  if (!page || !html || !v) return html || '';
  const name = entity && entity.name ? entity.name : '';
  const fill = (text) => String(text || '').split('{name}').join(name).replace(/\s+/g, ' ').trim();
  const title = fill(v.title);
  const description = fill(v.description);
  const ogTitle = fill(v.ogTitle) || title;
  const ogDescription = fill(v.ogDescription) || description;
  const image = v.ogImage || (entity && entity.image) || '/img/blta-logo.png';
  const imageUrl = /^https?:\/\//.test(image) ? image : `${origin}${image.startsWith('/') ? '' : '/'}${image}`;
  const urlOf = (lg) => `${origin}${pageUrl(canonical, lg)}`;
  const other = lang === 'sk' ? 'en' : 'sk';
  const lines = [
    title ? `<title>${esc(title)}</title>` : '',
    description ? `<meta name="description" content="${esc(description)}">` : '',
    v.keywords ? `<meta name="keywords" content="${esc(v.keywords)}">` : '',
    `<meta name="robots" content="${v.noindex ? 'noindex, nofollow' : ROBOTS_INDEX}">`,
    `<link rel="canonical" href="${esc(urlOf(lang))}">`,
    `<link rel="alternate" hreflang="sk" href="${esc(urlOf('sk'))}">`,
    `<link rel="alternate" hreflang="en" href="${esc(urlOf('en'))}">`,
    `<link rel="alternate" hreflang="x-default" href="${esc(urlOf('sk'))}">`,
    `<meta property="og:locale" content="${OG_LOCALE[lang]}">`,
    `<meta property="og:locale:alternate" content="${OG_LOCALE[other]}">`,
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="BLTA">',
    ogTitle ? `<meta property="og:title" content="${esc(ogTitle)}">` : '',
    ogDescription ? `<meta property="og:description" content="${esc(ogDescription)}">` : '',
    `<meta property="og:url" content="${esc(urlOf(lang))}">`,
    `<meta property="og:image" content="${esc(imageUrl)}">`,
    '<meta name="twitter:card" content="summary">',
    ogTitle ? `<meta name="twitter:title" content="${esc(ogTitle)}">` : '',
    ogDescription ? `<meta name="twitter:description" content="${esc(ogDescription)}">` : '',
    `<meta name="twitter:image" content="${esc(imageUrl)}">`,
  ].filter(Boolean).join('\n');
  const stripped = html.replace(OLD_TAGS, '').replace(HTML_LANG, `<html lang="${lang}"`);
  // without a saved title the page keeps its own (translated) one
  return title
    ? stripped.replace(TITLE_TAG, () => lines)
    : stripped.replace(TITLE_TAG, (t) => `${t}\n${lines}`);
}

module.exports = {
  PAGES, BY_KEY, LANGS, listAll, parseBody, save, render, getValues,
  routes, resolve, pageUrl, isRetired, clientScript, normalizeSlug,
};

// ---------- sitemap.xml and robots.txt ----------

// The pages a search engine may list, in both languages (each entry points at the other language): the fixed pages and, unless
// their template is hidden, every season, player, venue and bracket. The paths of the backend, the API, the embeds and the helper
// pages are kept out by robots.txt.
function sitemapXml(origin) {
  const entries = [];
  const add = (canonical, lastmod) => entries.push({ canonical, lastmod });
  const hidden = (key) => noindexOf(key);
  PAGES.filter((p) => !p.template && !hidden(p.key)).forEach((p) => add(p.path));
  const day = (iso) => (iso ? String(iso).slice(0, 10) : undefined);
  if (!hidden('season')) db.prepare('SELECT slug FROM seasons WHERE slug IS NOT NULL').all().forEach((r) => add(`/season/${encodeURIComponent(r.slug)}`));
  if (!hidden('court')) db.prepare('SELECT slug FROM venues WHERE slug IS NOT NULL').all().forEach((r) => add(`/courts/${encodeURIComponent(r.slug)}`));
  if (!hidden('player')) db.prepare('SELECT slug FROM players WHERE slug IS NOT NULL').all().forEach((r) => add(`/player/${encodeURIComponent(r.slug)}`));
  if (!hidden('bracket')) db.prepare('SELECT id, updated_at FROM brackets').all().forEach((r) => add(`/bracket/${r.id}`, day(r.updated_at)));
  const body = entries.map((e) => {
    const sk = `${origin}${pageUrl(e.canonical, 'sk')}`;
    const en = `${origin}${pageUrl(e.canonical, 'en')}`;
    const alternates = `<xhtml:link rel="alternate" hreflang="sk" href="${esc(sk)}"/><xhtml:link rel="alternate" hreflang="en" href="${esc(en)}"/>`;
    const lastmod = e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : '';
    return [sk, en].map((loc) => `  <url><loc>${esc(loc)}</loc>${lastmod}${alternates}</url>`).join('\n');
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${body}\n</urlset>\n`;
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
    'Disallow: /tournaments-admin',
    'Disallow: /changelog-admin',
    'Disallow: /reservations-admin',
    'Disallow: /schedule-admin',
    'Disallow: /winners-admin',
    'Disallow: /seo-admin',
    'Disallow: /login-history',
    'Disallow: /reset-code',
    `Disallow: ${pageUrl('/new-match', 'sk')}`,
    `Disallow: ${pageUrl('/new-match', 'en')}`,
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
