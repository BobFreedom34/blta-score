const { db } = require('./core');

// One row per (player, chat message) — both players in a match get one of
// these the instant anyone posts to that match's public chat (see
// POST /:token/messages in routes/matches.js), same "record the moment,
// not just the current state" idea as player_badges above, and shown
// alongside it in the same notification bell (GET /player/notifications
// merges both tables — see routes/player.js). No backfill needed here the
// way player_badges got one: this table starts truly empty, so there's no
// existing chat history to retroactively notify anyone about.
db.exec(`
  CREATE TABLE IF NOT EXISTS chat_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    match_id INTEGER NOT NULL,
    message_id INTEGER NOT NULL,
    seen INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_chat_notifications_player ON chat_notifications(player_id);
`);

// Photos of a match, stored in Google Drive (see drivePhotos.js) — only the Drive file id lives here, never the picture itself.
// uploaded_by_player_id is NULL when an admin added it (an admin is not a player, same as the bare player ids elsewhere in this file).
// photo_notifications: one row per "a photo was added to your match" for the other player, shown in the same bell as the other
// notification types; same shape as chat_notifications above, with photo_id in place of message_id.
db.exec(`
  CREATE TABLE IF NOT EXISTS match_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL,
    drive_file_id TEXT NOT NULL,
    uploaded_by_player_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_match_photos_match ON match_photos(match_id);

  -- the gallery of a tournament or a season (its tab Galéria): photos of the event itself, in the same Drive folder as the match photos (src/routes/seasonPhotos.js)
  CREATE TABLE IF NOT EXISTS season_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    season_id INTEGER NOT NULL,
    drive_file_id TEXT NOT NULL,
    uploaded_by_player_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_season_photos_season ON season_photos(season_id);

  CREATE TABLE IF NOT EXISTS photo_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    match_id INTEGER NOT NULL,
    photo_id INTEGER NOT NULL,
    seen INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_photo_notifications_player ON photo_notifications(player_id);
`);

// One row per "someone picked a time on your looking-to-play post" (see
// POST /availability/:id/join in routes/availability.js), shown alongside
// player_badges/chat_notifications in the same notification bell (GET
// /player/notifications). Deliberately denormalized (joiner_player_id +
// slot + message copied straight in, not just a post_id to join back
// against) rather than referencing availability_posts — a post can be
// deleted outright once it expires or the owner closes it (see
// pruneExpiredPosts in routes/availability.js), and this notification
// should keep reading fine after that, same as a real email already would.
db.exec(`
  CREATE TABLE IF NOT EXISTS play_request_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    joiner_player_id INTEGER NOT NULL,
    slot TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    seen INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_play_request_notifications_player ON play_request_notifications(player_id);
`);

// One row per "someone proposed times for a match" or "your proposed time
// was confirmed" (see inferProposedBy and its call sites, and
// POST /:token/respond-proposal, in routes/matches.js), shown alongside
// the other notification types in the same bell. kind distinguishes the
// two ('RECEIVED' vs 'CONFIRMED'); other_player_id is who proposed (for a
// RECEIVED row) or who confirmed (for a CONFIRMED row) — not required to
// still exist as a player by the time this is read, same spirit as
// chat_notifications' bare match_id (an unresolvable player_id just means
// the click-through/name lookup quietly falls back). References match_id
// rather than copying the match's own details in, unlike
// play_request_notifications — a match is far less likely to be deleted
// out from under this than a looking-to-play post is (see that table's own
// comment for why it went the other way), so a plain INNER JOIN in
// GET /player/notifications is enough there: if the match is ever gone,
// the notification just quietly stops showing up. countUnreadNotifications
// (routes/player.js) has to apply that same JOIN too, though, or a
// deleted match's still-unseen row inflates the bell's count forever with
// nothing left in the list to click and clear it (a real bug this once
// was — the count and the list disagreeing is what actually surfaced it).
db.exec(`
  CREATE TABLE IF NOT EXISTS proposal_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    match_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    other_player_id INTEGER,
    seen INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_proposal_notifications_player ON proposal_notifications(player_id);
`);

