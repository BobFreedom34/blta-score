// The draw of a tournament, category by category: seeds of the registered players and the FORMAT of the category —
//   PRINCE       a main bracket and a consolation bracket ("útecha") for the players who lose in round 1 (who lose later are out);
//   MONRAD       a main bracket and a losers bracket for the losers of every round, each of them again a Monrad: everybody plays on until
//                all places are decided;
//   ELIMINATION  a plain main bracket;
//   GROUPS       round-robin groups only;
//   GROUPS_BRACKET  round-robin groups, then a bracket (ELIMINATION, PRINCE or MONRAD) of the best of every group.
// A tournament has up to three categories (Elite, Next Gen, Novice), each with its own format. The organiser can let the app make the
// draw (seeds placed by the standard seed order, the others by lot; groups suggested) or make it by hand.
const db = require('./db');
const engine = require('./matchEngine');
const bracketEngine = require('./bracketEngine');
const groups = require('./tournamentGroups');
const nameMatch = require('./nameMatch');

// DOUBLES (štvorhra) is a category like the three league ones, with the same formats: its entrants are the PAIRS of the tournament
// (tournament_pairs), seeded and drawn like players, a pair being identified by its first player (see tournamentGroups.partnerIn).
const CATEGORIES = ['ELITE', 'NEXT_GEN', 'NOVICE', 'DOUBLES', 'OPEN'];
const CATEGORY_LABELS = { ELITE: 'Elite', NEXT_GEN: 'Next Gen', NOVICE: 'Novice', DOUBLES: 'Štvorhra', OPEN: 'Bez kategórie' };
// a tournament is played as singles (Elite, Next Gen, Novice) or as doubles (Štvorhra), never both
const isDoublesTournament = (season) => !!season && season.kind === 'TOURNAMENT' && season.play_type === 'DOUBLES';
// A singles tournament is played in the categories its organiser chose (seasons.categories: some of Elite / Next Gen / Novice, all three when nothing is saved),
// or in none ('OPEN', "Bez kategórie"): then there is one draw for everybody who registered and nobody has to be sorted into a category.
const SINGLES_CATEGORIES = ['ELITE', 'NEXT_GEN', 'NOVICE'];
const isOpenTournament = (season) => !!season && season.kind === 'TOURNAMENT' && season.play_type !== 'DOUBLES' && season.categories === 'OPEN';
function categoriesFor(season) {
  if (isDoublesTournament(season)) return ['DOUBLES'];
  if (isOpenTournament(season)) return ['OPEN'];
  const chosen = String((season && season.categories) || '').split(',').filter((c) => SINGLES_CATEGORIES.includes(c));
  return chosen.length ? SINGLES_CATEGORIES.filter((c) => chosen.includes(c)) : SINGLES_CATEGORIES;
}
// a pair is listed like a registration for the seeds and the groups: its id is this plus the id of the pair (so it never meets a registration id)
const PAIR_ID_OFFSET = 1000000;
const FORMATS = ['PRINCE', 'MONRAD', 'ELIMINATION', 'GROUPS', 'GROUPS_BRACKET'];
const BRACKET_TYPES = ['ELIMINATION', 'PRINCE', 'MONRAD'];
const DEFAULT_MAIN_FORMAT = 'BO3_STB';
const DEFAULT_CONSOLATION_FORMAT = 'BO3_G4_STB';

function registrationsOf(seasonId, category) {
  if (category === 'DOUBLES') return pairRegistrations(seasonId);
  if (category === 'OPEN') return db.prepare('SELECT * FROM season_registrations WHERE season_id = ? ORDER BY created_at, id').all(seasonId); // everybody who registered
  return db.prepare('SELECT * FROM season_registrations WHERE season_id = ? AND category = ? ORDER BY created_at, id').all(seasonId, category);
}

// The pairs of a tournament shaped like registrations (what the seeds, the groups and the draw work with).
function pairRegistrations(seasonId) {
  return pairsOf(seasonId).map((p) => ({
    id: PAIR_ID_OFFSET + p.id, season_id: seasonId, player_id: p.player_id, partner_id: p.partner_id, name: `${p.player_name} / ${p.partner_name}`,
    phone: '', email: '', category: 'DOUBLES', seed: p.seed, created_at: p.created_at,
  }));
}

