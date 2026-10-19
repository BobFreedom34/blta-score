// What a city admin may touch. The super admin (the ADMIN_PASSWORD of the server) works on every city and on the settings of the whole site; a
// city admin (an account of Backend > Admins, see src/routes/cityAdmins.js) runs ONE city: its seasons, players, venues, brackets, winners,
// pictures and menu. Every route of the app that asks for an admin lets a city admin through, so this middleware (mounted on /api before the
// routers) narrows it down for a city admin:
//   1. anything that changes the whole site (cities, other admins, SEO, rules, texts, badges, backups …) is refused;
//   2. a change to a row that belongs to another city is refused (a season, a venue, a player, a match … is looked up by its address);
//   3. a request that names a season (a new match, a new bracket) must name one of the city's own.
// Reading is public and is cut down to the city by the lists themselves (leagues.actingIdOf); creating stamps the city on the new row.
const db = require('./db');
const auth = require('./auth');

// the areas in which a city admin may write at all (the rest is for the super admin); everything in them is checked row by row
const CITY_AREAS = new Set(['seasons', 'venues', 'players', 'matches', 'brackets', 'winners', 'carousel', 'header-items', 'schedule']);
// areas that anybody may write to (a player, a visitor) whatever the admin is
const OPEN_AREAS = new Set(['player', 'push', 'availability', 'invites']);

const id = (s) => (/^\d+$/.test(String(s || '')) ? Number(s) : null);
const one = (sql, ...args) => {
  const row = db.prepare(sql).get(...args);
  return row ? row.league_id : null;
};

// the city a row belongs to, from the address of the request ('/seasons/5/hero' → segments ['seasons', '5', 'hero']);
// undefined = no single row is addressed (a new one, a list), null = addressed but not found
function leagueOfAddress(seg) {
  const [area, a, b] = seg;
  switch (area) {
    case 'seasons':
      if (a === 'groups') return id(b) ? one('SELECT s.league_id FROM season_groups g JOIN seasons s ON s.id = g.season_id WHERE g.id = ?', id(b)) : undefined;
      if (a === 'registrations') return id(b) ? one('SELECT s.league_id FROM season_registrations r JOIN seasons s ON s.id = r.season_id WHERE r.id = ?', id(b)) : undefined;
      return id(a) ? one('SELECT league_id FROM seasons WHERE id = ?', id(a)) : undefined;
    case 'venues': return id(a) ? one('SELECT league_id FROM venues WHERE id = ?', id(a)) : undefined;
    case 'players':
      if (!a) return undefined;
      return id(a) ? one('SELECT league_id FROM players WHERE id = ?', id(a)) : one('SELECT league_id FROM players WHERE slug = ?', a);
    case 'matches': return a ? one('SELECT league_id FROM matches WHERE share_token = ?', a) : undefined;
    case 'brackets': return id(a) ? one('SELECT league_id FROM brackets WHERE id = ?', id(a)) : undefined;
    case 'carousel': return id(a) ? one('SELECT league_id FROM carousel_slides WHERE id = ?', id(a)) : undefined;
    case 'header-items': return id(a) ? one('SELECT league_id FROM header_items WHERE id = ?', id(a)) : undefined;
    case 'schedule': return a === 'events' && id(b) ? one('SELECT league_id FROM schedule_events WHERE id = ?', id(b)) : undefined;
    case 'winners':
      if (a === 'editions') return id(b) ? one('SELECT league_id FROM winner_editions WHERE id = ?', id(b)) : undefined;
      if (a === 'blocks') return id(b) ? one('SELECT e.league_id FROM winner_blocks b JOIN winner_editions e ON e.id = b.edition_id WHERE b.id = ?', id(b)) : undefined;
      if (a === 'places') return id(b) ? one('SELECT e.league_id FROM winner_places p JOIN winner_blocks b ON b.id = p.block_id JOIN winner_editions e ON e.id = b.edition_id WHERE p.id = ?', id(b)) : undefined;
      return undefined;
    default: return undefined;
  }
}

function guard(req, res, next) {
  const me = auth.adminSession(req);
  if (!me || me.role !== 'CITY') return next();
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();

  const seg = req.path.split('/').filter(Boolean);
  const area = seg[0];
  if (area === 'admin' && (seg[1] === 'login' || seg[1] === 'logout')) return next();
  if (OPEN_AREAS.has(area)) return next();
  if (!CITY_AREAS.has(area)) return res.status(403).json({ error: 'Only the super admin can change this' });

  const owner = leagueOfAddress(seg);
  if (owner !== undefined && owner !== null && owner !== me.leagueId) {
    return res.status(403).json({ error: 'This belongs to another city' });
  }
  // a request that names a season must name one of the city's own
  const body = req.body || {};
  const named = body.seasonId !== undefined ? body.seasonId : body.season_id;
  if (named !== undefined && named !== null && named !== '') {
    const seasonLeague = id(named) ? one('SELECT league_id FROM seasons WHERE id = ?', id(named)) : null;
    if (seasonLeague !== null && seasonLeague !== me.leagueId) return res.status(403).json({ error: 'That season belongs to another city' });
  }
  return next();
}

module.exports = { guard, leagueOfAddress };
