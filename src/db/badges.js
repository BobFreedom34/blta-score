const { db } = require('./core');

db.exec(`
  CREATE TABLE IF NOT EXISTS badge_definitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    icon TEXT NOT NULL,
    logic_type TEXT NOT NULL,
    threshold INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
`);

// The original table baked the allowed logic types into a CHECK clause;
// that just meant every new badge type (CALENDAR_DATE was the one that
// forced this) needed a table rebuild to widen it. routes/badges.js
// already validates logic_type server-side against its own LOGIC_TYPES
// list, so the CHECK was pure redundancy — drop it once, same
// rebuild-without-CHECK trick as the matches table above, and future
// types need no migration at all. Carries columns forward via PRAGMA
// rather than a hardcoded list.
function badgeDefsTableHasLogicCheck() {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='badge_definitions'").get();
  return !!(row && /CHECK\s*\(\s*logic_type/i.test(row.sql));
}

if (badgeDefsTableHasLogicCheck()) {
  const cols = db.prepare('PRAGMA table_info(badge_definitions)').all().map((c) => c.name).join(', ');
  db.exec('BEGIN');
  try {
    db.exec('ALTER TABLE badge_definitions RENAME TO badge_definitions_old');
    db.exec(`
      CREATE TABLE badge_definitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        icon TEXT NOT NULL,
        logic_type TEXT NOT NULL,
        threshold INTEGER,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `);
    db.exec(`INSERT INTO badge_definitions (${cols}) SELECT ${cols} FROM badge_definitions_old`);
    db.exec('DROP TABLE badge_definitions_old');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Seed the original 10 badges once, the first time this table is empty —
// after that, admins own this data entirely (add/edit/delete via the
// badges admin page), so this never runs again once rows exist.
const badgeCount = db.prepare('SELECT COUNT(*) AS c FROM badge_definitions').get().c;
if (badgeCount === 0) {
  const seedBadge = db.prepare(
    'INSERT INTO badge_definitions (name, description, icon, logic_type, threshold, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
  );
  [
    ['First serve', 'Play your 1st match', '🎾', 'GAMES_PLAYED', 1, 0],
    ['Warm-up complete', 'Play 10 matches', '🔟', 'GAMES_PLAYED', 10, 1],
    ['Marathon player', 'Play 25 matches', '🏃', 'GAMES_PLAYED', 25, 2],
    ['Century club', 'Play 100 matches', '🏆', 'GAMES_PLAYED', 100, 3],
    ['First win', 'Win your 1st match', '⭐', 'WINS', 1, 4],
    ['Hot streak', 'Win 5 matches in a row', '🔥', 'WIN_STREAK', 5, 5],
    ['Bagel baker', 'Win a set 6–0', '🥯', 'BAGEL', null, 6],
    ['Comeback kid', 'Win after losing the 1st set', '🔄', 'COMEBACK', null, 7],
    ['Straight-sets specialist', '10 wins without dropping a set', '⚡', 'STRAIGHT_SETS', 10, 8],
    ['All-rounder', 'Win a match in Elite, Next Gen and Novice', '👑', 'CATEGORY_SWEEP', null, 9],
  ].forEach((row) => seedBadge.run(...row));
}

// One row per badge a player has ever earned — the moment it's recorded
// (not just "do they currently qualify", which src/badgeEngine.js can
// already tell you by recomputing from match history any time) is what
// makes a notification bell possible at all. Written by
// badgeEngine.syncPlayerBadges() right after a match actually finishes
// (see src/routes/matches.js), and once more, in bulk, by
// badgeEngine.backfillIfNeeded() the very first time this table is empty
// — that backfill marks everything a player already holds as seen=1, so
// shipping this feature doesn't retroactively "notify" the whole league
// about badges they've held for months. seen flips to 1 the moment the
// player opens that specific notification (see routes/player.js).
//
// Every other logic type earns at most once ever, so earned_year stays
// NULL for those rows. A CALENDAR_DATE badge is different — it's tied to a
// specific day that comes back every year, so playing on it in 2025 and
// again in 2026 is two separate earns, each its own row (and its own
// congrats notification) — see computeEarnedBadgeInstances in
// badgeEngine.js. earned_year is what row this is for.
db.exec(`
  CREATE TABLE IF NOT EXISTS player_badges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    badge_id INTEGER NOT NULL,
    seen INTEGER NOT NULL DEFAULT 0,
    earned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_player_badges_player ON player_badges(player_id);
`);
const playerBadgeColumns = db.prepare('PRAGMA table_info(player_badges)').all().map((c) => c.name);
if (!playerBadgeColumns.includes('earned_year')) {
  db.exec('ALTER TABLE player_badges ADD COLUMN earned_year INTEGER');
}
// COALESCE(earned_year, 0) instead of plain earned_year: SQL treats NULLs
// as distinct from each other in a unique index, so a bare
// (player_id, badge_id, earned_year) index would happily let a
// non-repeatable badge (earned_year always NULL) get a duplicate row —
// the exact bug this index exists to prevent for those. 0 is a safe
// stand-in since no real earned_year is ever 0.
db.exec('DROP INDEX IF EXISTS idx_player_badges_unique');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_player_badges_unique ON player_badges(player_id, badge_id, COALESCE(earned_year, 0))');
