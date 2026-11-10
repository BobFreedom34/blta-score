// What happened around an event of a club, as lines under its comments ("Alan sa prihlásil", "Boris sa odhlásil", "Peter nastúpil z čakačky").
// Written where the registrations change (src/routes/seasons.js), read by the comments of the event (src/routes/communities.js).
const db = require('./db');

db.exec(`
  CREATE TABLE IF NOT EXISTS season_activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    season_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    player_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_season_activity_season ON season_activity(season_id, id);
`);

const KINDS = ['REGISTER', 'REGISTER_WAIT', 'UNREGISTER', 'PROMOTED'];

// never makes the registration itself fail
function log(seasonId, kind, name, playerId) {
  try {
    if (!KINDS.includes(kind) || !name) return;
    db.prepare('INSERT INTO season_activity (season_id, kind, name, player_id) VALUES (?, ?, ?, ?)').run(seasonId, kind, name, playerId || null);
  } catch (err) {
    console.error('[season activity] could not log:', err.message);
  }
}

// the latest lines of an event, oldest first
function latest(seasonId, limit = 40) {
  return db.prepare(`
    SELECT a.id, a.kind, a.name, a.created_at, p.slug FROM season_activity a LEFT JOIN players p ON p.id = a.player_id
    WHERE a.season_id = ? ORDER BY a.id DESC LIMIT ?
  `).all(seasonId, limit).reverse();
}

// the players who dropped out and are not registered again: their last line is UNREGISTER ([{ name, slug, at }], oldest first)
function withdrawn(seasonId, registered) {
  const rows = db.prepare(`
    SELECT a.player_id, a.name, a.created_at, p.slug FROM season_activity a LEFT JOIN players p ON p.id = a.player_id
    WHERE a.season_id = ? AND a.kind = 'UNREGISTER' AND a.id = (
      SELECT MAX(b.id) FROM season_activity b WHERE b.season_id = a.season_id
        AND ((a.player_id IS NOT NULL AND b.player_id = a.player_id) OR (a.player_id IS NULL AND b.player_id IS NULL AND b.name = a.name)))
    ORDER BY a.id
  `).all(seasonId);
  const ids = new Set(registered.map((r) => r.player_id).filter(Boolean));
  const names = new Set(registered.map((r) => String(r.name || '').toLowerCase()));
  return rows.filter((r) => !(r.player_id && ids.has(r.player_id)) && !names.has(String(r.name).toLowerCase()))
    .map((r) => ({ name: r.name, slug: r.slug || null, at: r.created_at }));
}

module.exports = { log, latest, withdrawn };
