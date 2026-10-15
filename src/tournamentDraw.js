// The draw of a tournament, category by category: seeds of the registered players, the main bracket and its consolation bracket
// ("útecha"). A tournament has up to three draws (Elite, Next Gen, Novice); each is a MAIN bracket plus, once round 1 is seated, a
// CONSOLATION bracket for the players who lose their first match (see bracketEngine.js). The organiser can let the app build the
// main bracket (seeded players placed by the standard seed order, the others drawn by lot) or build it by hand, slot by slot.
const db = require('./db');
const engine = require('./matchEngine');
const bracketEngine = require('./bracketEngine');

const CATEGORIES = ['ELITE', 'NEXT_GEN', 'NOVICE'];
const CATEGORY_LABELS = { ELITE: 'Elite', NEXT_GEN: 'Next Gen', NOVICE: 'Novice' };
const DEFAULT_MAIN_FORMAT = 'BO3_STB';
const DEFAULT_CONSOLATION_FORMAT = 'BO3_G4_STB';

function registrationsOf(seasonId, category) {
  return db.prepare('SELECT * FROM season_registrations WHERE season_id = ? AND category = ? ORDER BY created_at, id').all(seasonId, category);
}

function mainBracketOf(seasonId, category) {
  return db.prepare("SELECT * FROM brackets WHERE season_id = ? AND category = ? AND COALESCE(kind, 'MAIN') = 'MAIN' ORDER BY id LIMIT 1").get(seasonId, category) || null;
}

function bracketSummary(row) {
  if (!row) return null;
  const rounds = bracketEngine.roundCount(row.size);
  const matches = db.prepare('SELECT m.status FROM bracket_matches b JOIN matches m ON m.id = b.match_id WHERE b.bracket_id = ?').all(row.id);
  return {
    id: row.id,
    name: row.name,
    format: row.format,
    size: row.size,
    rounds,
    matches: matches.length,
    finished: matches.filter((m) => m.status === 'FINISHED').length,
  };
}

// For the draw panel: per category how many players are registered, seeded, how big the draw would be and how many byes it has,
// and the brackets that already exist.
function overview(seasonId) {
  return CATEGORIES.map((category) => {
    const regs = registrationsOf(seasonId, category);
    const withProfile = regs.filter((r) => r.player_id);
    const size = regs.length >= 2 ? bracketEngine.nextPowerOfTwo(regs.length) : 0;
    const main = mainBracketOf(seasonId, category);
    const consolation = main ? bracketEngine.consolationOf(main.id) : null;
    const readiness = main ? bracketEngine.consolationReadiness(main.id) : null;
    return {
      category,
      label: CATEGORY_LABELS[category],
      players: regs.length,
      withoutProfile: regs.filter((r) => !r.player_id).map((r) => r.name),
      withProfile: withProfile.length,
      seeded: regs.filter((r) => r.seed).length,
      size,
      byes: size ? size - regs.length : 0,
      main: bracketSummary(main),
      consolation: bracketSummary(consolation),
      // the consolation draw can be made once every round-1 match of the main draw is seated
      canMakeConsolation: !!main && !consolation && readiness.empty === 0 && readiness.real >= 2,
    };
  });
}

// Replaces the seeds of one category: items = [{ id (registration), seed }]; players left out have no seed. Seeds are whole numbers
// from 1 up, each used once; gaps are closed (seeds 1, 2, 4 become 1, 2, 3). Returns { error } or { ok }.
function setSeeds(seasonId, category, items) {
  if (!CATEGORIES.includes(category)) return { error: 'Choose a category' };
  if (!Array.isArray(items)) return { error: 'Nothing to save' };
  const regs = registrationsOf(seasonId, category);
  const own = new Map(regs.map((r) => [r.id, r]));
  const seen = new Set();
  const used = new Set();
  const seeded = [];
  for (const item of items) {
    const id = Number(item && item.id);
    if (!own.has(id)) return { error: 'A player does not belong to this category of the tournament' };
    if (seen.has(id)) return { error: 'The same player is listed twice' };
    seen.add(id);
    if (item.seed === null || item.seed === undefined || item.seed === '') continue;
    const seed = Number(item.seed);
    if (!Number.isInteger(seed) || seed < 1) return { error: 'A seed is a whole number from 1' };
    if (seed > regs.length) return { error: `A seed cannot be higher than the number of players (${regs.length})` };
    if (used.has(seed)) return { error: `Seed ${seed} is used more than once` };
    used.add(seed);
    seeded.push({ id, seed });
  }
  seeded.sort((a, b) => a.seed - b.seed);
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE season_registrations SET seed = NULL WHERE season_id = ? AND category = ?').run(seasonId, category);
    const set = db.prepare('UPDATE season_registrations SET seed = ? WHERE id = ?');
    seeded.forEach((s, i) => set.run(i + 1, s.id));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { ok: true };
}

