const { db } = require('./core');

// CourtIQ — a locally-computed Glicko-2 skill rating (see
// src/courtIQEngine.js for the math), entirely separate from the "BLTA
// GENERAL" ranking above (ranking_overrides/ranking_snapshots), which is
// scraped from blta.sk and keyed by player name rather than computed from
// match results at all. One row per player holding their CURRENT
// rating/deviation/volatility — updated in place the moment a match
// finishes (see routes/matches.js), and rebuilt from scratch by
// scripts/backfillCourtIQ.js, which replays full match history through the
// same courtIQEngine functions in chronological order. last_match_at (not
// just updated_at) is what lets a future match apply the right amount of
// inactivity widening — updated_at changes on backfill re-runs even for a
// date-shifted match, last_match_at doesn't.
db.exec(`
  CREATE TABLE IF NOT EXISTS courtiq_ratings (
    player_id INTEGER PRIMARY KEY REFERENCES players(id),
    rating REAL NOT NULL,
    deviation REAL NOT NULL,
    volatility REAL NOT NULL,
    games_played INTEGER NOT NULL DEFAULT 0,
    last_match_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
`);

// One row per player per match they were rated in — the rating/deviation
// exactly as it stood right AFTER that match, so a rating-history chart can
// plot the trend over time instead of only ever showing the current
// number. Rebuilt wholesale by scripts/backfillCourtIQ.js on every re-run
// rather than patched incrementally — Glicko-2 is path-dependent, so
// there's no cheap way to fix one match's row without touching every row
// after it anyway (see courtIQEngine.js's own header comment). The unique
// index is also what the live hook (routes/matches.js) checks to tell "a
// brand-new finish" from "a correction to an already-rated match" — the
// latter is a no-op live (it needs a full backfill re-run to be correct).
db.exec(`
  CREATE TABLE IF NOT EXISTS courtiq_rating_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL REFERENCES players(id),
    match_id INTEGER NOT NULL REFERENCES matches(id),
    rating REAL NOT NULL,
    deviation REAL NOT NULL,
    volatility REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_courtiq_rating_history_player ON courtiq_rating_history(player_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_courtiq_rating_history_unique ON courtiq_rating_history(player_id, match_id);
`);

// A standalone single-elimination playoff draw ("Pavúk") — a freestanding
// named tournament (e.g. "Summer Rally Series 2026 — Elite"), not tied to
// the league category enum matches.category otherwise validates against.
// format is applied to every match this bracket generates (see
// bracketEngine.js); size is the draw size AFTER rounding the entry count
// up to the next power of two (byes fill the gap) — stored so the admin UI
// and public display both know the tree shape without recomputing it from
// bracket_matches every time.
db.exec(`
  CREATE TABLE IF NOT EXISTS brackets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    format TEXT NOT NULL DEFAULT 'BO3_STB',
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
`);

// One row per node in the single-elimination tree — every pairing, every
// round, including the not-yet-known later rounds (created empty up front
// so next_bracket_match_id can point at a real row from the very start).
// round is 1-based (1 = first round); position is 0-based within that
// round. seed1/seed2 are only ever set on round 1 (from the seeding
// algorithm) and exist purely for display ("(3)" next to a name) — winner
// advancement itself only cares about player1_id/player2_id. match_id is
// NULL until both of a node's players are known (see bracketEngine.js's
// maybeCreateMatch) — a bracket slot doesn't need a real scoreable match
// to exist before then. next_bracket_match_id/next_slot is where THIS
// node's eventual winner gets written (NULL on the final). is_bye means
// exactly one of player1_id/player2_id is set and the other slot was never
// going to be filled (not enough real entrants for a full power-of-two
// draw) — that lone player advances immediately, with no match played.
db.exec(`
  CREATE TABLE IF NOT EXISTS bracket_matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bracket_id INTEGER NOT NULL REFERENCES brackets(id),
    round INTEGER NOT NULL,
    position INTEGER NOT NULL,
    seed1 INTEGER,
    seed2 INTEGER,
    player1_id INTEGER REFERENCES players(id),
    player2_id INTEGER REFERENCES players(id),
    is_bye INTEGER NOT NULL DEFAULT 0,
    match_id INTEGER REFERENCES matches(id),
    next_bracket_match_id INTEGER REFERENCES bracket_matches(id),
    next_slot INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_bracket_matches_bracket ON bracket_matches(bracket_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_bracket_matches_unique_slot ON bracket_matches(bracket_id, round, position);
  CREATE INDEX IF NOT EXISTS idx_bracket_matches_match_id ON bracket_matches(match_id);
`);

// Lets a bracket record a past/historical draw where the individual
// matches were never actually played inside this app — set once at
// creation (see routes/brackets.js), off by default is wrong (most
// brackets ARE live), so this defaults ON and an admin unchecks it for a
// "just enter the results" historical draw. When 0, bracketEngine's
// maybeCreateMatch becomes a no-op: a slot's two players get filled in
// exactly the same way, but no `matches` row is created for it, and the
// winner has to be set directly (see manual_winner_id below) instead of
// by finishing a real match.
if (!db.prepare('PRAGMA table_info(brackets)').all().some((c) => c.name === 'auto_create_matches')) {
  db.exec('ALTER TABLE brackets ADD COLUMN auto_create_matches INTEGER NOT NULL DEFAULT 1');
}