function mainBracketOf(seasonId, category) {
  return db.prepare("SELECT * FROM brackets WHERE season_id = ? AND category = ? AND COALESCE(kind, 'MAIN') = 'MAIN' ORDER BY id LIMIT 1").get(seasonId, category) || null;
}

// ---------- settings of a category ----------

const DEFAULTS = {
  format: 'PRINCE', mode: 'AUTO', mainFormat: DEFAULT_MAIN_FORMAT, consolationFormat: DEFAULT_CONSOLATION_FORMAT, groupFormat: DEFAULT_MAIN_FORMAT,
  groupSize: 4, groupCount: 0, qualifiers: 2, bracketType: 'PRINCE', autoBracket: true,
};

function settingsOf(seasonId, category) {
  const r = db.prepare('SELECT * FROM tournament_categories WHERE season_id = ? AND category = ?').get(seasonId, category);
  if (!r) return { ...DEFAULTS };
  return {
    format: r.format, mode: r.mode, mainFormat: r.main_format, consolationFormat: r.consolation_format, groupFormat: r.group_format,
    groupSize: r.group_size, groupCount: r.group_count, qualifiers: r.qualifiers, bracketType: r.bracket_type, autoBracket: !!r.auto_bracket,
  };
}

function saveSettings(seasonId, category, s) {
  db.prepare(`
    INSERT INTO tournament_categories (season_id, category, format, mode, main_format, consolation_format, group_format, group_size, group_count, qualifiers, bracket_type, auto_bracket)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(season_id, category) DO UPDATE SET format = excluded.format, mode = excluded.mode, main_format = excluded.main_format,
      consolation_format = excluded.consolation_format, group_format = excluded.group_format, group_size = excluded.group_size,
      group_count = excluded.group_count, qualifiers = excluded.qualifiers, bracket_type = excluded.bracket_type, auto_bracket = excluded.auto_bracket
  `).run(seasonId, category, s.format, s.mode, s.mainFormat, s.consolationFormat, s.groupFormat, s.groupSize, s.groupCount, s.qualifiers, s.bracketType, s.autoBracket ? 1 : 0);
}

// The type of the losers brackets of a category: what its format (or, for groups + bracket, its bracket type) says.
function losersTypeFor(seasonId, category) {
  const s = settingsOf(seasonId, category);
  const type = s.format === 'GROUPS_BRACKET' ? s.bracketType : s.format;
  return type === 'MONRAD' ? 'MONRAD' : 'PRINCE';
}

// ---------- overview ----------

function bracketSummary(row) {
  if (!row) return null;
  const rounds = bracketEngine.roundCount(row.size);
  const matches = db.prepare('SELECT m.status FROM bracket_matches b JOIN matches m ON m.id = b.match_id WHERE b.bracket_id = ?').all(row.id);
  return {
    id: row.id,
    name: row.name,
    kind: row.kind === 'CONSOLATION' ? 'CONSOLATION' : 'MAIN',
    format: row.format,
    size: row.size,
    rounds,
    matches: matches.length,
    finished: matches.filter((m) => m.status === 'FINISHED').length,
  };
}

