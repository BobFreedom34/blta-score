// The cities (leagues) of SLTA — Slovenská liga tenisových amatérov. One app serves all of them: the design and the code are shared, what
// belongs to a city (seasons, players, venues, rankings, texts, pictures …) carries its league_id (see src/db.js). Bratislava (BLTA, id 1) is
// the first league; everything that existed before the cities belongs to it.
//
// This file: reading the cities, the checks for a new or a changed one, the domain → city lookup and the middleware that puts the city of
// the request on `req.league` (an own domain such as blta.sk; otherwise Bratislava until the slta.sk/<city> addresses are served).
const db = require('./db');
const auth = require('./auth');

const DEFAULT_LEAGUE_ID = 1;
const STATUSES = ['ACTIVE', 'PREPARING', 'COMING_SOON', 'HIDDEN'];

// slta.sk/<slug> must never collide with an address the app already serves
const RESERVED_SLUGS = new Set([
  'api', 'admin', 'players', 'player', 'matches', 'match', 'season', 'seasons', 'tournament', 'tournaments', 'rankings', 'courts', 'court',
  'harmonogram', 'vitazi', 'propozicie', 'blog', 'article', 'articles', 'new-match', 'looking-to-play', 'reservations', 'reservation',
  'venues', 'compact', 'compactblta', 'embed', 'tables', 'bracket', 'brackets', 'login-history', 'seo', 'img', 'css', 'js', 'fonts', 'healthz',
  'robots.txt', 'sitemap.xml', 'manifest.json', 'cities', 'city', 'mesta', 'mesto', 'en', 'sk', 'login', 'logout', 'register', 'contact',
  'kontakt', 'kurty', 'tenisove-kurty-v-bratislave', 'www', 'static', 'uploads', 'socket.io', 'unlock', 'pozvanka', 'blog-images', 'player-photos', 'media', 'carousel',
  'carousel-images', 'venue-photos', 'season-heroes', 'badge-icons', 'winner-photos', 'slta', 'rezervacie-kurtov', 'rebricek', 'zapasy', 'hraci',
]);

