const { db } = require('./core');

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

// Automatic push of the bell and of direct messages (src/playerPush.js): one row per device of a player. The endpoint is unique, so a phone
// that is shared by two players belongs to the one who turned push on last. player_push_log is only written when PUSH_DRY_RUN=1 (the tests).
db.exec(`
  CREATE TABLE IF NOT EXISTS player_push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    subscription TEXT NOT NULL,
    lang TEXT NOT NULL DEFAULT 'sk',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_player_push_subscriptions_player ON player_push_subscriptions(player_id);
  CREATE TABLE IF NOT EXISTS player_push_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    endpoint TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
`);

// SQLite silently rewrites OTHER tables' foreign-key clauses to follow a
// renamed table — so every "ALTER TABLE matches RENAME TO matches_old ...
// DROP TABLE matches_old" rebuild above (there'll be more of these over
// time) leaves messages/match_notifications/push_subscriptions pointing at
// a "matches_old" that no longer exists, even though their own table name
// never changed. Nothing breaks until something resolves that reference —
// then every query against the affected table fails with a "no such
// table: main.matches_old" error. Self-heals it on every startup (a no-op
// once fixed) rather than a one-time guarded migration, since a future
// matches-table rebuild would just reintroduce the same dangling reference.
function fixDanglingMatchesOldReference(tableName, createSql, indexSqls) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(tableName);
  if (!row || !/matches_old/i.test(row.sql)) return;
  const brokenName = `${tableName}_broken`;
  const cols = db.prepare(`PRAGMA table_info(${tableName})`).all().map((c) => c.name).join(', ');
  db.exec('BEGIN');
  try {
    db.exec(`ALTER TABLE ${tableName} RENAME TO ${brokenName}`);
    db.exec(createSql);
    db.exec(`INSERT INTO ${tableName} (${cols}) SELECT ${cols} FROM ${brokenName}`);
    db.exec(`DROP TABLE ${brokenName}`);
    indexSqls.forEach((sql) => db.exec(sql));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

fixDanglingMatchesOldReference(
  'messages',
  `CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL REFERENCES matches(id),
    author TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,
  ['CREATE INDEX IF NOT EXISTS idx_messages_match_id ON messages(match_id)'],
);
fixDanglingMatchesOldReference(
  'match_notifications',
  `CREATE TABLE match_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL REFERENCES matches(id),
    email TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('START','FINISH')),
    sent INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,
  [
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_match_notifications_unique ON match_notifications(match_id, email, type)',
    'CREATE INDEX IF NOT EXISTS idx_match_notifications_match_id ON match_notifications(match_id)',
  ],
);
fixDanglingMatchesOldReference(
  'push_subscriptions',
  `CREATE TABLE push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL REFERENCES matches(id),
    subscription TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('START','FINISH')),
    sent INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`,
  [
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_unique ON push_subscriptions(match_id, subscription, type)',
    'CREATE INDEX IF NOT EXISTS idx_push_subscriptions_match_id ON push_subscriptions(match_id)',
  ],
);
