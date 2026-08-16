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

module.exports = db;