// For the draw panel: per category the settings, how many players are registered and seeded, how big a bracket would be, the groups and
// the brackets that already exist.
function overview(seasonId) {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId);
  return categoriesFor(season).map((category) => {
    const regs = registrationsOf(seasonId, category);
    const withProfile = regs.filter((r) => r.player_id);
    const size = regs.length >= 2 ? bracketEngine.nextPowerOfTwo(regs.length) : 0;
    const settings = settingsOf(seasonId, category);
    const main = mainBracketOf(seasonId, category);
    const consolation = main ? bracketEngine.consolationOf(main.id) : null;
    const readiness = main ? bracketEngine.consolationReadiness(main.id) : null;
    const state = groups.groupsState(seasonId, category);
    const brackets = main ? [main.id, ...bracketEngine.descendants(main.id)].map((id) => bracketSummary(db.prepare('SELECT * FROM brackets WHERE id = ?').get(id))) : [];
    const hasLosers = settings.format === 'GROUPS_BRACKET' ? settings.bracketType !== 'ELIMINATION' : ['PRINCE', 'MONRAD'].includes(settings.format);
    return {
      category,
      label: CATEGORY_LABELS[category],
      players: regs.length,
      withoutProfile: regs.filter((r) => !r.player_id).map((r) => r.name),
      withProfile: withProfile.length,
      seeded: regs.filter((r) => r.seed).length,
      size,
      byes: size ? size - regs.length : 0,
      settings,
      main: bracketSummary(main),
      consolation: bracketSummary(consolation),
      brackets,
      groups: state,
      // the losers brackets can be made once every round-1 match of the main draw is seated
      canMakeConsolation: !!main && hasLosers && !consolation && readiness.empty === 0 && readiness.real >= 2,
      // the bracket after the groups can be made once the groups exist
      canMakeBracket: settings.format === 'GROUPS_BRACKET' && !!state && !main,
      stage: main ? 'BRACKET' : state ? 'GROUPS' : 'NONE',
    };
  });
}

// ---------- seeds ----------

// Replaces the seeds of one category: items = [{ id (registration), seed }]; players left out have no seed. Seeds are whole numbers
// from 1 up, each used once; gaps are closed (seeds 1, 2, 4 become 1, 2, 3). Returns { error } or { ok }.
function setSeeds(seasonId, category, items) {
  if (!categoriesFor(db.prepare('SELECT * FROM seasons WHERE id = ?').get(seasonId)).includes(category)) return { error: 'Choose a category' };
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
    if (category === 'DOUBLES') {
      db.prepare('UPDATE tournament_pairs SET seed = NULL WHERE season_id = ?').run(seasonId);
      const setPair = db.prepare('UPDATE tournament_pairs SET seed = ? WHERE id = ?');
      seeded.forEach((s, i) => setPair.run(i + 1, s.id - PAIR_ID_OFFSET));
    } else {
      db.prepare('UPDATE season_registrations SET seed = NULL WHERE season_id = ? AND category = ?').run(seasonId, category);
      const set = db.prepare('UPDATE season_registrations SET seed = ? WHERE id = ?');
      seeded.forEach((s, i) => set.run(i + 1, s.id));
    }
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
  return [...seeded, ...rest].map((r, i) => ({ playerId: r.player_id, seed: i + 1, partnerId: r.partner_id || null }));
}

// ---------- brackets ----------

// Makes the main bracket of a category and — for PRINCE and MONRAD, when the main bracket is filled — its losers brackets.
// entries: [{ playerId, seed }] (an automatic draw) or size (an empty bracket the organiser seats by hand).
// -> { mainId, consolationId (the first losers bracket or null), consolationNote, brackets }
function makeBracketSet(season, category, { type, mainFormat, consolationFormat, entries, size }) {
  const base = `${season.name} — ${CATEGORY_LABELS[category]}`;
  const doubles = category === 'DOUBLES';
  const mainId = bracketEngine.createBracket({
    name: `${base} — Hlavný pavúk`, format: mainFormat, entries: entries || null, size, autoCreateMatches: true, category, seasonId: season.id, doubles,
  });
  if (doubles) db.prepare('UPDATE brackets SET league_id = ? WHERE id = ?').run(season.league_id || 1, mainId);
  let consolationId = null;
  let consolationNote = null;
  let count = 1;
  if (entries && type !== 'ELIMINATION') {
    const made = bracketEngine.buildLosers(mainId, { name: `${base} — Útecha`, format: consolationFormat, type });
    if (made.bracketId) { consolationId = made.bracketId; count += made.brackets; } else consolationNote = made.error;
  }
  return { mainId, consolationId, consolationNote, brackets: count };
}

