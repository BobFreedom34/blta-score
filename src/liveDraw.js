// The draw in front of the camera ("Žreb naživo", public/draw-live.html): the organiser draws the groups or the bracket of a tournament category on a screen that is shared
// (a stream, a video call, a projector), so everybody sees that the lot is a lot.
//
// How it is made honest:
//   1. When the draw is started the server makes a fresh random KEY (seed, 32 bytes from the operating system). Everything that is left to chance is a function of that key and of
//      the list of players: the random numbers are HMAC-SHA256(key, 0), HMAC-SHA256(key, 1) … (the first 6 bytes of each as a fraction of 2^48) and the unseeded players are
//      shuffled with them (Fisher-Yates from the end). So the draw cannot be bent while it runs, and anybody can repeat it from the key.
//   2. The page shows the LOCK (SHA-256 of the key) before the first player moves and the key itself when the draw is over: whoever saw the video can check that the key fits the lock.
//   3. What is shown is exactly what is saved: the organiser's "save" writes the very seats / groups / order that were shown (tournamentDraw.createDraw with explicit groups,
//      entries or order), after it has checked that the players and the seeding did not change in the meantime.
//   4. Every start is written down (table draw_records, status PLANNED); the saved one is COMMITTED. The public record shows how many times a draw was started for the category,
//      so a draw that was started and thrown away is not hidden.
// The seeded players keep their seats (a bracket: the standard seed order; groups: the snake) and are shown first; the others are drawn.
const crypto = require('crypto');
const db = require('./db');
const draw = require('./tournamentDraw');
const groups = require('./tournamentGroups');
const bracketEngine = require('./bracketEngine');
const swiss = require('./swiss');

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

// the random numbers of a draw: number i = first 6 bytes of HMAC-SHA256(key = seed, message = i in decimal) / 2^48
function makeRandom(seedHex) {
  const key = Buffer.from(seedHex, 'hex');
  let counter = 0;
  return () => {
    const digest = crypto.createHmac('sha256', key).update(String(counter)).digest();
    counter += 1;
    return digest.readUIntBE(0, 6) / 2 ** 48;
  };
}

// the settings of a draw that matter (what the page sends); anything else is dropped
const OPTION_KEYS = ['format', 'mode', 'mainFormat', 'consolationFormat', 'groupFormat', 'groupSize', 'groupCount', 'qualifiers', 'bracketType', 'autoBracket', 'rounds'];
const pickOptions = (opts) => Object.fromEntries(OPTION_KEYS.filter((k) => opts && opts[k] !== undefined).map((k) => [k, opts[k]]));

// who is in the draw and how they are seeded: if this changes between the start and the save, the draw that was shown no longer fits
function fingerprintOf(regs) {
  return sha256(JSON.stringify(regs.map((r) => [r.id, r.player_id, r.seed || 0, r.partner_id || 0]).sort((a, b) => a[0] - b[0])));
}

// ---------- the plans: who goes where, in the order in which the page shows it ----------

// groups: the seeded players first (the snake: seed 1 in group A, seed 2 in group B … and back), then the others by lot; the page deals them one row at a time
function planGroups(regs, s, rng) {
  const assignments = groups.suggestGroups(regs.map((r) => ({ playerId: r.player_id, seed: r.seed })), s, rng);
  if (assignments.some((a) => a.playerIds.length < 2)) return { status: 400, error: 'There are too few players for that number of groups' };
  if (s.format === 'GROUPS_BRACKET' && s.bracketType === 'PLACEMENT' && assignments.length !== 2) {
    return { status: 400, error: `Matches for the places need exactly 2 groups (these are ${assignments.length}): set the players per group so that 2 groups are made` };
  }
  const byPlayer = new Map(regs.map((r) => [r.player_id, r]));
  const steps = [];
  const rows = Math.max(...assignments.map((a) => a.playerIds.length));
  for (let row = 0; row < rows; row += 1) {
    const order = assignments.map((a, gi) => gi);
    if (row % 2 === 1) order.reverse(); // the snake
    order.forEach((gi) => {
      const playerId = assignments[gi].playerIds[row];
      if (playerId === undefined) return;
      const reg = byPlayer.get(playerId);
      steps.push({ e: reg.id, kind: reg.seed ? 'SEED' : 'DRAW', slot: { g: gi, i: row } });
    });
  }
  return {
    layout: { type: 'GROUPS', groups: assignments.map((a) => ({ name: a.name, size: a.playerIds.length })) },
    steps,
    args: { groups: assignments.map((a) => ({ name: a.name, registrationIds: a.playerIds.map((pid) => byPlayer.get(pid).id) })) },
  };
}

