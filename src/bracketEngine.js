// Single-elimination playoff bracket ("Pavúk") logic — building the empty
// tree, seeding round 1 into it, and advancing a winner into the next
// round. Every bracket pairing that actually has two real players becomes
// a normal row in `matches` (see maybeCreateMatch below), so live scoring,
// manual results, chat, and notify buttons all keep working completely
// unchanged — this module only ever decides WHO plays WHO and WHERE the
// winner goes next, never how a match itself is played or scored.
const crypto = require('crypto');
const db = require('./db');
const engine = require('./matchEngine');
const tournamentSchedule = require('./tournamentSchedule');

// Smallest power of two >= n, minimum 2 — a draw always has a tree shape
// (2, 4, 8, 16, 32...) even when the entrant count is odd; the gap between
// the real entrant count and this size becomes byes (see applySeeding).
function nextPowerOfTwo(n) {
  let size = 2;
  while (size < n) size *= 2;
  return size;
}

// The standard tennis seeding order for a draw of `size` slots — e.g. for
// size=8 this returns [1,8,4,5,2,7,3,6], meaning slot 0 gets seed 1, slot 1
// gets seed 8, and so on; pairing slot(2i)/slot(2i+1) gives the classic
// "1v8, 4v5, 2v7, 3v6" round-1 matchups where seed 1 and seed 2 can only
// meet in the final and every seed is kept as far from its nearest-ranked
// neighbor as the bracket allows. Built recursively: start with the
// 2-slot base case [1,2], then repeatedly double by mirroring each
// existing seed to its "opposite" position at the new size.
function standardSeedOrder(size) {
  let order = [1, 2];
  while (order.length < size) {
    const newSize = order.length * 2;
    const mirrored = [];
    order.forEach((seed) => {
      mirrored.push(seed, newSize + 1 - seed);
    });
    order = mirrored;
  }
  return order;
}

function roundCount(size) {
  return Math.log2(size);
}

// Builds the full empty tree for a brand-new bracket — every round from 1
// (first round) up to the final, all slots empty (no players, no seeds, no
// match). Inserted from the final backwards to round 1, since a round's
// rows need to reference the already-inserted ids of the round after it
// (next_bracket_match_id). Returns nothing; the tree is read back from the
// DB by callers.
function buildEmptyTree(bracketId, size) {
  const rounds = roundCount(size);
  const insert = db.prepare(`
    INSERT INTO bracket_matches (bracket_id, round, position, next_bracket_match_id, next_slot)
    VALUES (?, ?, ?, ?, ?)
  `);
  let nextRoundIds = null; // ids of the round just inserted (one closer to the final)
  for (let round = rounds; round >= 1; round -= 1) {
    const nodesInRound = size / (2 ** round);
    const roundIds = [];
    for (let position = 0; position < nodesInRound; position += 1) {
      const nextBracketMatchId = nextRoundIds ? nextRoundIds[Math.floor(position / 2)] : null;
      const nextSlot = nextRoundIds ? (position % 2 === 0 ? 1 : 2) : null;
      const info = insert.run(bracketId, round, position, nextBracketMatchId, nextSlot);
      roundIds[position] = info.lastInsertRowid;
    }
    nextRoundIds = roundIds;
  }
}

// Creates the real, scoreable `matches` row for a bracket node once both
// its players are known — same INSERT shape as POST /api/matches (see
// routes/matches.js), minus the fields that only make sense for a
// player-initiated match (proposals, created_by_player_id, etc). Category
// is the bracket's own (see routes/brackets.js's category option) if it
// was tied to one of the real BLTA categories, or OTHER for a genuinely
// freestanding tournament (bracket.category left unset). Unscheduled (no
// location/date) — an admin sets those the same "Set date & location" way
// as any other planned match, once the pairing is known.
const BLTA_CATEGORIES = ['ELITE', 'NEXT_GEN', 'NOVICE'];

// A bracket tied to a BLTA category is a play-off draw: its matches are play-off matches (they never count in a
// group table) and carry the bracket's season, but belong to no group.
function matchStageFor(bracket) {
  return BLTA_CATEGORIES.includes(bracket.category) ? 'PLAYOFF' : 'GROUP';
}