// R1 pairs of a bracket with these entries that put two players of one group against each other are untangled by swapping seed numbers
// with a player of another pair that has no such problem (the lower-seeded player of a pair is the one that moves).
function separateGroups(entries, size, groupOf) {
  const order = bracketEngine.standardSeedOrder(size);
  const bySeed = new Map(entries.map((e) => [e.seed, e]));
  const pairs = [];
  for (let i = 0; i < size / 2; i += 1) pairs.push([order[i * 2], order[i * 2 + 1]]);
  const clash = (a, b) => { const x = bySeed.get(a); const y = bySeed.get(b); return x && y && groupOf(x.playerId) && groupOf(x.playerId) === groupOf(y.playerId); };
  const swap = (a, b) => { const x = bySeed.get(a); const y = bySeed.get(b); x.seed = b; y.seed = a; bySeed.set(b, x); bySeed.set(a, y); };
  pairs.forEach(([top, low], i) => {
    if (!clash(top, low)) return;
    for (let j = 0; j < pairs.length; j += 1) {
      if (j === i) continue;
      const [otherTop, otherLow] = pairs[j];
      if (!bySeed.get(otherLow) || !bySeed.get(low)) continue;
      const mine = bySeed.get(low); const theirs = bySeed.get(otherLow);
      const gm = groupOf(mine.playerId); const gt = groupOf(theirs.playerId);
      const topGroup = groupOf(bySeed.get(top).playerId);
      const otherTopEntry = bySeed.get(otherTop);
      if (gt === topGroup) continue; // would still meet the winner of its own group
      if (otherTopEntry && groupOf(otherTopEntry.playerId) === gm) continue;
      swap(low, otherLow);
      break;
    }
  });
  return entries;
}

// ---------- the draw ----------

function validFormat(f) { return engine.FORMATS[f] && f !== 'FREE_PLAY'; }

