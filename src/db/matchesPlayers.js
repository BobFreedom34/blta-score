const crypto = require('crypto');
const { db } = require('./core');

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

function matchesTableHasStatusCheck() {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='matches'").get();
  return !!(row && /CHECK\s*\(\s*status/i.test(row.sql));
}

// Same rebuild-without-CHECK trick as above, this time for status — added
// to allow the new UNFINISHED status (a live match that had to stop, e.g.
// the court booking ran out, with no winner decided) without being locked
// to the original PLANNED/LIVE/FINISHED list. Reads the table's actual
// current columns via PRAGMA (not a hardcoded list) so it safely carries
// forward every column added by later migrations below, whatever they are.
function rebuildMatchesTableWithoutStatusCheck() {
  const oldColumns = db.prepare('PRAGMA table_info(matches)').all().map((c) => c.name);
  const cols = oldColumns.join(', ');

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
        status TEXT NOT NULL DEFAULT 'PLANNED',
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
        first_server INTEGER,
        end_reason TEXT,
        created_by_anonymous INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `);
    db.exec(`INSERT INTO matches (${cols}) SELECT ${cols} FROM matches_old`);
    db.exec('DROP TABLE matches_old');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

if (matchesTableHasStatusCheck()) {
  rebuildMatchesTableWithoutStatusCheck();
}

const matchColumns = db.prepare('PRAGMA table_info(matches)').all().map((c) => c.name);
if (!matchColumns.includes('share_token')) {
  db.exec('ALTER TABLE matches ADD COLUMN share_token TEXT');
}
if (!matchColumns.includes('created_by_admin')) {
  db.exec('ALTER TABLE matches ADD COLUMN created_by_admin INTEGER NOT NULL DEFAULT 0');
}
// Historical only — marked a match created by the anonymous login tier
// (its own shared code, ANON_CODE), which has since been removed entirely.
// Always 0 for any match created from here on; checkMatchAccess in
// routes/matches.js still reads it for existing rows that predate removal.
if (!matchColumns.includes('created_by_anonymous')) {
  db.exec('ALTER TABLE matches ADD COLUMN created_by_anonymous INTEGER NOT NULL DEFAULT 0');
}
// Which specific player (by id, not just "some player") created this match
// while logged in as themselves — set only for a real per-player login, not
// admin (see checkMatchAccess in routes/matches.js: a player can manage a
// match they play in only if it's admin-created, but any match they
// created themselves regardless of who's playing in it).
if (!matchColumns.includes('created_by_player_id')) {
  db.exec('ALTER TABLE matches ADD COLUMN created_by_player_id INTEGER');
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
// Doubles (štvorhra): a doubles match is a normal match whose two sides have a second player each. player1_id / player2_id stay the FIRST
// player of each side (so every singles query keeps working), player1b_id / player2b_id are the partners, is_doubles marks the match.
if (!matchColumns.includes('is_doubles')) {
  db.exec('ALTER TABLE matches ADD COLUMN is_doubles INTEGER NOT NULL DEFAULT 0');
}
if (!matchColumns.includes('player1b_id')) {
  db.exec('ALTER TABLE matches ADD COLUMN player1b_id INTEGER');
}
if (!matchColumns.includes('player2b_id')) {
  db.exec('ALTER TABLE matches ADD COLUMN player2b_id INTEGER');
}
db.exec('CREATE INDEX IF NOT EXISTS idx_matches_doubles ON matches(is_doubles, status)');
// Who's bringing the balls — 1 or 2 (player1/player2), set at match
// creation and shown as a small marker on the match card while it's still
// PLANNED (see the balls-icon rendering in common.js). NULL means nobody
// picked, same as first_server.
if (!matchColumns.includes('balls_player')) {
  db.exec('ALTER TABLE matches ADD COLUMN balls_player INTEGER');
}
// A "propose times" match: the creator picks several candidate start times
// (JSON array of ISO strings) and preferred venues (JSON array of strings)
// instead of one fixed date/location; the other player then picks one of
// each via a public (no-login) link — see POST /:token/respond-proposal.
// Both stay set after resolution as a record of what was offered, same as
// how a real date/location just get filled in on the match once resolved.
if (!matchColumns.includes('proposal_slots')) {
  db.exec('ALTER TABLE matches ADD COLUMN proposal_slots TEXT');
}
if (!matchColumns.includes('proposal_venues')) {
  db.exec('ALTER TABLE matches ADD COLUMN proposal_venues TEXT');
}
// Optional — the creator's email for a "propose times" match, used only to
// notify them once the other player confirms a slot/venue (see
// POST /:token/respond-proposal). Never returned by GET /matches — same
// privacy treatment as match_notifications.email, which also never appears
// in a serialized match.
if (!matchColumns.includes('proposal_notify_email')) {
  db.exec('ALTER TABLE matches ADD COLUMN proposal_notify_email TEXT');
}
// Which of player1/player2 (1 or 2) proposed proposal_slots/proposal_venues
// — shown on its "Pick a time" card so the other player knows who they're
// responding to. Same 1/2/null shape as balls_player.
if (!matchColumns.includes('proposed_by')) {
  db.exec('ALTER TABLE matches ADD COLUMN proposed_by INTEGER');
}
// A second, independent proposal — once the other player counter-proposes
// (see POST /:token/counter-propose) instead of just picking one of the
// first player's offered slots, both calendars stay up on the match page
// side by side rather than one replacing the other, and either one can
// still be confirmed via POST /:token/respond-proposal. Same shape as the
// proposal_slots/proposal_venues/proposed_by/proposal_notify_email set
// above, just for this second offer.
if (!matchColumns.includes('counter_proposal_slots')) {
  db.exec('ALTER TABLE matches ADD COLUMN counter_proposal_slots TEXT');
}
if (!matchColumns.includes('counter_proposal_venues')) {
  db.exec('ALTER TABLE matches ADD COLUMN counter_proposal_venues TEXT');
}
if (!matchColumns.includes('counter_proposal_notify_email')) {
  db.exec('ALTER TABLE matches ADD COLUMN counter_proposal_notify_email TEXT');
}
if (!matchColumns.includes('counter_proposed_by')) {
  db.exec('ALTER TABLE matches ADD COLUMN counter_proposed_by INTEGER');
}
// Who's reserving the court — 1 or 2 (player1/player2), set at match
// creation and shown as a small marker on the match card while it's still
// PLANNED (see the court-icon rendering in common.js). Same 1/2/null shape
// as balls_player — NULL means nobody picked.
if (!matchColumns.includes('court_player')) {
  db.exec('ALTER TABLE matches ADD COLUMN court_player INTEGER');
}
// blta.sk's own League field (e.g. "Autumn Finals Series 2026") — separate
// from this app's own `category` (ELITE/NEXT_GEN/NOVICE/etc.), and only
// ever set for those three "official BLTA league" categories in the first
// place. Backend-only for now (no UI reads it yet): written by the
// sync-match-league skill, which looks each match up on its blta.sk event
// page since this isn't something an admin enters by hand. NULL means not
// synced yet, same as any other not-yet-backfilled column here.
if (!matchColumns.includes('league')) {
  db.exec('ALTER TABLE matches ADD COLUMN league TEXT');
}

// The YouTube video of the match (a live stream or a recording), set by the admin only (PATCH /api/matches/:token/video): kept as the normal
// watch address; the match page shows it embedded and the match cards get a "Live video" pill. NULL = no video.
if (!matchColumns.includes('video_url')) {
  db.exec('ALTER TABLE matches ADD COLUMN video_url TEXT');
}

// Left over from the time the ranking points were sent to blta.sk: a snapshot (JSON) of what was awarded for this match there,
// or NULL. Nothing writes it any more — the app keeps its own ledger (ranking_awards, see src/rankingPoints.js). It is read
// once, by src/rankingsSeed.js, to tell which matches already had their points when the app took over the ranking tables.
if (!matchColumns.includes('ranking_points_snapshot')) {
  db.exec('ALTER TABLE matches ADD COLUMN ranking_points_snapshot TEXT');
}

const playerColumns = db.prepare('PRAGMA table_info(players)').all().map((c) => c.name);
if (!playerColumns.includes('photo_url')) {
  db.exec('ALTER TABLE players ADD COLUMN photo_url TEXT');
}
// a player who is left out of "Hráči mesiaca" (the player of the month and the biggest courtIQ progress on the home page): a switch on the player in the
// Players page
if (!playerColumns.includes('no_highlights')) {
  db.exec('ALTER TABLE players ADD COLUMN no_highlights INTEGER NOT NULL DEFAULT 0');
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
  // Unlike the fields above, these are never shown on the public profile.
  // phone additionally doubles as this player's login credential (see
  // auth.js/routes/player.js) — admin-only to view or edit (routes/players.js),
  // unique when set (see idx_players_phone below). email stays visible to
  // any logged-in player or admin, same as before.
  'phone TEXT',
  'email TEXT',
  // "<salt>:<hash>" (see hashPin in src/auth.js) — the 5-digit code a
  // player sets up right after their first phone-only login, required
  // alongside their phone number on every login after that. NULL means no
  // code yet: either a genuinely new player, or an existing one who hasn't
  // logged in again since this feature shipped — either way they're
  // prompted to create one on their next successful phone login (see
  // POST /player/login's pinSetupRequired). Admin-only to view or clear
  // (routes/players.js's reset-login-pin), same tier as phone above.
  'login_pin TEXT',
  // Consecutive wrong codes since the last successful login (see
  // MAX_PIN_ATTEMPTS in routes/player.js) — resets to 0 on a correct login,
  // an email/token reset, or an admin's reset-login-pin. At the max, login
  // is refused outright even for the *correct* code, until one of those
  // three clears it — this is what actually enforces the 5-attempt limit,
  // not just a UI warning.
  'failed_pin_attempts INTEGER NOT NULL DEFAULT 0',
  // Self-service "forgot my code" (POST /player/forgot-pin sets these,
  // POST /player/reset-pin consumes them): a random token emailed as a
  // link, valid only until reset_token_expires and only for one use — both
  // columns are cleared the moment the token is used, or replaced outright
  // by requesting a new one. NULL/NULL when no reset is pending.
  'reset_token TEXT',
  'reset_token_expires TEXT',
  // Historical only — marked a player auto-created by the anonymous login
  // tier (see created_by_anonymous on matches), which has since been
  // removed entirely. Always 0 for any player created from here on.
  'created_by_anonymous INTEGER NOT NULL DEFAULT 0',
  // Admin-only "hide from the Players directory" toggle (routes/players.js's
  // PATCH /:id/hidden) — e.g. for an inactive/duplicate player cluttering
  // the alphabetical list. Deliberately narrow in scope: the player, their
  // matches, and their rankings/badges are completely unaffected, and an
  // admin still sees (and can unhide) them on the Players page — this only
  // removes them from what a logged-out/non-admin visitor sees there.
  'hidden INTEGER NOT NULL DEFAULT 0',
  // The level the player says they play at, chosen when they register (NOVICE = beginner, NEXT_GEN = intermediate/advanced, ELITE = very advanced). Their own word, not the division an admin
  // puts them in (`category` above): shown to logged-in players and admins like phone/email, never to a visitor (see stripPrivateFields in src/auth.js).
  'tennis_level TEXT',
].forEach((colDef) => {
  const colName = colDef.split(' ')[0];
  if (!playerColumns.includes(colName)) {
    db.exec(`ALTER TABLE players ADD COLUMN ${colDef}`);
  }
});
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_players_slug ON players(slug)');
// Partial (only enforced once a phone is actually set) so the many players
// without one yet don't collide on NULL — SQLite doesn't treat NULLs as
// equal for uniqueness anyway, but being explicit here matches the intent.
//
// Wrapped in try/catch: this app already had real, admin-entered phone
// numbers before this login system existed, in inconsistent formats — if
// two of those happen to collide exactly, creating the index throws. That
// must never crash the whole server on boot (it did once, in production)
// — log it clearly instead so an admin can resolve the actual duplicate
// via the Players page; the index quietly gets created on a later boot
// once the data no longer collides.
try {
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_players_phone ON players(phone) WHERE phone IS NOT NULL');
} catch (err) {
  console.error('[db] Could not create unique index on players.phone — two players likely have the exact same phone number on file already. Fix it from the Players page (admin), then this resolves itself on the next deploy/restart. Error:', err.message);
}

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
