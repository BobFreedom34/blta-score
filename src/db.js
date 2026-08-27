const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

// DATA_DIR lets a hosting platform point this at a mounted persistent disk
// (e.g. Render). Defaults to the local ./data folder for local dev and VPS use.
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'blta-score.db'));
db.exec('PRAGMA journal_mode = WAL');
// Exposed so anything else that needs to write to the persistent disk
// (e.g. uploaded badge icons) uses the same directory as the DB itself,
// rather than public/ which gets replaced fresh on every deploy.
db.dataDir = dataDir;

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    share_token TEXT,
    category TEXT NOT NULL,
    player1_id INTEGER NOT NULL REFERENCES players(id),
    player2_id INTEGER NOT NULL REFERENCES players(id),
    location TEXT NOT NULL DEFAULT '',
    scheduled_at TEXT,
    format TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','LIVE','FINISHED')),
    state TEXT NOT NULL,
    history TEXT NOT NULL DEFAULT '[]',
    winner_id INTEGER,
    start_time TEXT,
    end_time TEXT,
    notified INTEGER NOT NULL DEFAULT 0,
    created_by_admin INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    paused_at TEXT,
    paused_seconds INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
`);

// --- Migrations for databases created before share_token / the FRIENDLY category existed ---

const MATCH_COLUMNS = [
  'id', 'category', 'player1_id', 'player2_id', 'location', 'scheduled_at', 'format',
  'status', 'state', 'history', 'winner_id', 'start_time', 'end_time', 'notified',
  'created_at', 'updated_at',
];

function matchesTableHasOldCategoryCheck() {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='matches'").get();
  return !!(row && /CHECK\s*\(\s*category/i.test(row.sql));
}

// SQLite can't drop/alter a CHECK constraint in place, so rebuild the table without it.
// This runs only once per database, the first time it's needed.
function rebuildMatchesTableWithoutCategoryCheck() {
  const oldColumns = db.prepare('PRAGMA table_info(matches)').all().map((c) => c.name);
  const hasShareToken = oldColumns.includes('share_token');
  const selectCols = hasShareToken ? ['share_token', ...MATCH_COLUMNS] : MATCH_COLUMNS;
  const insertCols = hasShareToken ? ['share_token', ...MATCH_COLUMNS] : MATCH_COLUMNS;

  db.exec('BEGIN');
  try {
    db.exec('ALTER TABLE matches RENAME TO matches_old');
    db.exec(`
      CREATE TABLE matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        share_token TEXT,
        category TEXT NOT NULL,
        player1_id INTEGER NOT NULL REFERENCES players(id),
        player2_id INTEGER NOT NULL REFERENCES players(id),
        location TEXT NOT NULL DEFAULT '',
        scheduled_at TEXT,
        format TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','LIVE','FINISHED')),
        state TEXT NOT NULL,
        history TEXT NOT NULL DEFAULT '[]',
        winner_id INTEGER,
        start_time TEXT,
        end_time TEXT,
        notified INTEGER NOT NULL DEFAULT 0,
        created_by_admin INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `);
    db.exec(`
      INSERT INTO matches (${insertCols.join(', ')})
      SELECT ${selectCols.join(', ')} FROM matches_old
    `);
    db.exec('DROP TABLE matches_old');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

if (matchesTableHasOldCategoryCheck()) {
  rebuildMatchesTableWithoutCategoryCheck();
}

const matchColumns = db.prepare('PRAGMA table_info(matches)').all().map((c) => c.name);
if (!matchColumns.includes('share_token')) {
  db.exec('ALTER TABLE matches ADD COLUMN share_token TEXT');
}
if (!matchColumns.includes('created_by_admin')) {
  db.exec('ALTER TABLE matches ADD COLUMN created_by_admin INTEGER NOT NULL DEFAULT 0');
}
if (!matchColumns.includes('notes')) {
  db.exec("ALTER TABLE matches ADD COLUMN notes TEXT NOT NULL DEFAULT ''");
}
if (!matchColumns.includes('paused_at')) {
  db.exec('ALTER TABLE matches ADD COLUMN paused_at TEXT');
}
if (!matchColumns.includes('paused_seconds')) {
  db.exec('ALTER TABLE matches ADD COLUMN paused_seconds INTEGER NOT NULL DEFAULT 0');
}
if (!matchColumns.includes('first_server')) {
  db.exec('ALTER TABLE matches ADD COLUMN first_server INTEGER');
}
if (!matchColumns.includes('end_reason')) {
  db.exec('ALTER TABLE matches ADD COLUMN end_reason TEXT');
}

const playerColumns = db.prepare('PRAGMA table_info(players)').all().map((c) => c.name);
if (!playerColumns.includes('photo_url')) {
  db.exec('ALTER TABLE players ADD COLUMN photo_url TEXT');
}
if (!playerColumns.includes('slug')) {
  db.exec('ALTER TABLE players ADD COLUMN slug TEXT');
}
// Optional bio fields shown on the player's profile page, below their
// photo — editable by any logged-in player or admin, all nullable since
// most players won't have every field filled in.
[
  'category TEXT',
  'forehand TEXT',
  'backhand TEXT',
  'racket TEXT',
  'string_brand TEXT',
  'string_tension TEXT',
  'seasons TEXT',
  'nationality TEXT',
  'birthday TEXT',
  'favorite_player TEXT',
  // Unlike the fields above, these are never shown on the public profile —
  // only to a logged-in player/admin (see the /:id endpoint in players.js).
  'phone TEXT',
  'email TEXT',
].forEach((colDef) => {
  const colName = colDef.split(' ')[0];
  if (!playerColumns.includes(colName)) {
    db.exec(`ALTER TABLE players ADD COLUMN ${colDef}`);
  }
});
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_players_slug ON players(slug)');

// Backfills a URL-friendly slug (surname-based, e.g. "sloboda") for any
// player that doesn't have one yet — new players, and every existing one
// the first time this migration runs. Player profile links use this
// instead of the numeric id; old numeric links still resolve too (see
// findPlayerByIdOrSlug in routes/players.js).
function slugifyForBackfill(str) {
  return str.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
const playersNeedingSlug = db.prepare('SELECT id, name FROM players WHERE slug IS NULL').all();
if (playersNeedingSlug.length > 0) {
  const existingSlugs = new Set(db.prepare('SELECT slug FROM players WHERE slug IS NOT NULL').all().map((r) => r.slug));
  const setSlug = db.prepare('UPDATE players SET slug = ? WHERE id = ?');
  playersNeedingSlug.forEach((p) => {
    const parts = p.name.trim().split(/\s+/);
    const surname = parts[parts.length - 1];
    const base = slugifyForBackfill(surname) || slugifyForBackfill(p.name) || 'player';
    let slug = base;
    let n = 2;
    while (existingSlugs.has(slug)) {
      slug = `${base}-${n}`;
      n += 1;
    }
    existingSlugs.add(slug);
    setSlug.run(slug, p.id);
  });
}

const untokenized = db.prepare('SELECT id FROM matches WHERE share_token IS NULL').all();
if (untokenized.length > 0) {
  const setToken = db.prepare('UPDATE matches SET share_token = ? WHERE id = ?');
  for (const row of untokenized) {
    setToken.run(crypto.randomUUID(), row.id);
  }
}

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
  CREATE INDEX IF NOT EXISTS idx_matches_category ON matches(category);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_share_token ON matches(share_token);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL REFERENCES matches(id),
    author TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_messages_match_id ON messages(match_id);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS match_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL REFERENCES matches(id),
    email TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('START','FINISH')),
    sent INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_match_notifications_unique ON match_notifications(match_id, email, type);
  CREATE INDEX IF NOT EXISTS idx_match_notifications_match_id ON match_notifications(match_id);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL REFERENCES matches(id),
    subscription TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('START','FINISH')),
    sent INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_unique ON push_subscriptions(match_id, subscription, type);
  CREATE INDEX IF NOT EXISTS idx_push_subscriptions_match_id ON push_subscriptions(match_id);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS badge_definitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    icon TEXT NOT NULL,
    logic_type TEXT NOT NULL CHECK (logic_type IN ('GAMES_PLAYED','WINS','WIN_STREAK','CATEGORY_SWEEP','BAGEL','COMEBACK','STRAIGHT_SETS')),
    threshold INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
`);

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

module.exports = db;