// The ranking tables of this app (src/rankingPoints.js): one row per table and player — BLTA overall, the three race tables
// (Elite / Next Gen / Novice) and Tournaments. They started as a copy of blta.sk's tables (src/rankingsBaseline.json, loaded
// once by src/rankingsSeed.js) and are kept up to date by the app itself: a finished BLTA match adds its points, a
// correction / restart / delete takes exactly those points back (ranking_awards is the ledger of what each match added).
// points NULL = "no points yet" (shown as a dash). position = the order the row had when it came in, the tie-break.
db.exec(`
  CREATE TABLE IF NOT EXISTS ranking_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_key TEXT NOT NULL,
    player_id INTEGER,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL,
    points INTEGER,
    matches INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_ranking_entries_unique ON ranking_entries(table_key, name_key);
  CREATE INDEX IF NOT EXISTS idx_ranking_entries_player ON ranking_entries(player_id);
  CREATE TABLE IF NOT EXISTS ranking_awards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL,
    entry_id INTEGER NOT NULL,
    points INTEGER NOT NULL,
    matches_delta INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_ranking_awards_match ON ranking_awards(match_id);
`);

// Admin overrides of the old, scraped rankings page: no longer used. The ones that existed when the app switched to its own
// tables were applied to them once (src/rankingsSeed.js); the table is kept only so that import can read it.
db.exec(`
  CREATE TABLE IF NOT EXISTS ranking_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_key TEXT NOT NULL,
    player_name TEXT NOT NULL,
    points INTEGER,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_ranking_overrides_unique ON ranking_overrides(table_key, player_name COLLATE NOCASE);
`);

// One row per (table, player, week) — an append-only weekly history, not
// just the latest snapshot: it's both the baseline the "moved up/down N
// places" arrow on the rankings page compares this week's rank against
// (see src/rankingSnapshots.js), and the source for a player's rank-trend
// chart on their profile page. A new week's row is added (never
// overwriting an older one) once a week, matching how blta.sk itself only
// republishes standings on Mondays.
db.exec(`
  CREATE TABLE IF NOT EXISTS ranking_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_key TEXT NOT NULL,
    player_name TEXT NOT NULL,
    rank INTEGER NOT NULL,
    snapshot_week TEXT NOT NULL
  );
  DROP INDEX IF EXISTS idx_ranking_snapshots_unique;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_ranking_snapshots_unique ON ranking_snapshots(table_key, player_name COLLATE NOCASE, snapshot_week);
`);

// One row per "you moved N places in the ranking" bell notification — see
// getMoves()'s isNewWeek flag in rankingSnapshots.js, which is what
// actually triggers this (the moment a new week's snapshot is recorded,
// not every mid-week /api/rankings request the live arrows also react
// to — see that file's own comment for why those two are different
// cadences on purpose). Only ever written for the main "blta" table (see
// routes/rankings.js), matching the feature's own scope, but table_key is
// still stored rather than assumed, in case that ever widens. No FK to
// ranking_snapshots itself — direction/amount/new_rank are copied straight
// in (same reasoning as play_request_notifications' own denormalization)
// so this reads back fine forever regardless of how many more weeks of
// snapshots pile up after it. The unique index guards the same rare
// concurrent-first-request-of-the-week race ranking_snapshots' own index
// does — see getMoves.
db.exec(`
  CREATE TABLE IF NOT EXISTS ranking_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    table_key TEXT NOT NULL,
    direction TEXT NOT NULL,
    amount INTEGER NOT NULL,
    new_rank INTEGER NOT NULL,
    snapshot_week TEXT NOT NULL,
    seen INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_ranking_notifications_player ON ranking_notifications(player_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_ranking_notifications_unique ON ranking_notifications(player_id, table_key, snapshot_week);
`);

// One row per "a CALENDAR_DATE badge's target day is 3 days away and you
// don't have it yet" bell notification — see sendCalendarDateReminders in
// badgeEngine.js, which is what actually writes these (a daily check, not
// triggered by any player/match action the way every other notification
// table here is). target_year is what makes the unique index below allow
// the SAME badge to remind the SAME player again next year if they still
// haven't earned it by then — a CALENDAR_DATE badge's threshold is only
// ever a bare MMDD (see badge_definitions), it repeats every year, so
// "already notified" has to be scoped per year too, not just per badge.
db.exec(`
  CREATE TABLE IF NOT EXISTS badge_reminder_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    badge_id INTEGER NOT NULL,
    target_year INTEGER NOT NULL,
    seen INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_badge_reminder_notifications_player ON badge_reminder_notifications(player_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_badge_reminder_notifications_unique ON badge_reminder_notifications(player_id, badge_id, target_year);
`);
