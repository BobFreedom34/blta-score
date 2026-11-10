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

module.exports = { log, latest };
