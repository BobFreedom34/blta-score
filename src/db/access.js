const { db } = require('./core');

// A single shared code that lets anyone who knows it control live scoring
// on ANY match — the "Referee" button on the match page (see
// routes/referee.js, auth.js's isReferee) — without being a specific
// player or admin. One row, id fixed at 1 (the CHECK enforces that, so a
// stray second INSERT fails loudly instead of silently creating an
// ambiguous second code). No row at all (the normal starting state) means
// the feature is simply off — nobody can log in as referee until an admin
// sets one. Hashed the same way a player's own login_pin is (see hashPin/
// verifyPin in auth.js) rather than stored in plain text, even though it's
// a shared secret rather than a personal one — same reasoning as
// PLAYER_CODE never being logged/stored bare elsewhere in this app.
db.exec(`
  CREATE TABLE IF NOT EXISTS referee_code (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    code_hash TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
`);

// Admin-visible login history (see auth.js's logInPlayer, the single
// choke point every real/first phone login, registration, and PIN reset
// all funnel through — one row per session actually started, not per
// attempt; a wrong code never lands here). player_id has no FK/CASCADE:
// a deleted player's history intentionally stays queryable rather than
// vanishing, same reasoning as match rows already keep their own
// player_id/player2_id after a player is renamed or removed elsewhere.
db.exec(`
  CREATE TABLE IF NOT EXISTS login_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_login_events_player_id ON login_events(player_id);
  CREATE INDEX IF NOT EXISTS idx_login_events_created_at ON login_events(created_at);
`);

// "Looking to play" board (src/routes/availability.js, public/looking-to-play.html)
// — a player posts the days/times they're free for a friendly match, other
// players can join in, and the poster gets notified (see sendPlayRequestEmail
// in mailer.js). One row per player at a time: posting again while a post
// already exists updates it in place rather than creating a second one, and
// idx_availability_posts_player enforces that at the DB level too. There's
// no CLOSED/status column at all — "closing" a post is just deleting its
// row (see DELETE /:id), which also cascades to its joins below (node:sqlite
// doesn't enforce real FK cascades — see the PRAGMA foreign_keys note up
// top — so that cascade is done explicitly in the route, not by the DB).
db.exec(`
  CREATE TABLE IF NOT EXISTS availability_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL REFERENCES players(id),
    -- JSON array of ISO datetime strings — the exact same "When2Meet-style"
    -- hourly-grid representation a match's own proposalSlots use (see
    -- createAvailabilityPicker in common.js and parseSlots in
    -- routes/availability.js), so a viewer picking one of these reuses that
    -- same calendar UI instead of a bespoke one. time_from/time_to below
    -- predate this (an earlier day-of-week design) and are no longer
    -- written — a table-rebuild-free column is easier to just leave unused
    -- than migrate away, and this table has never carried real rows.
    days TEXT NOT NULL,
    time_from TEXT,
    time_to TEXT,
    location TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_availability_posts_player ON availability_posts(player_id);

  -- One row per (post, player) who tapped a time on the post owner's
  -- calendar — the UNIQUE constraint is what makes re-picking idempotent
  -- (see POST /:id/join), so clicking Confirm twice never double-notifies
  -- the post's owner; picking a *different* slot updates this same row
  -- instead of inserting a second one.
  CREATE TABLE IF NOT EXISTS availability_joins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL REFERENCES availability_posts(id),
    player_id INTEGER NOT NULL REFERENCES players(id),
    slot TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(post_id, player_id)
  );
  CREATE INDEX IF NOT EXISTS idx_availability_joins_post ON availability_joins(post_id);
`);

// Predates the `slot` column above (the join used to just be a free-text
// message, no specific time attached) — added the ordinary way in case
// this table already exists somewhere without it. status/deny_reason/
// match_token are later additions too: accept/deny for a join (POST
// /:id/joins/:playerId/accept|deny in routes/availability.js) — a join
// stays PENDING until the post's owner responds. Accepting auto-creates a
// real FRIENDLY/PLANNED match (match_token records which one) and blocks
// that time — plus a few hours after it, see MATCH_BLOCK_HOURS — from
// being offered to anyone else; denying requires deny_reason, sent back
// to the requester by email so they know why, not just that they were
// turned down.
const availabilityJoinColumns = db.prepare('PRAGMA table_info(availability_joins)').all().map((c) => c.name);
if (!availabilityJoinColumns.includes('slot')) {
  db.exec("ALTER TABLE availability_joins ADD COLUMN slot TEXT NOT NULL DEFAULT ''");
}
if (!availabilityJoinColumns.includes('status')) {
  db.exec("ALTER TABLE availability_joins ADD COLUMN status TEXT NOT NULL DEFAULT 'PENDING'");
}
if (!availabilityJoinColumns.includes('deny_reason')) {
  db.exec("ALTER TABLE availability_joins ADD COLUMN deny_reason TEXT NOT NULL DEFAULT ''");
}
if (!availabilityJoinColumns.includes('match_token')) {
  db.exec('ALTER TABLE availability_joins ADD COLUMN match_token TEXT');
}

// JSON array of zero or more of BLTA_CATEGORIES (ELITE/NEXT_GEN/NOVICE,
// see common.js) — which divisions this player is looking for an
// opponent in, shown as the same category badges the rest of the app
// uses (categoryBadge in common.js). Empty means no preference stated.
const availabilityPostColumns = db.prepare('PRAGMA table_info(availability_posts)').all().map((c) => c.name);
if (!availabilityPostColumns.includes('categories')) {
  db.exec("ALTER TABLE availability_posts ADD COLUMN categories TEXT NOT NULL DEFAULT '[]'");
}
// What the post looks for: 'SINGLES' (an opponent) or 'DOUBLES' (a partner for doubles, "Hľadám partnera"). Accepting a DOUBLES join
// makes a pair, not a match (a doubles match needs four players): the owner then creates the match from the board with the pair filled in.
if (!availabilityPostColumns.includes('mode')) {
  db.exec("ALTER TABLE availability_posts ADD COLUMN mode TEXT NOT NULL DEFAULT 'SINGLES'");
}
// the same for the bell notification of a request, so it can say "wants to be your partner"
const playRequestNotificationColumns = db.prepare('PRAGMA table_info(play_request_notifications)').all().map((c) => c.name);
if (!playRequestNotificationColumns.includes('mode')) {
  db.exec("ALTER TABLE play_request_notifications ADD COLUMN mode TEXT NOT NULL DEFAULT 'SINGLES'");
}