function maybeCreateMatch(node) {
  if (node.match_id || !node.player1_id || !node.player2_id) return node;
  const bracket = db.prepare('SELECT * FROM brackets WHERE id = ?').get(node.bracket_id);
  // A past/historical bracket (see routes/brackets.js's autoCreateMatches
  // option) never gets real matches at all — the admin records each
  // node's winner directly instead, via recordManualResult below.
  if (!bracket.auto_create_matches) return node;
  const state = engine.initState(bracket.format);
  const info = db.prepare(`
    INSERT INTO matches (share_token, category, season_id, stage, player1_id, player2_id, location, scheduled_at, format, status, state, history, created_by_admin, notes)
    VALUES (?, ?, ?, ?, ?, ?, '', NULL, ?, 'PLANNED', ?, '[]', 1, ?)
  `).run(
    crypto.randomUUID(),
    bracket.category || 'OTHER',
    bracket.season_id || null,
    matchStageFor(bracket),
    node.player1_id,
    node.player2_id,
    bracket.format,
    JSON.stringify(state),
    `${bracket.name} — round ${node.round}`,
  );
  db.prepare('UPDATE bracket_matches SET match_id = ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\', \'now\') WHERE id = ?')
    .run(info.lastInsertRowid, node.id);
  return db.prepare('SELECT * FROM bracket_matches WHERE id = ?').get(node.id);
}