// a bracket: the seeded players take the seats of their seed numbers, the others get the next seed numbers by lot; the page fills the open seats from the top
function planBracket(regs, s, rng) {
  if (regs.length > 128) return { status: 400, error: 'Too many players (max 128)' };
  const entries = draw.entriesFor(regs, rng); // [{ playerId, seed, partnerId }], seeds 1..n
  const n = regs.length;
  const size = bracketEngine.nextPowerOfTwo(n);
  const order = bracketEngine.standardSeedOrder(size); // the seed number of every seat, top to bottom
  const seededCount = regs.filter((r) => r.seed).length;
  const byPlayer = new Map(regs.map((r) => [r.player_id, r]));
  const regOfSeed = (seedNo) => byPlayer.get(entries[seedNo - 1].playerId);
  const steps = [];
  for (let seedNo = 1; seedNo <= seededCount; seedNo += 1) steps.push({ e: regOfSeed(seedNo).id, kind: 'SEED', slot: { p: order.indexOf(seedNo) } });
  order.forEach((seedNo, p) => { if (seedNo > seededCount && seedNo <= n) steps.push({ e: regOfSeed(seedNo).id, kind: 'DRAW', slot: { p } }); });
  return {
    layout: { type: 'BRACKET', size, byes: size - n, seats: order.map((seedNo, p) => ({ p, bye: seedNo > n, seedNo: seedNo <= seededCount ? seedNo : null })) },
    steps,
    args: { entries },
  };
}

// one table of everybody (6 players in 3 rounds, or the Swiss system): the order is drawn (the Swiss: the seeded players first)
function planTable(regs, s, rng) {
  let ordered;
  if (s.format === 'SIX_ROUNDS') {
    if (regs.length !== 6) return { status: 400, error: `This format is for exactly 6 players (this category has ${regs.length})` };
    const ids = draw.shuffled(regs.map((r) => r.player_id), rng);
    ordered = ids.map((pid) => regs.find((r) => r.player_id === pid));
  } else {
    if (regs.length < swiss.MIN_PLAYERS) return { status: 400, error: `The Swiss system needs at least ${swiss.MIN_PLAYERS} players (this category has ${regs.length})` };
    const rounds = Number(s.rounds) || swiss.roundsFor(regs.length);
    if (rounds < 1 || rounds > regs.length - 1) return { status: 400, error: `With ${regs.length} players the Swiss system can have 1 to ${regs.length - 1} rounds` };
    const seeded = regs.filter((r) => r.seed).sort((a, b) => a.seed - b.seed);
    const unseeded = regs.filter((r) => !r.seed).map((r) => ({ r, k: rng() })).sort((a, b) => a.k - b.k).map((x) => x.r);
    ordered = [...seeded, ...unseeded];
  }
  return {
    layout: { type: 'TABLE', size: ordered.length },
    steps: ordered.map((r, i) => ({ e: r.id, kind: s.format === 'SWISS' && r.seed ? 'SEED' : 'DRAW', slot: { i } })),
    args: { order: ordered.map((r) => r.player_id) },
  };
}

// ---------- the draw of the players of a season into its groups ----------

