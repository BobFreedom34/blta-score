const { db } = require('./core');

// League seasons ("Autumn Finals Series 2026") and their groups ("Babolat", "Technifibre"…). Every group belongs
// to one BLTA category, and a match (BLTA categories only) can be tagged with a season and a group — set by an
// admin, or once by seasonSeed.js for the matches that already existed. The group tables are calculated from these.
db.exec(`
  CREATE TABLE IF NOT EXISTS seasons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    start_date TEXT,
    end_date TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
`);
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_seasons_slug ON seasons(slug)');
// the addresses a season had before it was renamed (the address follows the name): an old link is sent to the new address (server.js), the data
// is found by the old one too (routes/seasons/info.js), and the one-off seeds still find their season after a rename
db.exec('CREATE TABLE IF NOT EXISTS season_old_slugs (slug TEXT PRIMARY KEY, season_id INTEGER NOT NULL)');
db.exec(`
  CREATE TABLE IF NOT EXISTS season_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('ELITE', 'NEXT_GEN', 'NOVICE')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE (season_id, name)
  );
`);
// A tournament has a category of its own for doubles (DOUBLES, "Štvorhra", with groups and brackets like the others), so the groups table may no
// longer limit the category to the three league ones. SQLite cannot drop a CHECK: the table is rebuilt once, the new one is made, filled, the old
// one dropped and the new one renamed (the other tables point at the NAME season_groups, which is the new table again at the end).
{
  const old = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'season_groups'").get();
  if (old && /CHECK\s*\(\s*category\s+IN/i.test(old.sql)) {
    const cols = db.prepare('PRAGMA table_info(season_groups)').all().map((c) => c.name).join(', ');
    const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'season_groups' AND sql IS NOT NULL").all().map((r) => r.sql);
    const fresh = old.sql.replace(/\s*CHECK\s*\(\s*category\s+IN\s*\([^)]*\)\s*\)/i, '').replace(/CREATE TABLE\s+(IF NOT EXISTS\s+)?["']?season_groups["']?/i, 'CREATE TABLE season_groups_new');
    db.exec('BEGIN');
    try {
      db.exec(fresh);
      db.exec(`INSERT INTO season_groups_new (${cols}) SELECT ${cols} FROM season_groups`);
      db.exec('DROP TABLE season_groups');
      db.exec('ALTER TABLE season_groups_new RENAME TO season_groups');
      indexes.forEach((sql) => db.exec(sql));
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}
const matchSeasonColumns = db.prepare('PRAGMA table_info(matches)').all().map((c) => c.name);
if (!matchSeasonColumns.includes('season_id')) {
  db.exec('ALTER TABLE matches ADD COLUMN season_id INTEGER REFERENCES seasons(id) ON DELETE SET NULL');
}
if (!matchSeasonColumns.includes('group_id')) {
  db.exec('ALTER TABLE matches ADD COLUMN group_id INTEGER REFERENCES season_groups(id) ON DELETE SET NULL');
}
// 'GROUP' = a group-stage match (counts in the group table), 'PLAYOFF' = a play-off match (never counts in it).
// Every existing match is GROUP; an admin marks play-off matches from the current season on.
if (!matchSeasonColumns.includes('stage')) {
  db.exec("ALTER TABLE matches ADD COLUMN stage TEXT NOT NULL DEFAULT 'GROUP'");
}

// A doubles draw (is_doubles): every entrant is a pair. The tree keeps ONE player id per slot (the first player of the pair, the "captain"),
// so the seeding, byes and advancing of src/bracketEngine.js stay exactly as they are for singles; bracket_partners says who plays with whom in
// this draw, and the matches the draw creates are doubles matches (see maybeCreateMatch).
if (!db.prepare('PRAGMA table_info(brackets)').all().some((c) => c.name === 'is_doubles')) {
  db.exec('ALTER TABLE brackets ADD COLUMN is_doubles INTEGER NOT NULL DEFAULT 0');
}
db.exec(`
  CREATE TABLE IF NOT EXISTS bracket_partners (
    bracket_id INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    partner_id INTEGER NOT NULL,
    PRIMARY KEY (bracket_id, player_id)
  );
`);

// A bracket (play-off draw) can belong to a season; the matches it creates then carry that season.
if (!db.prepare('PRAGMA table_info(brackets)').all().some((c) => c.name === 'season_id')) {
  db.exec('ALTER TABLE brackets ADD COLUMN season_id INTEGER REFERENCES seasons(id) ON DELETE SET NULL');
}
// The doubles draws of a tournament made before doubles became a category of its own carry no category: they are the category DOUBLES now.
db.exec("UPDATE brackets SET category = 'DOUBLES' WHERE is_doubles = 1 AND category IS NULL AND season_id IS NOT NULL");

// Who plays in a group this season (the season maker fills it, the schedule is made from it). A player is in one group
// per season (checked in routes/seasons.js). withdrawn_at: the player left mid-season; their unplayed matches became
// walkovers for the opponents and no new matches are made for them. (Foreign keys are off in this database, so rows
// of a deleted group are removed by the route, not by a cascade.)
db.exec(`
  CREATE TABLE IF NOT EXISTS season_group_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    withdrawn_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (group_id, player_id)
  );
  CREATE INDEX IF NOT EXISTS idx_season_group_members_player ON season_group_members(player_id);
`);

// The round a group-stage match belongs to (1..n inside its group); NULL for matches made before rounds existed.
if (!db.prepare('PRAGMA table_info(matches)').all().some((c) => c.name === 'round')) {
  db.exec('ALTER TABLE matches ADD COLUMN round INTEGER');
}

// What the season page (/season/<slug>) shows besides the tables and matches: the entry fee, the prize money, the draw date,
// a short description and a link to the photo gallery (all optional text, edited in /seasons-admin); and, per player of a
// group, whether the entry fee is paid.
const seasonInfoColumns = db.prepare('PRAGMA table_info(seasons)').all().map((c) => c.name);
['entry_fee', 'prize_money', 'draw_date', 'info', 'gallery_url', 'payment_url', 'iban', 'pay_recipient', 'pay_note', 'pay_title', 'logo_url', 'venue', 'categories', 'hero_url', 'hero_mobile_url', 'scoring', 'tiebreakers', 'planned_format', 'rules', 'balls', 'surface'].forEach((col) => {
  if (!seasonInfoColumns.includes(col)) db.exec(`ALTER TABLE seasons ADD COLUMN ${col} TEXT`);
});
// A hidden event (tournament or season): nobody but an admin sees it on the web (page, lists, schedule, sitemap) until the admin makes it public
if (!seasonInfoColumns.includes('hidden')) db.exec('ALTER TABLE seasons ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0');
// A tournament's table rules (see standings.js): scoring = BLTA / WIN2 / WIN1, tiebreakers = the conditions in order (comma list of H2H, SETS,
// WINS, GAMES). NULL (a league season, or a tournament made before the rules existed) = the league's way of calculating.
// A season is a league season ('LEAGUE') or a tournament ('TOURNAMENT'): the same page, registration, groups, brackets, matches and
// winners; a tournament also has a venue and the categories it is played in (comma list of ELITE, NEXT_GEN, NOVICE; empty = all).
if (!seasonInfoColumns.includes('kind')) db.exec("ALTER TABLE seasons ADD COLUMN kind TEXT NOT NULL DEFAULT 'LEAGUE'");
// What a tournament is played as, chosen when it is made and never mixed: 'SINGLES' (the categories Elite / Next Gen / Novice) or 'DOUBLES' (a
// tournament of pairs, the category Štvorhra only). A league season is always SINGLES.
if (!seasonInfoColumns.includes('play_type')) db.exec("ALTER TABLE seasons ADD COLUMN play_type TEXT NOT NULL DEFAULT 'SINGLES'");
// the number of courts of a tournament ("Kurt 1" … "Kurt n"), 0 = not set; used by the schedule
if (!seasonInfoColumns.includes('court_count')) db.exec('ALTER TABLE seasons ADD COLUMN court_count INTEGER NOT NULL DEFAULT 0');
// the names of the courts: a JSON list, index 0 = court 1, '' = the usual "Kurt <number>" (see src/courtNames.js)
if (!seasonInfoColumns.includes('court_names')) db.exec("ALTER TABLE seasons ADD COLUMN court_names TEXT NOT NULL DEFAULT '[]'");
// the live video of each court: a JSON list of YouTube video ids, index 0 = court 1, '' = none (see src/courtStreams.js)
if (!seasonInfoColumns.includes('court_streams')) db.exec("ALTER TABLE seasons ADD COLUMN court_streams TEXT NOT NULL DEFAULT '[]'");
// the tournament's court schedule (see tournamentSchedule.js): length of a match, the playing day, the minimum rest of a player between two
// matches and whether the app places new matches on the courts by itself; matches.court_no is the court (1..court_count) of a scheduled
// match, slot_locked = 1 when the organiser put it there by hand (the automatic planner never moves it)
[
  ['match_minutes', 'INTEGER NOT NULL DEFAULT 90'],
  ['day_start', "TEXT NOT NULL DEFAULT '09:00'"],
  ['day_end', "TEXT NOT NULL DEFAULT '20:00'"],
  // the playing times of single days that differ from day_start / day_end: JSON { "2027-05-02": { "start": "14:00", "end": "18:00" } } (only those days; '' = none)
  ['day_times', "TEXT NOT NULL DEFAULT ''"],
  ['rest_minutes', 'INTEGER NOT NULL DEFAULT 30'],
  ['auto_schedule', 'INTEGER NOT NULL DEFAULT 1'],
  // the most matches one player may play in one day of the tournament, 0 = no limit
  ['max_matches_per_day', 'INTEGER NOT NULL DEFAULT 0'],
  // the most players that can register (NULL = no maximum set: events made before it existed) and, for a season where the player chooses a category, the most for
  // each category as JSON { "ELITE": 16 }; the ones after it are substitutes (src/registrationCapacity.js)
  ['max_players', 'INTEGER'],
  ['category_max', "TEXT NOT NULL DEFAULT ''"],
  // how many hours before the start a registered player can drop out himself (NULL = he cannot; 0 = until the start), see src/unregister.js
  ['unregister_hours', 'INTEGER'],
  // the points the event of a community or club puts into the ranking of the community (JSON settings, see src/communityPoints.js); NULL = nothing set
  ['community_points', 'TEXT'],
  // the window the court planner works in (set on the schedule page): NULL = follow the playing times of the tournament form (the ones the players see), '' = no limit,
  // 'HH:MM' = its own time. Start and end are separate (see tournamentSchedule.settingsOf)
  ['plan_start', 'TEXT'],
  ['plan_end', 'TEXT'],
  // the look of the timeline of the court schedule: 1 = compact (an hour is half as high), NULL/0 = wide (see tournamentSchedule.settingsOf)
  ['timeline_compact', 'INTEGER'],
].forEach(([col, type]) => {
  if (!seasonInfoColumns.includes(col)) db.exec(`ALTER TABLE seasons ADD COLUMN ${col} ${type}`);
});
const matchScheduleColumns = db.prepare('PRAGMA table_info(matches)').all().map((c) => c.name);
if (!matchScheduleColumns.includes('court_no')) db.exec('ALTER TABLE matches ADD COLUMN court_no INTEGER');
if (!matchScheduleColumns.includes('slot_locked')) db.exec('ALTER TABLE matches ADD COLUMN slot_locked INTEGER NOT NULL DEFAULT 0');
// the length of this match in minutes when the organiser set one (shorter or longer than the tournament's matches), else NULL
if (!matchScheduleColumns.includes('duration_minutes')) db.exec('ALTER TABLE matches ADD COLUMN duration_minutes INTEGER');
// when the result of a match was entered by hand (the moment the match counts as finished on the court schedule; end_time stays empty for those)
if (!matchScheduleColumns.includes('result_at')) db.exec('ALTER TABLE matches ADD COLUMN result_at TEXT');
// 1 = the organiser moved or resized this FINISHED match on the court schedule by hand: its block is then scheduled_at + duration_minutes instead of its real start/end
if (!matchScheduleColumns.includes('manual_block')) db.exec('ALTER TABLE matches ADD COLUMN manual_block INTEGER NOT NULL DEFAULT 0');
if (!db.prepare('PRAGMA table_info(season_group_members)').all().some((c) => c.name === 'paid')) {
  db.exec('ALTER TABLE season_group_members ADD COLUMN paid INTEGER NOT NULL DEFAULT 0');
}

// Entering a season: the "Registrácia" form of the season page. payment_url is the link of the online entry-fee payment (a
// Stripe payment link); registration_open lets an admin close the form. A registration keeps the contact details for the
// admin only; the season page shows just the name, category and whether it is paid. player_id is set when the name is an
// existing player (an admin links a new name later, by adding it to a group).
if (!db.prepare('PRAGMA table_info(seasons)').all().some((c) => c.name === 'registration_open')) {
  db.exec('ALTER TABLE seasons ADD COLUMN registration_open INTEGER NOT NULL DEFAULT 1');
}
db.exec(`
  CREATE TABLE IF NOT EXISTS season_registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    season_id INTEGER NOT NULL,
    player_id INTEGER,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT NOT NULL,
    category TEXT NOT NULL,
    paid INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_season_registrations_season ON season_registrations(season_id);
`);
// an optional note from the player (a wish, a question), seen by the admin only
if (!db.prepare('PRAGMA table_info(season_registrations)').all().some((c) => c.name === 'note')) {
  db.exec("ALTER TABLE season_registrations ADD COLUMN note TEXT NOT NULL DEFAULT ''");
}
// the seed of a player in a tournament draw (1 = best), NULL = not seeded; set per category by the organiser
if (!db.prepare('PRAGMA table_info(season_registrations)').all().some((c) => c.name === 'seed')) {
  db.exec('ALTER TABLE season_registrations ADD COLUMN seed INTEGER');
}
// a wild card ("WC" in the seeding): a player the organiser let in; not seeded, only marked (shown as (WC) before the name in the schedule)
if (!db.prepare('PRAGMA table_info(season_registrations)').all().some((c) => c.name === 'wildcard')) {
  db.exec('ALTER TABLE season_registrations ADD COLUMN wildcard INTEGER');
}

// The doubles of a tournament: the pairs the organiser put together (the registration form can name a partner; "partner_name" is what the player
// wrote, the pair itself is made in the draw panel) and their seed. A player is in one pair of a tournament. The draw made from them is a
// doubles bracket (brackets.is_doubles) tied to the tournament.
if (!db.prepare('PRAGMA table_info(season_registrations)').all().some((c) => c.name === 'partner_name')) {
  db.exec("ALTER TABLE season_registrations ADD COLUMN partner_name TEXT NOT NULL DEFAULT ''");
}
db.exec(`
  CREATE TABLE IF NOT EXISTS tournament_pairs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    season_id INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    partner_id INTEGER NOT NULL,
    seed INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_tournament_pairs_season ON tournament_pairs(season_id);
`);

// Once: tournaments that already hold doubles (pairs or a draw of the category DOUBLES) and no singles draw are doubles tournaments now.
if (!db.prepare("SELECT 1 FROM app_flags WHERE key = 'tournament_play_type'").get()) {
  db.exec(`
    UPDATE seasons SET play_type = 'DOUBLES'
    WHERE kind = 'TOURNAMENT'
      AND (EXISTS (SELECT 1 FROM tournament_pairs p WHERE p.season_id = seasons.id)
        OR EXISTS (SELECT 1 FROM brackets b WHERE b.season_id = seasons.id AND b.category = 'DOUBLES'))
      AND NOT EXISTS (SELECT 1 FROM brackets b WHERE b.season_id = seasons.id AND b.category IN ('ELITE', 'NEXT_GEN', 'NOVICE'))
      AND NOT EXISTS (SELECT 1 FROM season_groups g WHERE g.season_id = seasons.id AND g.category IN ('ELITE', 'NEXT_GEN', 'NOVICE'))
  `);
  db.prepare("INSERT OR IGNORE INTO app_flags (key) VALUES ('tournament_play_type')").run();
}

// The kiosk of a tournament: phones that lie on its courts open ONE link, /kiosk/<token>, pick their court there, and list and score the matches of it (see src/courtKiosk.js).
// One row per tournament; the token is the secret of the address (it is replaced by a new one when the organiser makes the link again).
db.exec(`
  CREATE TABLE IF NOT EXISTS season_kiosks (
    season_id INTEGER PRIMARY KEY REFERENCES seasons(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    pin TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
`);
// the short code that opens the short address /turnaj<number> (a database made before it was added gets the column; its links get a code when they are made again)
if (!db.prepare('PRAGMA table_info(season_kiosks)').all().some((c) => c.name === 'pin')) db.exec("ALTER TABLE season_kiosks ADD COLUMN pin TEXT NOT NULL DEFAULT ''");

// The battery of the phone that lies on a court (the kiosk reports it about once a minute, see courtKiosk.reportBattery): one row per court of a tournament. `alerted` = the "battery is low"
// e-mail has been sent and the battery has not recovered since (so one low battery is one e-mail, not one per minute).
db.exec(`
  CREATE TABLE IF NOT EXISTS kiosk_batteries (
    season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    court_no INTEGER NOT NULL,
    level REAL,
    charging INTEGER,
    alerted INTEGER NOT NULL DEFAULT 0,
    seen_at TEXT NOT NULL,
    PRIMARY KEY (season_id, court_no)
  );
`);