// Makes the draw of one category with the chosen format.
// opts: { format, mode: 'AUTO' | 'MANUAL', mainFormat, consolationFormat, groupFormat, groupSize, groupCount, qualifiers, bracketType, autoBracket,
//         groups: [{ name, registrationIds }] (the groups as the organiser put them together; else suggested), random }
// -> { error, status } | { format, main, consolation, consolationNote, groups, warnings: [] }
function createDraw(season, category, opts = {}) {
  if (season.kind !== 'TOURNAMENT') return { status: 400, error: 'Only a tournament has a draw' };
  if (!categoriesFor(season).includes(category)) return { status: 400, error: isDoublesTournament(season) ? 'A doubles tournament has only the Štvorhra draw' : 'Choose a category' };
  const prev = settingsOf(season.id, category);
  const s = {
    format: opts.format || prev.format,
    mode: opts.mode === 'MANUAL' ? 'MANUAL' : 'AUTO',
    mainFormat: opts.mainFormat || prev.mainFormat,
    consolationFormat: opts.consolationFormat || prev.consolationFormat,
    groupFormat: opts.groupFormat || prev.groupFormat,
    groupSize: opts.groupSize !== undefined ? Number(opts.groupSize) : prev.groupSize,
    groupCount: opts.groupCount !== undefined ? Number(opts.groupCount) : prev.groupCount,
    qualifiers: opts.qualifiers !== undefined ? Number(opts.qualifiers) : prev.qualifiers,
    bracketType: opts.bracketType || prev.bracketType,
    autoBracket: opts.autoBracket !== undefined ? !!opts.autoBracket : prev.autoBracket,
  };
  if (!FORMATS.includes(s.format)) return { status: 400, error: 'Invalid format of the draw' };
  if (!validFormat(s.mainFormat)) return { status: 400, error: 'Invalid match format of the main draw' };
  if (!validFormat(s.consolationFormat)) return { status: 400, error: 'Invalid match format of the consolation draw' };
  if (!validFormat(s.groupFormat)) return { status: 400, error: 'Invalid match format of the group matches' };
  if (!BRACKET_TYPES.includes(s.bracketType)) return { status: 400, error: 'Invalid type of the bracket after the groups' };
  if (!Number.isInteger(s.groupSize) || s.groupSize < 2 || s.groupSize > 12) return { status: 400, error: 'A group has 2 to 12 players' };
  if (!Number.isInteger(s.groupCount) || s.groupCount < 0 || s.groupCount > 26) return { status: 400, error: 'The number of groups must be 0 (automatic) to 26' };
  if (!Number.isInteger(s.qualifiers) || s.qualifiers < 1 || s.qualifiers > 8) return { status: 400, error: 'The number of players going on from a group must be 1 to 8' };
  if (mainBracketOf(season.id, category) || groups.groupsOf(season.id, category).length) return { status: 409, error: `The ${CATEGORY_LABELS[category]} draw already exists — delete it first to make a new one` };
  const regs = registrationsOf(season.id, category);
  if (regs.length < 2) return { status: 400, error: `Need at least 2 ${CATEGORY_LABELS[category]} players to make a draw` };
  const missing = regs.filter((r) => !r.player_id);
  if (missing.length) return { status: 400, error: `These players have no player profile yet: ${missing.map((r) => r.name).join(', ')}` };
  const random = opts.random || Math.random;
  const warnings = [];

  // ----- groups (GROUPS, GROUPS_BRACKET) -----
  if (s.format === 'GROUPS' || s.format === 'GROUPS_BRACKET') {
    if (regs.length < 4 && s.format === 'GROUPS_BRACKET') return { status: 400, error: 'Groups with a bracket need at least 4 players' };
    let assignments;
    if (Array.isArray(opts.groups) && opts.groups.length) {
      const byReg = new Map(regs.map((r) => [r.id, r]));
      const used = new Set();
      assignments = [];
      for (const g of opts.groups) {
        const name = String(g && g.name || '').trim() || groups.groupName(assignments.length);
        const ids = Array.isArray(g && g.registrationIds) ? g.registrationIds.map(Number) : [];
        const playerIds = [];
        for (const id of ids) {
          if (!byReg.has(id)) return { status: 400, error: 'A player does not belong to this category of the tournament' };
          if (used.has(id)) return { status: 400, error: 'A player is in two groups' };
          used.add(id);
          playerIds.push(byReg.get(id).player_id);
        }
        if (playerIds.length < 2) return { status: 400, error: `${name} needs at least 2 players` };
        assignments.push({ name, playerIds });
      }
      const left = regs.filter((r) => !used.has(r.id));
      if (left.length) return { status: 400, error: `Put every player into a group (left out: ${left.map((r) => r.name).join(', ')})` };
    } else {
      assignments = groups.suggestGroups(regs.map((r) => ({ playerId: r.player_id, seed: r.seed })), s, random);
      if (assignments.some((a) => a.playerIds.length < 2)) return { status: 400, error: 'There are too few players for that number of groups' };
    }
    let made;
    db.exec('BEGIN');
    try {
      made = groups.createGroups(season, category, assignments, s.groupFormat);
      saveSettings(season.id, category, s);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    bracketEngine.planCourtsForSeason(season.id);
    return { format: s.format, main: null, consolation: null, consolationNote: null, groups: made.groups, matches: made.matches, warnings };
  }

  // ----- brackets (PRINCE, MONRAD, ELIMINATION) -----
  const size = bracketEngine.nextPowerOfTwo(regs.length);
  const byes = size - regs.length;
  const seeded = regs.filter((r) => r.seed).length;
  if (s.mode === 'AUTO' && byes > seeded) warnings.push(`The draw has ${byes} free places (byes) but only ${seeded} seeded players: ${byes - seeded} unseeded ${byes - seeded === 1 ? 'player' : 'players'} drawn by lot will skip round 1.`);
  if (s.mode === 'AUTO' && regs.length > 128) return { status: 400, error: 'Too many players (max 128)' };
  let set;
  db.exec('BEGIN');
  try {
    set = makeBracketSet(season, category, {
      type: s.format, mainFormat: s.mainFormat, consolationFormat: s.consolationFormat, entries: s.mode === 'AUTO' ? entriesFor(regs, random) : null, size,
    });
    saveSettings(season.id, category, s);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  bracketEngine.planCourts(set.mainId);
  return { format: s.format, main: set.mainId, consolation: set.consolationId, consolationNote: set.consolationNote, warnings };
}

// The bracket after the groups of a GROUPS_BRACKET category: the best `qualifiers` of every group are seeded (all the winners first, then
// the runners-up …, players of one group kept apart in round 1), AUTO places them, MANUAL makes the empty bracket for the organiser to
// fill. Needs finished groups unless opts.force. -> { error, status } | { main, consolation, consolationNote, players }
function createBracketFromGroups(season, category, opts = {}) {
  if (season.kind !== 'TOURNAMENT') return { status: 400, error: 'Only a tournament has a draw' };
  if (!categoriesFor(season).includes(category)) return { status: 400, error: 'Choose a category' };
  const s = settingsOf(season.id, category);
  if (s.format !== 'GROUPS_BRACKET') return { status: 400, error: 'This category is not played as groups with a bracket' };
  const state = groups.groupsState(season.id, category);
  if (!state) return { status: 400, error: 'Make the groups first' };
  if (mainBracketOf(season.id, category)) return { status: 409, error: 'The bracket of this category already exists' };
  if (!state.allFinished && !opts.force) return { status: 409, code: 'GROUPS_NOT_FINISHED', error: `The group matches are not all played yet (${state.finished} of ${state.matches})` };
  const mode = opts.mode === 'MANUAL' ? 'MANUAL' : 'AUTO';
  const list = groups.qualifiers(season.id, category, s.qualifiers);
  if (list.length < 2) return { status: 400, error: 'Fewer than two players go on from the groups' };
  const groupOf = new Map(list.map((q) => [q.playerId, q.groupId]));
  let entries = list.map((q, i) => ({ playerId: q.playerId, seed: i + 1, partnerId: category === 'DOUBLES' ? groups.partnerIn(season.id, q.playerId) : null }));
  const size = bracketEngine.nextPowerOfTwo(list.length);
  if (mode === 'AUTO') entries = separateGroups(entries, size, (id) => groupOf.get(id));
  let set;
  db.exec('BEGIN');
  try {
    set = makeBracketSet(season, category, {
      type: s.bracketType, mainFormat: s.mainFormat, consolationFormat: s.consolationFormat, entries: mode === 'AUTO' ? entries : null, size,
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  bracketEngine.planCourts(set.mainId);
  return { main: set.mainId, consolation: set.consolationId, consolationNote: set.consolationNote, players: list.length };
}

// Called when a match of the tournament finished: when it was the last match of the groups of a category made with "bracket
// automatically", the bracket is made by itself. Never throws.
function onMatchFinished(row) {
  try {
    if (!row || !row.group_id || !row.season_id) return;
    const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(row.season_id);
    const group = db.prepare('SELECT category FROM season_groups WHERE id = ?').get(row.group_id);
    const category = group ? group.category : row.category;
    if (!season || season.kind !== 'TOURNAMENT' || !CATEGORIES.includes(category)) return;
    const s = settingsOf(season.id, category);
    if (s.format !== 'GROUPS_BRACKET' || !s.autoBracket || s.mode !== 'AUTO' || mainBracketOf(season.id, category)) return;
    const state = groups.groupsState(season.id, category);
    if (state && state.allFinished) createBracketFromGroups(season, category, { mode: 'AUTO' });
  } catch (err) {
    console.error('[tournament draw]', err.message);
  }
}

// Removes the draw of one category (groups and brackets with all their losers brackets). Refused once a match of it has started: only a
// draw whose matches are all still PLANNED can go, and those planned matches go with it (they exist only because of the draw).
function deleteDraw(season, category) {
  const main = mainBracketOf(season.id, category);
  const groupRows = groups.groupsOf(season.id, category);
  if (!main && !groupRows.length) return { status: 404, error: 'There is no draw for this category' };
  const bracketIds = main ? [main.id, ...bracketEngine.descendants(main.id)] : [];
  const marks = bracketIds.map(() => '?').join(',');
  const bracketMatchIds = bracketIds.length ? db.prepare(`SELECT match_id FROM bracket_matches WHERE bracket_id IN (${marks}) AND match_id IS NOT NULL`).all(...bracketIds).map((r) => r.match_id) : [];
  const groupIds = groupRows.map((g) => g.id);
  const gMarks = groupIds.map(() => '?').join(',');
  const groupMatchIds = groupIds.length ? db.prepare(`SELECT id FROM matches WHERE group_id IN (${gMarks})`).all(...groupIds).map((r) => r.id) : [];
  const matchIds = [...bracketMatchIds, ...groupMatchIds];
  const started = matchIds.filter((id) => (db.prepare('SELECT status FROM matches WHERE id = ?').get(id) || {}).status !== 'PLANNED');
  if (started.length) return { status: 409, error: 'Matches of this draw have already been played, so it cannot be deleted' };
  const manual = bracketIds.length && db.prepare(`SELECT 1 FROM bracket_matches WHERE bracket_id IN (${marks}) AND manual_winner_id IS NOT NULL LIMIT 1`).get(...bracketIds);
  if (manual) return { status: 409, error: 'Results have already been entered in this draw, so it cannot be deleted' };
  db.exec('BEGIN');
  try {
    matchIds.forEach((id) => deleteMatchRow(id));
    if (bracketIds.length) {
      db.prepare(`DELETE FROM bracket_partners WHERE bracket_id IN (${marks})`).run(...bracketIds);
      db.prepare(`DELETE FROM bracket_matches WHERE bracket_id IN (${marks})`).run(...bracketIds);
      db.prepare(`DELETE FROM brackets WHERE id IN (${marks})`).run(...bracketIds);
    }
    if (groupIds.length) {
      db.prepare(`DELETE FROM season_group_members WHERE group_id IN (${gMarks})`).run(...groupIds);
      db.prepare(`DELETE FROM season_groups WHERE id IN (${gMarks})`).run(...groupIds);
    }
    db.prepare('DELETE FROM tournament_categories WHERE season_id = ? AND category = ?').run(season.id, category);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { ok: true };
}

// A planned match created by a draw and never played; foreign keys are off in this database, so the rows that point at it go too.
function deleteMatchRow(id) {
  db.prepare('UPDATE bracket_matches SET match_id = NULL WHERE match_id = ?').run(id);
  ['messages', 'match_notifications', 'push_subscriptions'].forEach((table) => db.prepare(`DELETE FROM ${table} WHERE match_id = ?`).run(id));
  db.prepare('DELETE FROM matches WHERE id = ?').run(id);
}

// ---------- the pairs of a tournament ----------
// The organiser puts pairs together from the players (the registration form lets a player name a partner). The draw of the category DOUBLES
// (seeds, groups, brackets, consolation, manual or automatic) is then made like that of any other category, with the pairs as its entrants.

function pairsOf(seasonId) {
  return db.prepare(`
    SELECT tp.*, p.name AS player_name, p.slug AS player_slug, q.name AS partner_name, q.slug AS partner_slug
    FROM tournament_pairs tp JOIN players p ON p.id = tp.player_id JOIN players q ON q.id = tp.partner_id
    WHERE tp.season_id = ? ORDER BY tp.seed IS NULL, tp.seed, tp.id
  `).all(seasonId);
}

// the pairs can only change while there is no draw of the category
function drawExists(seasonId) {
  return !!(mainBracketOf(seasonId, 'DOUBLES') || groups.groupsOf(seasonId, 'DOUBLES').length);
}

// a player given by id or by (typed) name; the name is matched like everywhere else (capitals, accents, word order)
function resolvePlayer(season, value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' || /^\d+$/.test(String(value))) {
    return db.prepare('SELECT id, name FROM players WHERE id = ?').get(Number(value)) || null;
  }
  const all = db.prepare('SELECT id, name FROM players WHERE league_id = ?').all(season.league_id || 1);
  const { exact } = nameMatch.findSimilar(String(value), all);
  return exact ? { id: exact.id, name: exact.name } : null;
}

function inAPair(seasonId, playerId) {
  return db.prepare('SELECT 1 FROM tournament_pairs WHERE season_id = ? AND (player_id = ? OR partner_id = ?)').get(seasonId, playerId, playerId);
}

const DRAW_EXISTS = 'The doubles draw already exists — delete it first to change the pairs';

const NOT_DOUBLES = 'This is not a doubles tournament';

// -> { error, status } | { pair }
function addPair(season, { player, partner }) {
  if (!isDoublesTournament(season)) return { status: 400, error: NOT_DOUBLES };
  if (drawExists(season.id)) return { status: 409, error: DRAW_EXISTS };
  const a = resolvePlayer(season, player);
  const b = resolvePlayer(season, partner);
  if (!a) return { status: 400, error: `Unknown player: ${player}` };
  if (!b) return { status: 400, error: `Unknown player: ${partner}` };
  if (a.id === b.id) return { status: 400, error: 'A pair needs two different players' };
  for (const p of [a, b]) {
    if (inAPair(season.id, p.id)) return { status: 409, error: `${p.name} is already in a pair of this tournament` };
  }
  const info = db.prepare('INSERT INTO tournament_pairs (season_id, player_id, partner_id) VALUES (?, ?, ?)').run(season.id, a.id, b.id);
  return { pair: Number(info.lastInsertRowid) };
}

// Pairs from what the players wrote in the registration form ("partner for doubles"): every registration with a partner whose name is a
// player and who is in no pair yet. -> { created, skipped: [{ name, partner, reason }] }
function addPairsFromRegistrations(season) {
  if (!isDoublesTournament(season)) return { status: 400, error: NOT_DOUBLES };
  if (drawExists(season.id)) return { status: 409, error: DRAW_EXISTS };
  const regs = db.prepare("SELECT * FROM season_registrations WHERE season_id = ? AND partner_name != '' ORDER BY created_at, id").all(season.id);
  let created = 0;
  const skipped = [];
  regs.forEach((r) => {
    const who = r.player_id ? { id: r.player_id } : resolvePlayer(season, r.name);
    const partner = resolvePlayer(season, r.partner_name);
    if (!who) { skipped.push({ name: r.name, partner: r.partner_name, reason: 'the player has no profile' }); return; }
    if (!partner) { skipped.push({ name: r.name, partner: r.partner_name, reason: 'the partner is not a known player' }); return; }
    if (who.id === partner.id) { skipped.push({ name: r.name, partner: r.partner_name, reason: 'the same player' }); return; }
    if (inAPair(season.id, who.id) || inAPair(season.id, partner.id)) return; // already paired (for instance the partner wrote the same pair)
    db.prepare('INSERT INTO tournament_pairs (season_id, player_id, partner_id) VALUES (?, ?, ?)').run(season.id, who.id, partner.id);
    created += 1;
  });
  return { created, skipped };
}

function removePair(season, pairId) {
  if (!isDoublesTournament(season)) return { status: 400, error: NOT_DOUBLES };
  const row = db.prepare('SELECT * FROM tournament_pairs WHERE id = ? AND season_id = ?').get(pairId, season.id);
  if (!row) return { status: 404, error: 'Pair not found' };
  if (drawExists(season.id)) return { status: 409, error: DRAW_EXISTS };
  db.prepare('DELETE FROM tournament_pairs WHERE id = ?').run(pairId);
  return { ok: true };
}

// for the pairs panel of the draw screen: the pairs, how many registrations named a partner, and whether the pairs are locked by a draw
function doublesOverview(season) {
  const pairs = pairsOf(season.id);
  const wanting = db.prepare("SELECT COUNT(*) AS n FROM season_registrations WHERE season_id = ? AND partner_name != ''").get(season.id).n;
  return {
    pairs: pairs.map((p) => ({
      id: p.id, registrationId: PAIR_ID_OFFSET + p.id, seed: p.seed || null,
      player: { id: p.player_id, name: p.player_name, slug: p.player_slug },
      partner: { id: p.partner_id, name: p.partner_name, slug: p.partner_slug },
    })),
    registrationsWithPartner: wanting,
    locked: drawExists(season.id),
    pairIdOffset: PAIR_ID_OFFSET,
  };
}

module.exports = {
  isOpenTournament,
  doublesOverview,
  addPair,
  addPairsFromRegistrations,
  removePair,
  registrationsOf,
  PAIR_ID_OFFSET,
  categoriesFor,
  isDoublesTournament,
  CATEGORIES,
  FORMATS,
  BRACKET_TYPES,
  DEFAULT_MAIN_FORMAT,
  DEFAULT_CONSOLATION_FORMAT,
  overview,
  setSeeds,
  settingsOf,
  losersTypeFor,
  createDraw,
  createBracketFromGroups,
  onMatchFinished,
  deleteDraw,
  mainBracketOf,
};
