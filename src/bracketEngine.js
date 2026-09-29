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
// is always OTHER: a bracket is a freestanding tournament, not tied to the
// BLTA league categories that column otherwise validates against
// elsewhere. Unscheduled (no location/date) — an admin sets those the same
// "Set date & location" way as any other planned match, once the pairing
// is known.
function maybeCreateMatch(node) {
  if (node.match_id || !node.player1_id || !node.player2_id) return node;
  const bracket = db.prepare('SELECT * FROM brackets WHERE id = ?').get(node.bracket_id);
  // A past/historical bracket (see routes/brackets.js's autoCreateMatches
  // option) never gets real matches at all — the admin records each
  // node's winner directly instead, via recordManualResult below.
  if (!bracket.auto_create_matches) return node;
  const state = engine.initState(bracket.format);
  const info = db.prepare(`
    INSERT INTO matches (share_token, category, player1_id, player2_id, location, scheduled_at, format, status, state, history, created_by_admin, notes)
    VALUES (?, 'OTHER', ?, ?, '', NULL, ?, 'PLANNED', ?, '[]', 1, ?)
  `).run(
    crypto.randomUUID(),
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
  name, format, entries, size, autoCreateMatches,
}) {
  const drawSize = entries && entries.length > 0
    ? nextPowerOfTwo(entries.length)
    : nextPowerOfTwo(Math.max(size || 2, 2));
  const info = db.prepare('INSERT INTO brackets (name, format, size, auto_create_matches) VALUES (?, ?, ?, ?)')
    .run(name, format, drawSize, autoCreateMatches === false ? 0 : 1);
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
  return node;
}

// The live hook's entry point (called from routes/matches.js once a match
// is confirmed FINISHED with a winner) — no-op if this match isn't part of
// any bracket at all, which is the common case for every ordinary match.
function syncBracketIfFinished(matchRow) {
  if (matchRow.status !== 'FINISHED' || !matchRow.winner_id) return;
  const node = db.prepare('SELECT * FROM bracket_matches WHERE match_id = ?').get(matchRow.id);
  if (!node) return;
  advanceWinner(node, matchRow.winner_id);
}

function getBracketTree(bracketId) {
  const bracket = db.prepare('SELECT * FROM brackets WHERE id = ?').get(bracketId);
  if (!bracket) return null;
  const nodes = db.prepare('SELECT * FROM bracket_matches WHERE bracket_id = ? ORDER BY round, position').all(bracketId);
  return { bracket, nodes };
}

module.exports = {
  nextPowerOfTwo,
  standardSeedOrder,
  roundCount,
  createBracket,
  applySeeding,
  setSlotPlayers,
  recordManualResult,
  advanceWinner,
  syncBracketIfFinished,
  getBracketTree,
};