// Writes `winnerId` into the next round's node, in the slot this node
// feeds into, then — if that node now has both its players (either two
// real winners, or one real player meeting a bye) — either creates its
// match (two real players) or immediately advances the lone player again
// (a bye), recursing all the way to the final if a chain of byes lines up.
// Called both by the live "a bracket match just finished" hook
// (routes/matches.js) and once per bye right after a fresh seeding.
function advanceWinner(node, winnerId) {
  if (!node.next_bracket_match_id) return; // node was the final — nothing further to advance into
  const column = node.next_slot === 1 ? 'player1_id' : 'player2_id';
  db.prepare(`UPDATE bracket_matches SET ${column} = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
    .run(winnerId, node.next_bracket_match_id);
  let nextNode = db.prepare('SELECT * FROM bracket_matches WHERE id = ?').get(node.next_bracket_match_id);

  if (nextNode.player1_id && nextNode.player2_id) {
    nextNode = maybeCreateMatch(nextNode);
  } else if ((nextNode.player1_id || nextNode.player2_id) && nextNode.is_bye) {
    // The next node was itself pre-marked as a bye (both original round-1
    // seeds for it were phantom) — the lone player just seated advances
    // straight through with no match, same as a first-round bye.
    const lonePlayerId = nextNode.player1_id || nextNode.player2_id;
    advanceWinner(nextNode, lonePlayerId);
  }
}

// Fills round 1 from a seeded entrant list (sorted by seed, 1 = best) and
// immediately propagates any byes. `entries` is [{playerId, seed}]; size
// is the already-computed draw size (nextPowerOfTwo(entries.length)) —
// any seed number beyond entries.length is a phantom (a bye).
function applySeeding(bracketId, entries, size) {
  const order = standardSeedOrder(size);
  const bySeed = new Map(entries.map((e) => [e.seed, e.playerId]));
  const update = db.prepare(`
    UPDATE bracket_matches
    SET seed1 = ?, seed2 = ?, player1_id = ?, player2_id = ?, is_bye = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE bracket_id = ? AND round = 1 AND position = ?
  `);
  const nodesInRound1 = size / 2;
  for (let position = 0; position < nodesInRound1; position += 1) {
    const seed1 = order[position * 2];
    const seed2 = order[position * 2 + 1];
    const player1Id = bySeed.get(seed1) || null;
    const player2Id = bySeed.get(seed2) || null;
    const isBye = (!!player1Id) !== (!!player2Id); // exactly one present
    update.run(seed1, seed2, player1Id, player2Id, isBye ? 1 : 0, bracketId, position);
  }

  // Propagate byes and create matches for real pairings, now that round 1
  // is fully written.
  const round1Nodes = db.prepare('SELECT * FROM bracket_matches WHERE bracket_id = ? AND round = 1 ORDER BY position').all(bracketId);
  round1Nodes.forEach((node) => {
    if (node.is_bye) {
      const lonePlayerId = node.player1_id || node.player2_id;
      advanceWinner(node, lonePlayerId);
    } else if (node.player1_id && node.player2_id) {
      maybeCreateMatch(node);
    }
  });
}

// Creates a bracket + its full empty tree. With `entries` (the
// "auto-generate" admin flow), the draw size is derived from the entrant
// count and round 1 is seeded immediately. Without entries (the "manual"
// flow), `size` is used directly — an empty tree the admin fills in one
// slot at a time afterwards via setSlotPlayers below. autoCreateMatches
// (default true) is stored on the bracket itself and read back by
// maybeCreateMatch on every node it ever touches — false is for a
// past/historical draw where the games already happened outside this app,
// so nothing here should try to create a live, scoreable match for them.
function createBracket({
  name, format, entries, size, autoCreateMatches, category, seasonId, kind, parentBracketId,
}) {
  const drawSize = entries && entries.length > 0
    ? nextPowerOfTwo(entries.length)
    : nextPowerOfTwo(Math.max(size || 2, 2));
  const info = db.prepare('INSERT INTO brackets (name, format, size, auto_create_matches, category, season_id, kind, parent_bracket_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(name, format, drawSize, autoCreateMatches === false ? 0 : 1, category || null, seasonId || null, kind === 'CONSOLATION' ? 'CONSOLATION' : 'MAIN', parentBracketId || null);
  const bracketId = info.lastInsertRowid;
  buildEmptyTree(bracketId, drawSize);
  if (entries && entries.length > 0) applySeeding(bracketId, entries, drawSize);
  return bracketId;
}

// Manual-mode round-1 assignment — sets one slot's two players directly
// (no seed numbers), then runs the same bye/match-creation follow-through
// applySeeding's loop does for a single node, so a manually-built draw
// still auto-creates matches and propagates byes exactly like a seeded one.
function setSlotPlayers(nodeId, player1Id, player2Id) {
  const isBye = (!!player1Id) !== (!!player2Id);
  db.prepare(`
    UPDATE bracket_matches
    SET player1_id = ?, player2_id = ?, is_bye = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `).run(player1Id, player2Id, isBye ? 1 : 0, nodeId);
  let node = db.prepare('SELECT * FROM bracket_matches WHERE id = ?').get(nodeId);
  if (node.is_bye) {
    const lonePlayerId = node.player1_id || node.player2_id;
    advanceWinner(node, lonePlayerId);
  } else if (node.player1_id && node.player2_id) {
    node = maybeCreateMatch(node);
  }
  return node;
}

// Directly decides a node's winner without ever creating or requiring a
// real match — for a past/historical bracket (auto_create_matches off),
// or to patch a one-off node on an otherwise live bracket that never got
// a match for some reason. `score` is a free-text display string ("6-2,
// 6-4"), never parsed — this is display-only, unlike a real match's own
// set-by-set state. Same advancement as a live match finishing: the
// winner is written into the next round and, if that fills it, either a
// match gets created there too (if this bracket auto-creates) or it's
// left for another manual result.
function recordManualResult(nodeId, winnerId, score) {
  db.prepare(`
    UPDATE bracket_matches
    SET manual_winner_id = ?, manual_score = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?
  `).run(winnerId, score || null, nodeId);
  const node = db.prepare('SELECT * FROM bracket_matches WHERE id = ?').get(nodeId);
  advanceWinner(node, winnerId);
  dropLoser(node, winnerId);
  planCourts(node.bracket_id);
  return node;
}

// Takes back a result that was entered by hand (recordManualResult): the winner leaves the next round, the loser leaves the losers
// bracket he dropped into, the result is empty again. Later results that depend on it (the winner already played on) are cleared too — but
// only with `cascade`; without it nothing is changed and { dependents } says how many there would be. A real match in the way (a later
// pairing that already has a match) stops it: that match has to be dealt with first. -> { ok, cleared } | { error, status, dependents? }
function resetManualResult(nodeId, cascade = false) {
  const get = (id) => db.prepare('SELECT * FROM bracket_matches WHERE id = ?').get(id);
  const first = get(nodeId);
  if (!first) return { status: 404, error: 'Slot not found' };
  if (first.match_id) return { status: 400, error: 'This slot has a real match — reset it on the match itself' };
  if (!first.manual_winner_id) return { status: 400, error: 'This slot has no result entered by hand' };
  let cleared = 0;
  const blocked = (message) => Object.assign(new Error(message), { blocked: true });
  const column = (slot) => (slot === 1 ? 'player1_id' : 'player2_id');
  // a player leaves a slot: a later result that depends on him goes first, and a lone player who had advanced through a bye goes on
  const unseat = (id, col) => {
    const node = get(id);
    if (node.match_id) throw blocked('A later pairing already has a real match — deal with that match first');
    if (node.manual_winner_id) reset(node);
    db.prepare(`UPDATE bracket_matches SET ${col} = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).run(id);
    if (node.is_bye && node.next_bracket_match_id) unseat(node.next_bracket_match_id, column(node.next_slot));
  };
  const reset = (node) => {
    if (node.next_bracket_match_id) unseat(node.next_bracket_match_id, column(node.next_slot));
    // the loser of a round-1 (or, in a Monrad, any) node sits in a losers bracket
    if (node.consolation_seed) {
      const bracket = db.prepare('SELECT * FROM brackets WHERE id = ?').get(node.bracket_id);
      const childId = node.loser_bracket_id || (node.round === 1 && bracket && bracket.kind !== 'CONSOLATION' ? (consolationOf(bracket.id) || {}).id : null);
      const target = childId ? db.prepare('SELECT * FROM bracket_matches WHERE bracket_id = ? AND round = 1 AND (seed1 = ? OR seed2 = ?)').get(childId, node.consolation_seed, node.consolation_seed) : null;
      if (target) unseat(target.id, target.seed1 === node.consolation_seed ? 'player1_id' : 'player2_id');
    }
    db.prepare("UPDATE bracket_matches SET manual_winner_id = NULL, manual_score = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(node.id);
    cleared += 1;
  };
  db.exec('BEGIN');
  try {
    reset(first);
    if (!cascade && cleared > 1) {
      db.exec('ROLLBACK');
      return { status: 409, code: 'HAS_DEPENDENTS', dependents: cleared - 1, error: `Resetting this result also clears ${cleared - 1} later result${cleared === 2 ? '' : 's'} that depend on it` };
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    if (err.blocked) return { status: 409, error: err.message };
    throw err;
  }
  return { ok: true, cleared };
}

// The live hook's entry point (called from routes/matches.js once a match
// is confirmed FINISHED with a winner) — no-op if this match isn't part of
// any bracket at all, which is the common case for every ordinary match.
function syncBracketIfFinished(matchRow) {
  // the last match of the groups of a tournament category can make the bracket after the groups
  if (matchRow.group_id && (matchRow.status === 'FINISHED' || matchRow.status === 'UNFINISHED')) require('./tournamentDraw').onMatchFinished(matchRow);
  if (matchRow.status !== 'FINISHED' || !matchRow.winner_id) return;
  const node = db.prepare('SELECT * FROM bracket_matches WHERE match_id = ?').get(matchRow.id);
  if (!node) return;
  advanceWinner(node, matchRow.winner_id);
  dropLoser(node, matchRow.winner_id);
  planCourts(node.bracket_id);
}

// New matches of a tournament bracket are put on the courts by the planner (when the tournament has courts and automatic scheduling on).
function planCourtsForSeason(seasonId) {
  tournamentSchedule.autoPlanIfEnabled(seasonId);
}

function planCourts(bracketId) {
  const bracket = db.prepare('SELECT season_id FROM brackets WHERE id = ?').get(bracketId);
  if (bracket && bracket.season_id) tournamentSchedule.autoPlanIfEnabled(bracket.season_id);
}

// ---------- consolation draw ("útecha") ----------
// Every main draw has a consolation draw: whoever loses a round-1 match of the main draw drops into it (a player who lost in round 2
// or later is out, a player who had a bye in round 1 has nothing to drop from). The consolation draw holds one entrant per real
// round-1 match of the main draw, so its size is known as soon as round 1 of the main draw is seated: the loser of the k-th real
// round-1 match takes seed k+1 (stored on that node as consolation_seed) and the standard seed order places the seeds, so the
// consolation draw has byes exactly where it cannot be filled.

// The two players of a node and, once decided, who won; null while still open.
function nodeWinner(node) {
  if (node.match_id) {
    const match = db.prepare('SELECT winner_id, status FROM matches WHERE id = ?').get(node.match_id);
    return match && match.status === 'FINISHED' && match.winner_id ? match.winner_id : null;
  }
  return node.manual_winner_id || null;
}

// What round 1 of a main bracket looks like for the purpose of a consolation draw: { open: real pairings not yet seated, real: n }.
function consolationReadiness(mainBracketId) {
  const round1 = db.prepare('SELECT * FROM bracket_matches WHERE bracket_id = ? AND round = 1 ORDER BY position').all(mainBracketId);
  const real = round1.filter((n) => n.player1_id && n.player2_id);
  const empty = round1.filter((n) => !n.is_bye && !(n.player1_id && n.player2_id));
  return { real: real.length, empty: empty.length, nodes: real };
}

function consolationOf(mainBracketId) {
  return db.prepare("SELECT * FROM brackets WHERE parent_bracket_id = ? AND kind = 'CONSOLATION' ORDER BY id LIMIT 1").get(mainBracketId) || null;
}

// every bracket below this one (its losers brackets, theirs again …), nearest first
function descendants(bracketId) {
  const out = [];
  let level = [bracketId];
  while (level.length) {
    const marks = level.map(() => '?').join(',');
    const next = db.prepare(`SELECT id FROM brackets WHERE parent_bracket_id IN (${marks}) ORDER BY id`).all(...level).map((r) => r.id);
    out.push(...next);
    level = next;
  }
  return out;
}

// Makes the losers brackets of a main bracket whose round 1 is fully seated, by type:
//  - PRINCE: one losers bracket, for the players who lose in round 1 (who lose later are out, a bye has nothing to drop from);
//  - MONRAD: a losers bracket for the losers of EVERY round (except the final), each of them again a Monrad — so every player keeps
//    playing until all places are decided.
// A losers bracket holds one entrant per real match of the round it is fed from, so its size is known at once: the loser of the k-th real
// match takes seed k+1 (stored on that node as consolation_seed, the bracket on loser_bracket_id) and the standard seed order places the
// seeds, so it has byes exactly where it cannot be filled. A round with fewer than two matches has no losers bracket.
// Returns { bracketId (the first one), brackets (how many) } or { error }. Losers of matches that are already decided are dropped in.
function buildLosers(mainBracketId, { name, format, type = 'PRINCE' }) {
  const main = db.prepare('SELECT * FROM brackets WHERE id = ?').get(mainBracketId);
  if (!main) return { error: 'Bracket not found' };
  if (main.kind === 'CONSOLATION') return { error: 'Only a main bracket gets losers brackets' };
  if (!['PRINCE', 'MONRAD'].includes(type)) return { error: 'Unknown type of the losers brackets' };
  if (consolationOf(mainBracketId)) return { error: 'This bracket already has a consolation draw' };
  const ready = consolationReadiness(mainBracketId);
  if (ready.empty > 0) return { error: 'Seat every round-1 match of the main draw first' };
  const created = [];
  const mark = db.prepare('UPDATE bracket_matches SET consolation_seed = ?, loser_bracket_id = ? WHERE id = ?');
  const makeChildren = (parent, isMain) => {
    const nodes = db.prepare('SELECT * FROM bracket_matches WHERE bracket_id = ? ORDER BY round, position').all(parent.id);
    const rounds = roundCount(parent.size);
    const lastRound = type === 'MONRAD' ? rounds - 1 : (isMain ? 1 : 0);
    for (let round = 1; round <= lastRound; round += 1) {
      const inRound = nodes.filter((n) => n.round === round);
      // the matches that will really be played: round 1 without the byes, later rounds all of them
      const real = round === 1 ? (isMain ? ready.nodes : inRound.filter((n) => !n.is_bye)) : inRound;
      if (real.length < 2) continue;
      const size = nextPowerOfTwo(real.length);
      let childName = name;
      if (type === 'MONRAD') childName = isMain ? (/Útecha$/.test(name) ? name.replace(/Útecha$/, `Útecha po ${round}. kole`) : `${name} po ${round}. kole`) : `${parent.name} › po ${round}. kole`;
      const info = db.prepare('INSERT INTO brackets (name, format, size, auto_create_matches, category, season_id, kind, parent_bracket_id, feeds_round) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(childName, format, size, main.auto_create_matches, main.category, main.season_id, 'CONSOLATION', parent.id, round);
      const childId = Number(info.lastInsertRowid);
      buildEmptyTree(childId, size);
      // seeds and byes only; the players arrive one by one with dropLoser
      const order = standardSeedOrder(size);
      const layout = db.prepare('UPDATE bracket_matches SET seed1 = ?, seed2 = ?, is_bye = ? WHERE bracket_id = ? AND round = 1 AND position = ?');
      for (let position = 0; position < size / 2; position += 1) {
        const seed1 = order[position * 2];
        const seed2 = order[position * 2 + 1];
        layout.run(seed1, seed2, (seed1 <= real.length) !== (seed2 <= real.length) ? 1 : 0, childId, position);
      }
      real.forEach((node, i) => mark.run(i + 1, childId, node.id));
      created.push(childId);
      if (type === 'MONRAD') makeChildren(db.prepare('SELECT * FROM brackets WHERE id = ?').get(childId), false);
    }
  };
  makeChildren(main, true);
  if (!created.length) return { error: 'The main draw has fewer than two matches in its first round, so there is nobody to play a consolation draw' };
  db.prepare('SELECT * FROM bracket_matches WHERE bracket_id = ? AND consolation_seed IS NOT NULL').all(mainBracketId).forEach((node) => {
    const winnerId = nodeWinner(node);
    if (winnerId) dropLoser(node, winnerId);
  });
  planCourts(created[0]);
  return { bracketId: created[0], brackets: created.length };
}

// kept for the callers that only know the old name: the PRINCE consolation draw
function buildConsolation(mainBracketId, { name, format, type }) {
  return buildLosers(mainBracketId, { name, format, type: type || 'PRINCE' });
}

// A node was just decided: its loser goes to the losers bracket that node feeds (if it has one).
function dropLoser(node, winnerId) {
  if (!node.consolation_seed) return;
  const bracket = db.prepare('SELECT * FROM brackets WHERE id = ?').get(node.bracket_id);
  if (!bracket) return;
  // a node made before losers brackets had their own column: only round 1 of a main bracket fed the consolation draw
  const childId = node.loser_bracket_id || (node.round === 1 && bracket.kind !== 'CONSOLATION' ? (consolationOf(bracket.id) || {}).id : null);
  if (!childId) return;
  const loserId = node.player1_id === winnerId ? node.player2_id : node.player1_id;
  if (!loserId) return;
  let target = db.prepare('SELECT * FROM bracket_matches WHERE bracket_id = ? AND round = 1 AND (seed1 = ? OR seed2 = ?)').get(childId, node.consolation_seed, node.consolation_seed);
  if (!target) return;
  const column = target.seed1 === node.consolation_seed ? 'player1_id' : 'player2_id';
  db.prepare(`UPDATE bracket_matches SET ${column} = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).run(loserId, target.id);
  target = db.prepare('SELECT * FROM bracket_matches WHERE id = ?').get(target.id);
  if (target.is_bye) advanceWinner(target, loserId);
  else if (target.player1_id && target.player2_id) maybeCreateMatch(target);
}

function getBracketTree(bracketId) {
  const bracket = db.prepare('SELECT * FROM brackets WHERE id = ?').get(bracketId);
  if (!bracket) return null;
  const nodes = db.prepare('SELECT * FROM bracket_matches WHERE bracket_id = ? ORDER BY round, position').all(bracketId);
  return { bracket, nodes };
}

// After the bracket's category or season was changed: the matches it has already created follow. Season and play-off
// stage are plain labels, so every one of them is updated; the category of a FINISHED match is left alone (its
// ranking points were already worked out under the old category).
function syncBracketMatches(bracketId) {
  const bracket = db.prepare('SELECT * FROM brackets WHERE id = ?').get(bracketId);
  if (!bracket) return 0;
  const ids = db.prepare('SELECT match_id FROM bracket_matches WHERE bracket_id = ? AND match_id IS NOT NULL').all(bracketId).map((r) => r.match_id);
  const labels = db.prepare('UPDATE matches SET season_id = ?, stage = ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\', \'now\') WHERE id = ?');
  const category = db.prepare('UPDATE matches SET category = ? WHERE id = ? AND status != \'FINISHED\'');
  ids.forEach((id) => {
    labels.run(bracket.season_id || null, matchStageFor(bracket), id);
    category.run(bracket.category || 'OTHER', id);
  });
  return ids.length;
}

module.exports = {
  nextPowerOfTwo,
  standardSeedOrder,
  roundCount,
  createBracket,
  applySeeding,
  setSlotPlayers,
  recordManualResult,
  resetManualResult,
  advanceWinner,
  syncBracketIfFinished,
  buildConsolation,
  buildLosers,
  descendants,
  planCourts,
  planCourtsForSeason,
  consolationOf,
  consolationReadiness,
  dropLoser,
  getBracketTree,
  syncBracketMatches,
};