function slugify(text) {
  return String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

// The coordinates (latitude, longitude) of the towns of Slovakia, for the pin of a city on the national map: a new city gets its own from
// here by its name, and a city that has none yet is given them once (the admin can change them in Backend > Cities afterwards).
const KNOWN_TOWNS = {
  bratislava: [48.1486, 17.1077], kosice: [48.7164, 21.2611], presov: [48.9984, 21.2339], zilina: [49.2231, 18.7394], 'banska bystrica': [48.7363, 19.1462],
  nitra: [48.3069, 18.0864], trnava: [48.3774, 17.5883], trencin: [48.8945, 18.0444], martin: [49.0665, 18.9217], poprad: [49.0612, 20.2977],
  prievidza: [48.7746, 18.6245], zvolen: [48.5763, 19.1531], 'povazska bystrica': [49.1214, 18.4247], michalovce: [48.7547, 21.9187], 'nove zamky': [47.9856, 18.1614],
  komarno: [47.7634, 18.1286], levice: [48.2155, 18.6068], humenne: [48.9371, 21.9171], bardejov: [49.2923, 21.2751], 'liptovsky mikulas': [49.0833, 19.6167],
  ruzomberok: [49.0746, 19.3066], piestany: [48.5922, 17.8338], lucenec: [48.3573, 19.6694], topolcany: [48.5578, 18.1749], 'dunajska streda': [47.9921, 17.6196],
  senica: [48.6794, 17.3679], 'dolny kubin': [49.2092, 19.2976], 'spisska nova ves': [48.9438, 20.5675], roznava: [48.6603, 20.5313], malacky: [48.4356, 17.0227],
  galanta: [48.1903, 17.7273], skalica: [48.8451, 17.2263], cadca: [49.4375, 18.7895], snina: [48.9886, 22.1517], 'vranov nad toplou': [48.8883, 21.6847],
};
const foldName = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
// [lat, lng] of a town by its name, or null when it is not one of the known towns
function coordsFor(name) {
  const c = KNOWN_TOWNS[foldName(name)];
  return c ? [c[0], c[1]] : null;
}

// 'https://www.Blta.sk/' → 'blta.sk'; '' stays ''; anything that is not a host name → null
function normalizeDomain(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return '';
  const host = raw.replace(/^[a-z]+:\/\//, '').split('/')[0].split(':')[0].replace(/^www\./, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

const byId = (id) => db.prepare('SELECT * FROM leagues WHERE id = ?').get(id);
const bySlug = (slug) => db.prepare('SELECT * FROM leagues WHERE slug = ?').get(String(slug || '').toLowerCase());

// the city of a host name (own domains only); the map is rebuilt whenever a city is written
let hostMap = null;
function invalidate() { hostMap = null; }
function forHost(host) {
  if (!hostMap) {
    hostMap = new Map();
    db.prepare("SELECT * FROM leagues WHERE domain != ''").all().forEach((l) => hostMap.set(l.domain, l));
  }
  return hostMap.get(String(host || '').toLowerCase().split(':')[0].replace(/^www\./, '')) || null;
}

function attach(req, res, next) {
  req.league = forHost(req.hostname) || byId(DEFAULT_LEAGUE_ID);
  next();
}

// The city a request works on. A public page always shows the city of its address (blta.sk: Bratislava, slta.sk/kosice: Košice), whoever
// looks at it, an admin included. Only the pages of the backend send the header X-Backend: 1 (see public/js/common.js), and then the admin
// works on his city: a city admin on his own, the super admin on the one picked in the backend (else Bratislava). A city admin who changes
// something on a public page of another city is refused (src/cityScope.js).
const ACTING_COOKIE = 'blta_city';
function actingIdOf(req) {
  const domainCity = (req.league && req.league.id) || DEFAULT_LEAGUE_ID;
  const me = auth.adminSession(req);
  if (!me) return domainCity;
  const backend = req.get && req.get('X-Backend') === '1';
  if (me.role === 'CITY') return backend ? me.leagueId : domainCity;
  if (backend) {
    const picked = Number(req.cookies && req.cookies[ACTING_COOKIE]);
    if (Number.isInteger(picked) && picked > 0 && byId(picked)) return picked;
    return DEFAULT_LEAGUE_ID;
  }
  return domainCity;
}

// the address of the season's page in each language (the code address /season/<slug> is retired, the page lives at its own slug)
function withPaths(season, tournament = false) {
  const seo = require('./seo');
  const code = `/${tournament ? 'tournament' : 'season'}/${encodeURIComponent(season.slug)}`;
  return { ...season, path: { sk: seo.pageUrl(code, 'sk'), en: seo.pageUrl(code, 'en') } };
}

// The season a visitor can register to now: the one of the city whose registration is open (not ended) that starts soonest from today on,
// else the one that is running. null when no registration is open anywhere in the city.
function registrationSeasonOf(leagueId, today) {
  const open = db.prepare("SELECT name, slug, kind, start_date FROM seasons WHERE league_id = ? AND registration_open = 1 AND slug IS NOT NULL AND (end_date IS NULL OR end_date = '' OR end_date >= ?)").all(leagueId, today);
  if (!open.length) return null;
  const coming = open.filter((s) => s.start_date && s.start_date > today).sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
  const pick = coming[0] || open.sort((a, b) => ((a.start_date || '') < (b.start_date || '') ? 1 : -1))[0];
  return withPaths({ name: pick.name, slug: pick.slug }, pick.kind === 'TOURNAMENT');
}

// the running season of a city, else the nearest coming one
function currentSeasonOf(leagueId, today) {
  const running = db.prepare("SELECT name, slug FROM seasons WHERE league_id = ? AND kind = 'LEAGUE' AND start_date <= ? AND (end_date IS NULL OR end_date >= ?) ORDER BY start_date DESC LIMIT 1").get(leagueId, today, today);
  if (running) return withPaths({ name: running.name, slug: running.slug, state: 'now' });
  const next = db.prepare("SELECT name, slug FROM seasons WHERE league_id = ? AND kind = 'LEAGUE' AND start_date > ? ORDER BY start_date LIMIT 1").get(leagueId, today);
  return next ? withPaths({ name: next.name, slug: next.slug, state: 'future' }) : null;
}

function countsOf(leagueId) {
  const n = (sql) => db.prepare(sql).get(leagueId).n;
  return {
    players: n('SELECT COUNT(*) AS n FROM players WHERE league_id = ? AND COALESCE(hidden, 0) = 0'),
    seasons: n('SELECT COUNT(*) AS n FROM seasons WHERE league_id = ?'),
    venues: n('SELECT COUNT(*) AS n FROM venues WHERE league_id = ?'),
  };
}

function serialize(row, { admin = false } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const counts = countsOf(row.id);
  const out = {
    id: row.id,
    slug: row.slug,
    name: row.name,
    brandName: row.brand_name || row.name,
    status: row.status,
    // where the city lives: its own domain, else its address under the national site (slta.sk/<slug>)
    url: row.domain ? `https://${row.domain}` : `/${row.slug}`,
    lat: row.lat,
    lng: row.lng,
    players: counts.players,
    seasons: counts.seasons,
    venues: counts.venues,
    registrationOpen: !!db.prepare('SELECT 1 FROM seasons WHERE league_id = ? AND registration_open = 1 AND (end_date IS NULL OR end_date >= ?) LIMIT 1').get(row.id, today),
    // where the Registration button of the national page leads: the season that really takes registrations
    registrationSeason: registrationSeasonOf(row.id, today),
    currentSeason: currentSeasonOf(row.id, today),
  };
  if (admin) {
    out.domain = row.domain || '';
    out.sortOrder = row.sort_order;
    out.createdAt = row.created_at;
  }
  return out;
}

// the whole table of the data a city owns: a city with rows in any of these cannot be deleted
const OWNED_TABLES = ['seasons', 'venues', 'players', 'matches', 'header_items', 'winner_editions', 'carousel_slides', 'brackets', 'schedule_events'];
function hasData(leagueId) {
  return OWNED_TABLES.some((t) => db.prepare(`SELECT 1 FROM ${t} WHERE league_id = ? LIMIT 1`).get(leagueId));
}

// Once per city: a city that has no coordinates yet (made before the towns were known) gets those of its name, if it is a known town
db.prepare('SELECT id, name FROM leagues WHERE lat IS NULL AND lng IS NULL').all().forEach((l) => {
  if (db.prepare('SELECT 1 FROM app_flags WHERE key = ?').get(`city_coords_${l.id}`)) return;
  const c = coordsFor(l.name);
  if (c) db.prepare('UPDATE leagues SET lat = ?, lng = ? WHERE id = ? AND lat IS NULL AND lng IS NULL').run(c[0], c[1], l.id);
  db.prepare('INSERT OR IGNORE INTO app_flags (key) VALUES (?)').run(`city_coords_${l.id}`);
});

module.exports = { coordsFor, ACTING_COOKIE, actingIdOf, DEFAULT_LEAGUE_ID, STATUSES, RESERVED_SLUGS, slugify, normalizeDomain, byId, bySlug, forHost, invalidate, attach, serialize, hasData };
