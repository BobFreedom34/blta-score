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

// the running season of a city, else the nearest coming one
function currentSeasonOf(leagueId, today) {
  const running = db.prepare("SELECT name, slug FROM seasons WHERE league_id = ? AND kind = 'LEAGUE' AND start_date <= ? AND (end_date IS NULL OR end_date >= ?) ORDER BY start_date DESC LIMIT 1").get(leagueId, today, today);
  if (running) return { name: running.name, slug: running.slug, state: 'now' };
  const next = db.prepare("SELECT name, slug FROM seasons WHERE league_id = ? AND kind = 'LEAGUE' AND start_date > ? ORDER BY start_date LIMIT 1").get(leagueId, today);
  return next ? { name: next.name, slug: next.slug, state: 'future' } : null;
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

module.exports = { ACTING_COOKIE, actingIdOf, DEFAULT_LEAGUE_ID, STATUSES, RESERVED_SLUGS, slugify, normalizeDomain, byId, bySlug, forHost, invalidate, attach, serialize, hasData };