// NULL (the default) keeps a bracket fully freestanding — every match it
// generates is category OTHER, same as before this column existed. Set to
// one of the real BLTA categories instead so a bracket tied to an actual
// league cycle (e.g. "ELITE - Summer Rally Series") shows up correctly in
// category filters/player history rather than being lumped into OTHER —
// see bracketEngine.js's maybeCreateMatch, the only place this is read.
if (!db.prepare('PRAGMA table_info(brackets)').all().some((c) => c.name === 'category')) {
  db.exec('ALTER TABLE brackets ADD COLUMN category TEXT');
}

// A node's result can come from exactly one of two places: a real match
// (match_id, winner read from matches.winner_id — the normal, live case)
// or here, set directly by an admin via PATCH .../nodes/:id/result when
// the bracket has auto_create_matches off. manual_score is a free-text
// display string ("6-2, 6-4") purely for the public page — never parsed,
// unlike a real match's own set-by-set state.
const bracketMatchColumns = db.prepare('PRAGMA table_info(bracket_matches)').all().map((c) => c.name);
if (!bracketMatchColumns.includes('manual_winner_id')) {
  db.exec('ALTER TABLE bracket_matches ADD COLUMN manual_winner_id INTEGER REFERENCES players(id)');
}
if (!bracketMatchColumns.includes('manual_score')) {
  db.exec('ALTER TABLE bracket_matches ADD COLUMN manual_score TEXT');
}

// A tournament draw has two brackets per category: the main one (kind MAIN) and its consolation draw ("útecha", kind CONSOLATION,
// parent_bracket_id = the main bracket) which takes the players who lose their first main-draw match. consolation_seed is set on a
// round-1 node of the MAIN bracket: the seed its loser takes in the consolation draw.
const bracketKindColumns = db.prepare('PRAGMA table_info(brackets)').all().map((c) => c.name);
if (!bracketKindColumns.includes('kind')) db.exec("ALTER TABLE brackets ADD COLUMN kind TEXT NOT NULL DEFAULT 'MAIN'");
if (!bracketKindColumns.includes('parent_bracket_id')) db.exec('ALTER TABLE brackets ADD COLUMN parent_bracket_id INTEGER');
if (!bracketMatchColumns.includes('consolation_seed')) db.exec('ALTER TABLE bracket_matches ADD COLUMN consolation_seed INTEGER');
// A bracket can have several "losers" brackets (PRINCE: one for the round-1 losers; Monrad: one for the losers of every round, each with its
// own ones again): feeds_round = the round of the parent bracket whose losers play in this one; on a node of the parent, loser_bracket_id
// is the bracket its loser drops into and consolation_seed the seed it takes there.
if (!bracketKindColumns.includes('feeds_round')) db.exec('ALTER TABLE brackets ADD COLUMN feeds_round INTEGER');
if (!bracketMatchColumns.includes('loser_bracket_id')) db.exec('ALTER TABLE bracket_matches ADD COLUMN loser_bracket_id INTEGER');

// The format of each category of a tournament and how its draw was made: format PRINCE / MONRAD / ELIMINATION / GROUPS / GROUPS_BRACKET,
// the match formats of the main bracket, the losers brackets and the group matches, the groups (size or count) and how many of each group
// go on to the bracket, and the type of that bracket.
db.exec(`
  CREATE TABLE IF NOT EXISTS tournament_categories (
    season_id INTEGER NOT NULL,
    category TEXT NOT NULL,
    format TEXT NOT NULL DEFAULT 'PRINCE',
    mode TEXT NOT NULL DEFAULT 'AUTO',
    main_format TEXT NOT NULL DEFAULT 'BO3_STB',
    consolation_format TEXT NOT NULL DEFAULT 'BO3_G4_STB',
    group_format TEXT NOT NULL DEFAULT 'BO3_STB',
    group_size INTEGER NOT NULL DEFAULT 4,
    group_count INTEGER NOT NULL DEFAULT 0,
    qualifiers INTEGER NOT NULL DEFAULT 2,
    bracket_type TEXT NOT NULL DEFAULT 'PRINCE',
    auto_bracket INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (season_id, category)
  );
  -- the Swiss system (src/swiss.js): the player of a group who had no opponent in a round (an odd number of players) gets the points of a win
  CREATE TABLE IF NOT EXISTS season_group_byes (
    group_id INTEGER NOT NULL,
    round INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    PRIMARY KEY (group_id, round)
  );
`);
// the number of rounds of a Swiss draw (0 = not a Swiss draw / worked out when the draw is made)
{
  const tcColumns = db.prepare('PRAGMA table_info(tournament_categories)').all().map((c) => c.name);
  if (!tcColumns.includes('rounds')) db.exec('ALTER TABLE tournament_categories ADD COLUMN rounds INTEGER NOT NULL DEFAULT 0');
}