// How many players each group takes: the groups come out equal (some have one player less when it does not divide), the groups that already have players counting them in.
function capacitiesOf(existingCounts, newPlayers) {
  const caps = existingCounts.map(() => 0);
  for (let i = 0; i < newPlayers; i += 1) {
    let best = 0;
    existingCounts.forEach((e, g) => { if (e + caps[g] < existingCounts[best] + caps[best]) best = g; });
    caps[best] += 1;
  }
  return caps;
}

// The snake over groups with room left: seed 1 in group A, seed 2 in B … and back (8 seeds in 4 groups: A 1 and 8, B 2 and 7 …); a group that is full is skipped.
// -> [[item, …] per group] (the same code is in public/js/draw-verify.js)
function dealSnake(ordered, caps) {
  const left = [...caps];
  const out = caps.map(() => []);
  let i = 0;
  let row = 0;
  while (i < ordered.length) {
    const order = caps.map((c, g) => g);
    if (row % 2 === 1) order.reverse();
    let placed = false;
    order.forEach((g) => { if (i < ordered.length && left[g] > 0) { out[g].push(ordered[i]); i += 1; left[g] -= 1; placed = true; } });
    row += 1;
    if (!placed) break;
  }
  return out;
}

// who is in the groups of a category and who is to be drawn: the registered players of the category that are in no group of the season yet
function groupInputs(season, category) {
  if (season.kind === 'TOURNAMENT') return { status: 400, error: 'This is the draw of the groups of a season: a tournament has its own draw' };
  if (!draw.categoriesFor(season).includes(category)) return { status: 400, error: 'Choose a category of this season' };
  const groupRows = db.prepare('SELECT * FROM season_groups WHERE season_id = ? AND category = ? ORDER BY sort_order, name COLLATE NOCASE').all(season.id, category);
  if (!groupRows.length) return { status: 400, error: 'Create the groups of this category first (the tab Skupiny)' };
  const inGroup = new Set(db.prepare('SELECT m.player_id FROM season_group_members m JOIN season_groups g ON g.id = m.group_id WHERE g.season_id = ?').all(season.id).map((r) => r.player_id));
  const all = draw.registrationsOf(season.id, category);
  const missing = all.filter((r) => !r.player_id);
  if (missing.length) return { status: 400, error: `These players have no player profile yet: ${missing.map((r) => r.name).join(', ')}` };
  const regs = all.filter((r) => !inGroup.has(r.player_id));
  if (!regs.length) return { status: 400, error: 'There is nobody to draw: every registered player of this category is already in a group' };
  const existing = groupRows.map((g) => db.prepare('SELECT p.id, p.name FROM season_group_members m JOIN players p ON p.id = m.player_id WHERE m.group_id = ? ORDER BY m.sort_order, m.id').all(g.id));
  const fingerprint = sha256(JSON.stringify([regs.map((r) => [r.id, r.player_id, r.seed || 0]).sort((a, b) => a[0] - b[0]), groupRows.map((g, i) => [g.id, existing[i].map((p) => p.id)])]));
  return { groupRows, existing, regs, fingerprint };
}

// What the tab Skupiny shows per category: the groups, who sits in them, and who is still to be drawn (with the seeding).
function groupsOverview(season) {
  return draw.categoriesFor(season).map((category) => {
    const groups = db.prepare('SELECT * FROM season_groups WHERE season_id = ? AND category = ? ORDER BY sort_order, name COLLATE NOCASE').all(season.id, category);
    const inGroup = new Set(db.prepare('SELECT m.player_id FROM season_group_members m JOIN season_groups g ON g.id = m.group_id WHERE g.season_id = ?').all(season.id).map((r) => r.player_id));
    const regs = draw.registrationsOf(season.id, category);
    const toDraw = regs.filter((r) => !r.player_id || !inGroup.has(r.player_id));
    const members = groups.reduce((n, g) => n + db.prepare('SELECT COUNT(*) AS c FROM season_group_members WHERE group_id = ?').get(g.id).c, 0);
    const rec = db.prepare("SELECT id FROM draw_records WHERE season_id = ? AND category = ? AND format = 'SEASON_GROUPS' AND status = 'COMMITTED' ORDER BY id DESC LIMIT 1").get(season.id, category);
    return {
      category, label: draw.CATEGORY_LABELS[category] || category, total: regs.length, groups: groups.length, members,
      toDraw: toDraw.map((r) => ({ id: r.id, name: r.name, seed: r.seed || null, noPlayer: !r.player_id })),
      liveRecordId: rec ? Number(rec.id) : null,
    };
  }).filter((c) => c.groups || c.toDraw.length);
}