function shuffled(list, random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Seeded players take seeds 1..k in the order the organiser gave, the rest get k+1..n by lot. The byes of a draw that cannot be
// filled go to the highest seeds (standard seeding), so seeding at least as many players as there are byes means only seeded players
// skip round 1.
function entriesFor(regs, random) {
  const seeded = regs.filter((r) => r.seed).sort((a, b) => a.seed - b.seed);
  const rest = shuffled(regs.filter((r) => !r.seed), random);
  return [...seeded, ...rest].map((r, i) => ({ playerId: r.player_id, seed: i + 1 }));
}

// Builds the main bracket of one category (and, for an automatic draw, its consolation bracket).
// opts: { mode: 'AUTO' | 'MANUAL', mainFormat, consolationFormat, random }
// -> { error, status } | { main, consolation (id or null), consolationNote, warnings: [] }
function createDraw(season, category, opts = {}) {
  if (season.kind !== 'TOURNAMENT') return { status: 400, error: 'Only a tournament has a draw' };
  if (!CATEGORIES.includes(category)) return { status: 400, error: 'Choose a category' };
  const mode = opts.mode === 'MANUAL' ? 'MANUAL' : 'AUTO';
  const mainFormat = opts.mainFormat || DEFAULT_MAIN_FORMAT;
  const consolationFormat = opts.consolationFormat || DEFAULT_CONSOLATION_FORMAT;
  if (!engine.FORMATS[mainFormat] || mainFormat === 'FREE_PLAY') return { status: 400, error: 'Invalid match format of the main draw' };
  if (!engine.FORMATS[consolationFormat] || consolationFormat === 'FREE_PLAY') return { status: 400, error: 'Invalid match format of the consolation draw' };
  if (mainBracketOf(season.id, category)) return { status: 409, error: `The ${CATEGORY_LABELS[category]} draw already exists — delete it first to make a new one` };
  const regs = registrationsOf(season.id, category);
  if (regs.length < 2) return { status: 400, error: `Need at least 2 ${CATEGORY_LABELS[category]} players to make a draw` };
  const missing = regs.filter((r) => !r.player_id);
  if (missing.length) return { status: 400, error: `These players have no player profile yet: ${missing.map((r) => r.name).join(', ')}` };
  if (mode === 'AUTO' && regs.length > 128) return { status: 400, error: 'Too many players (max 128)' };

  const random = opts.random || Math.random;
  const warnings = [];
  const size = bracketEngine.nextPowerOfTwo(regs.length);
  const byes = size - regs.length;
  const seeded = regs.filter((r) => r.seed).length;
  if (byes > seeded) warnings.push(`The draw has ${byes} free places (byes) but only ${seeded} seeded players: ${byes - seeded} unseeded ${byes - seeded === 1 ? 'player' : 'players'} drawn by lot will skip round 1.`);

  const label = CATEGORY_LABELS[category];
  const common = { autoCreateMatches: true, category, seasonId: season.id };
  let mainId;
  let consolationId = null;
  let consolationNote = null;
  db.exec('BEGIN');
  try {
    if (mode === 'AUTO') {
      mainId = bracketEngine.createBracket({ ...common, name: `${label} — Hlavný pavúk`, format: mainFormat, entries: entriesFor(regs, random) });
      const made = bracketEngine.buildConsolation(mainId, { name: `${label} — Útecha`, format: consolationFormat });
      if (made.bracketId) consolationId = made.bracketId; else consolationNote = made.error;
    } else {
      mainId = bracketEngine.createBracket({ ...common, name: `${label} — Hlavný pavúk`, format: mainFormat, entries: null, size });
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { main: mainId, consolation: consolationId, consolationNote, warnings };
}

// Removes the draw of one category (main + consolation brackets). Refused once a match of it has started: only brackets whose
// matches are all still PLANNED can go, and those planned matches go with them (they exist only because of the draw).
function deleteDraw(season, category) {
  const main = mainBracketOf(season.id, category);
  if (!main) return { status: 404, error: 'There is no draw for this category' };
  const ids = [main.id, ...db.prepare('SELECT id FROM brackets WHERE parent_bracket_id = ?').all(main.id).map((r) => r.id)];
  const marks = ids.map(() => '?').join(',');
  const matchIds = db.prepare(`SELECT match_id FROM bracket_matches WHERE bracket_id IN (${marks}) AND match_id IS NOT NULL`).all(...ids).map((r) => r.match_id);
  const started = matchIds.filter((id) => (db.prepare('SELECT status FROM matches WHERE id = ?').get(id) || {}).status !== 'PLANNED');
  if (started.length) return { status: 409, error: 'Matches of this draw have already been played, so it cannot be deleted' };
  const manual = db.prepare(`SELECT 1 FROM bracket_matches WHERE bracket_id IN (${marks}) AND manual_winner_id IS NOT NULL LIMIT 1`).get(...ids);
  if (manual) return { status: 409, error: 'Results have already been entered in this draw, so it cannot be deleted' };
  db.exec('BEGIN');
  try {
    matchIds.forEach((id) => deleteMatchRow(id));
    db.prepare(`DELETE FROM bracket_matches WHERE bracket_id IN (${marks})`).run(...ids);
    db.prepare(`DELETE FROM brackets WHERE id IN (${marks})`).run(...ids);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { ok: true };
}

// A planned match created by a bracket and never played; foreign keys are off in this database, so the rows that point at it go too.
function deleteMatchRow(id) {
  db.prepare('UPDATE bracket_matches SET match_id = NULL WHERE match_id = ?').run(id);
  ['messages', 'match_notifications', 'push_subscriptions'].forEach((table) => db.prepare(`DELETE FROM ${table} WHERE match_id = ?`).run(id));
  db.prepare('DELETE FROM matches WHERE id = ?').run(id);
}

module.exports = {
  CATEGORIES,
  DEFAULT_MAIN_FORMAT,
  DEFAULT_CONSOLATION_FORMAT,
  overview,
  setSeeds,
  createDraw,
  deleteDraw,
  mainBracketOf,
};