// Makes `count` empty groups for a category (named "Elite A", "Elite B" ... - the first free letters). -> { created: [{ id, name }] } | { error, status }
function createGroups(season, category, count) {
  if (season.kind === 'TOURNAMENT') return { status: 400, error: 'This is for the groups of a season' };
  if (!draw.categoriesFor(season).includes(category)) return { status: 400, error: 'Choose a category of this season' };
  const n = Number(count);
  if (!Number.isInteger(n) || n < 1 || n > 16) return { status: 400, error: 'The number of groups is from 1 to 16' };
  const label = draw.CATEGORY_LABELS[category] || category;
  const taken = new Set(db.prepare('SELECT name FROM season_groups WHERE season_id = ?').all(season.id).map((g) => g.name.toLowerCase()));
  let order = (db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM season_groups WHERE season_id = ?').get(season.id).n);
  const created = [];
  let letter = 0;
  db.exec('BEGIN');
  try {
    while (created.length < n) {
      const name = `${label} ${String.fromCharCode(65 + (letter % 26))}${letter >= 26 ? Math.floor(letter / 26) : ''}`;
      letter += 1;
      if (taken.has(name.toLowerCase())) continue;
      const info = db.prepare('INSERT INTO season_groups (season_id, name, category, sort_order) VALUES (?, ?, ?, ?)').run(season.id, name, category, order);
      order += 1;
      created.push({ id: Number(info.lastInsertRowid), name });
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { created };
}

// The same draw, but at once and without the show (the organiser does not want the camera): equal groups, seeded players like a snake, nothing is shown to the public.
function assignNow(season, category) {
  const made = prepareGroups(season, category);
  if (made.error) return made;
  const done = commitGroups(season, db.prepare('SELECT * FROM draw_records WHERE id = ?').get(made.recordId));
  if (done.error) return done;
  db.prepare("UPDATE draw_records SET status = 'AUTO', committed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(made.recordId); // (not a draw that is replayed on the page)
  return { saved: done.saved };
}

// Takes the players out of the groups of a category so that they can be divided again (not when a group already has matches). -> { removed } | { error, status }
function clearGroups(season, category) {
  if (season.kind === 'TOURNAMENT') return { status: 400, error: 'This is for the groups of a season' };
  if (!draw.categoriesFor(season).includes(category)) return { status: 400, error: 'Choose a category of this season' };
  const groups = db.prepare('SELECT id, name FROM season_groups WHERE season_id = ? AND category = ?').all(season.id, category);
  const withMatches = groups.filter((g) => db.prepare('SELECT 1 FROM matches WHERE group_id = ? LIMIT 1').get(g.id));
  if (withMatches.length) return { status: 400, error: `These groups already have matches: ${withMatches.map((g) => g.name).join(', ')}` };
  let removed = 0;
  groups.forEach((g) => { removed += db.prepare('DELETE FROM season_group_members WHERE group_id = ?').run(g.id).changes; });
  return { removed };
}

// Starts the draw into the groups of a category of a season. -> { error, status } | { recordId, attempt, seedHash, seed, plan }
function prepareGroups(season, category) {
  const inputs = groupInputs(season, category);
  if (inputs.error) return inputs;
  const { groupRows, existing, regs, fingerprint } = inputs;
  const seed = crypto.randomBytes(32).toString('hex');
  const rng = makeRandom(seed);
  const seeded = regs.filter((r) => r.seed).sort((a, b) => a.seed - b.seed);
  const rest = draw.shuffled(regs.filter((r) => !r.seed), rng);
  const caps = capacitiesOf(existing.map((e) => e.length), regs.length);
  const ordered = [...seeded, ...rest];
  const dealt = dealSnake(ordered, caps);
  // the order of the page: the players in the order they are dealt (the snake), every one on his seat (after the players that are in the group already)
  const steps = [];
  const placed = caps.map(() => 0);
  const dealtRows = Math.max(...dealt.map((d) => d.length));
  for (let row = 0; row < dealtRows; row += 1) {
    const order = caps.map((c, g) => g);
    if (row % 2 === 1) order.reverse();
    order.forEach((g) => {
      const reg = dealt[g][placed[g]];
      if (!reg) return;
      steps.push({ e: reg.id, kind: reg.seed ? 'SEED' : 'DRAW', slot: { g, i: existing[g].length + placed[g] } });
      placed[g] += 1;
    });
  }
  const plan = {
    v: 1,
    season: { id: season.id, name: season.name, slug: season.slug, kind: season.kind },
    category,
    categoryLabel: draw.CATEGORY_LABELS[category] || category,
    format: 'SEASON_GROUPS',
    entrants: regs.map((r, input) => ({ id: r.id, name: r.name, seed: r.seed || null, input })),
    layout: { type: 'GROUPS', caps, groups: groupRows.map((g, gi) => ({ name: g.name, size: existing[gi].length + caps[gi], existing: existing[gi].map((p) => p.name) })) },
    steps,
  };
  const args = { assign: groupRows.map((g, gi) => ({ groupId: g.id, playerIds: dealt[gi].map((r) => r.player_id) })) };
  const seedHash = sha256(seed);
  const info = db.prepare('INSERT INTO draw_records (season_id, category, format, status, seed, seed_hash, fingerprint, options, args, plan) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(season.id, category, 'SEASON_GROUPS', 'PLANNED', seed, seedHash, fingerprint, '{}', JSON.stringify(args), JSON.stringify(plan));
  const attempt = db.prepare('SELECT COUNT(*) AS c FROM draw_records WHERE season_id = ? AND category = ?').get(season.id, category).c;
  return { recordId: Number(info.lastInsertRowid), attempt, seedHash, seed, plan };
}

// Puts the players of the draw that was shown into the groups. The schedule is not touched: the tab Rozpis says which groups need their matches made.
function commitGroups(season, rec) {
  const inputs = groupInputs(season, rec.category);
  if (inputs.error) return inputs;
  if (inputs.fingerprint !== rec.fingerprint) return { status: 409, error: 'The registered players, their seeding or the groups changed after the draw was made: start the draw again' };
  const args = JSON.parse(rec.args);
  db.exec('BEGIN');
  try {
    args.assign.forEach((a) => {
      let next = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM season_group_members WHERE group_id = ?').get(a.groupId).n;
      a.playerIds.forEach((pid) => { db.prepare('INSERT INTO season_group_members (group_id, player_id, sort_order) VALUES (?, ?, ?)').run(a.groupId, pid, next); next += 1; });
    });
    db.prepare("UPDATE draw_records SET status = 'COMMITTED', committed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(rec.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { recordId: rec.id, saved: args.assign.reduce((n, a) => n + a.playerIds.length, 0) };
}

// ---------- the two things the organiser does ----------

// Starts a draw: checks everything the real draw checks, makes the key and the plan, writes it down. -> { error, status } | { recordId, attempt, seedHash, seed, plan }
function prepare(season, category, opts = {}) {
  if (opts.mode === 'MANUAL') return { status: 400, error: 'The draw in front of the camera is for the automatic draw (the players are seated by lot)' };
  const options = pickOptions({ ...opts, mode: 'AUTO' });
  const prep = draw.prepareDraw(season, category, options);
  if (prep.error) return prep;
  const { s, regs } = prep;
  const seed = crypto.randomBytes(32).toString('hex');
  const rng = makeRandom(seed);
  let planned;
  if (s.format === 'SIX_ROUNDS' || s.format === 'SWISS') planned = planTable(regs, s, rng);
  else if (s.format === 'GROUPS' || s.format === 'GROUPS_BRACKET') {
    if (s.format === 'GROUPS_BRACKET' && regs.length < 4) return { status: 400, error: 'Groups with a bracket need at least 4 players' };
    planned = planGroups(regs, s, rng);
  } else planned = planBracket(regs, s, rng);
  if (planned.error) return planned;
  const plan = {
    v: 1,
    season: { id: season.id, name: season.name, slug: season.slug },
    category,
    categoryLabel: draw.CATEGORY_LABELS[category] || category,
    format: s.format,
    entrants: regs.map((r, input) => ({ id: r.id, name: r.name, seed: r.seed || null, input })), // (input: the place in the list the shuffle started from)
    layout: planned.layout,
    steps: planned.steps,
  };
  const seedHash = sha256(seed);
  const info = db.prepare('INSERT INTO draw_records (season_id, category, format, status, seed, seed_hash, fingerprint, options, args, plan) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(season.id, category, s.format, 'PLANNED', seed, seedHash, fingerprintOf(regs), JSON.stringify(options), JSON.stringify(planned.args), JSON.stringify(plan));
  const attempt = db.prepare("SELECT COUNT(*) AS c FROM draw_records WHERE season_id = ? AND category = ?").get(season.id, category).c;
  return { recordId: Number(info.lastInsertRowid), attempt, seedHash, seed, plan };
}

// Saves the draw that was shown into the tournament. -> { error, status } | what createDraw returns, plus recordId
function commit(season, recordId) {
  const rec = db.prepare('SELECT * FROM draw_records WHERE id = ? AND season_id = ?').get(Number(recordId), season.id);
  if (!rec) return { status: 404, error: 'This draw was not found' };
  if (rec.status !== 'PLANNED') return { status: 409, error: rec.status === 'COMMITTED' ? 'This draw is already saved' : 'This draw can no longer be saved' };
  if (rec.format === 'SEASON_GROUPS') return commitGroups(season, rec);
  const options = JSON.parse(rec.options);
  const prep = draw.prepareDraw(season, rec.category, options);
  if (prep.error) return prep;
  if (fingerprintOf(prep.regs) !== rec.fingerprint) return { status: 409, error: 'The players or their seeding changed after the draw was made: start the draw again' };
  const made = draw.createDraw(season, rec.category, { ...options, ...JSON.parse(rec.args) });
  if (made.error) return made;
  db.prepare("UPDATE draw_records SET status = 'COMMITTED', committed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(rec.id);
  return { ...made, recordId: rec.id };
}

// What anybody may see of a saved draw (the key included): the plan, so the draw can be replayed and the shuffle checked.
function publicRecord(id) {
  const rec = db.prepare("SELECT * FROM draw_records WHERE id = ? AND status IN ('COMMITTED', 'DELETED')").get(Number(id));
  if (!rec) return null;
  const season = db.prepare('SELECT id, name, slug, kind FROM seasons WHERE id = ?').get(rec.season_id);
  const attempts = db.prepare('SELECT COUNT(*) AS c FROM draw_records WHERE season_id = ? AND category = ?').get(rec.season_id, rec.category).c;
  return {
    id: rec.id,
    seasonId: rec.season_id,
    seasonName: season ? season.name : '',
    seasonSlug: season ? season.slug : '',
    seasonKind: season ? season.kind : '',
    category: rec.category,
    format: rec.format,
    seed: rec.seed,
    seedHash: rec.seed_hash,
    createdAt: rec.created_at,
    committedAt: rec.committed_at,
    deleted: rec.status === 'DELETED', // the draw was later deleted by the organiser (shown, never hidden)
    attempts,
    plan: JSON.parse(rec.plan),
  };
}

module.exports = { prepare, prepareGroups, createGroups, assignNow, clearGroups, groupsOverview, commit, dealSnake, capacitiesOf, publicRecord, makeRandom, sha256, fingerprintOf };
